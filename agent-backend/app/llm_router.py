"""
Multi-provider LLM Router with automatic failover.

Provider priority chain:
  Gemini Key 1 → Gemini Key 2 → NVIDIA NIM → OpenRouter (DeepSeek V4 Flash)

On 429/503/rate-limit errors, the failing provider enters a cooldown period
and the router tries the next provider in the chain.
"""

import json
import time
import traceback
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable

from app.config import settings


# ---------------------------------------------------------------------------
# Unified response wrapper
# ---------------------------------------------------------------------------

@dataclass
class ToolCall:
    """A normalised tool/function call extracted from any provider's response."""
    name: str
    arguments: dict[str, Any]


@dataclass
class LLMResponse:
    """Provider-agnostic response object."""
    text: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)
    provider_name: str = ""
    model_name: str = ""
    raw: Any = None  # keep the raw provider response for debugging


# ---------------------------------------------------------------------------
# Tool schema converters
# ---------------------------------------------------------------------------

def _python_tools_to_openai_schema(tools: list[Callable]) -> list[dict]:
    """Convert plain-Python tool functions to the OpenAI function-calling schema.

    Each tool function must have a docstring with an Args section.  We parse it
    to derive parameter descriptions.
    """
    schemas = []
    for fn in tools:
        doc = fn.__doc__ or ""
        # Parse description (everything before "Args:")
        parts = doc.split("Args:")
        description = parts[0].strip()

        # Parse args from docstring
        properties: dict[str, Any] = {}
        required: list[str] = []
        if len(parts) > 1:
            for line in parts[1].strip().splitlines():
                line = line.strip()
                if ":" in line:
                    param_name, param_desc = line.split(":", 1)
                    param_name = param_name.strip()
                    param_desc = param_desc.strip()
                    # Infer type from the Python type hints or default to string
                    param_type = "string"
                    if "float" in param_desc.lower() or "score" in param_name.lower():
                        param_type = "number"
                    elif "int" in param_desc.lower() or param_name == "minutes":
                        param_type = "integer"
                    properties[param_name] = {
                        "type": param_type,
                        "description": param_desc,
                    }
                    required.append(param_name)

        schemas.append({
            "type": "function",
            "function": {
                "name": fn.__name__,
                "description": description,
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                },
            },
        })
    return schemas


# ---------------------------------------------------------------------------
# Abstract provider
# ---------------------------------------------------------------------------

class LLMProvider(ABC):
    """Base class for all LLM providers."""

    name: str = "base"
    model: str = ""
    _cooldown_until: float = 0.0  # timestamp until which this provider is cooling

    @property
    def is_available(self) -> bool:
        return time.time() >= self._cooldown_until

    def enter_cooldown(self, seconds: float = 60.0) -> None:
        self._cooldown_until = time.time() + seconds
        print(f"[LLMRouter] [Cooldown] {self.name} entering cooldown for {seconds}s")

    @abstractmethod
    def generate(
        self,
        messages: list[dict],
        tools: list[Callable] | None = None,
        system_prompt: str | None = None,
    ) -> LLMResponse:
        ...


# ---------------------------------------------------------------------------
# Gemini provider (supports key rotation with 2 keys)
# ---------------------------------------------------------------------------

class GeminiProvider(LLMProvider):
    """Google Gemini via the google-genai SDK."""

    def __init__(self, api_key: str, name: str = "gemini", model: str = "") -> None:
        self.name = name
        self.api_key = api_key
        self.model = model or settings.gemini_model
        self._cooldown_until = 0.0

    def generate(
        self,
        messages: list[dict],
        tools: list[Callable] | None = None,
        system_prompt: str | None = None,
    ) -> LLMResponse:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=self.api_key, http_options={'retry_options': {'attempts': 1}})

        # Build Gemini-native content objects from our normalised messages
        contents = []
        for msg in messages:
            role = msg["role"]
            if role == "tool_result":
                # Function response back to the model
                contents.append(
                    types.Content(
                        role="user",
                        parts=[types.Part.from_function_response(
                            name=msg["tool_name"],
                            response={"result": msg["content"]},
                        )],
                    )
                )
            elif role == "assistant_tool_call":
                # Re-emit the assistant's tool-call turn so Gemini sees the flow
                contents.append(
                    types.Content(
                        role="model",
                        parts=[types.Part.from_function_call(
                            name=msg["tool_name"],
                            args=msg["tool_args"],
                        )],
                    )
                )
            elif role == "assistant":
                contents.append(
                    types.Content(
                        role="model",
                        parts=[types.Part.from_text(text=msg["content"])],
                    )
                )
            else:
                # user / system
                contents.append(
                    types.Content(
                        role="user",
                        parts=[types.Part.from_text(text=msg["content"])],
                    )
                )

        config = types.GenerateContentConfig(
            system_instruction=system_prompt or "",
            tools=tools or [],
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )

        response = client.models.generate_content(
            model=self.model,
            contents=contents,
            config=config,
        )

        # Parse response
        candidate = response.candidates[0]
        parts = candidate.content.parts if candidate.content and candidate.content.parts else []

        result = LLMResponse(provider_name=self.name, model_name=self.model, raw=response)
        for part in parts:
            if hasattr(part, "function_call") and part.function_call:
                fc = part.function_call
                result.tool_calls.append(ToolCall(
                    name=fc.name,
                    arguments=dict(fc.args) if fc.args else {},
                ))
            elif part.text:
                result.text = (result.text or "") + part.text

        return result


# ---------------------------------------------------------------------------
# OpenAI-compatible provider (works for NVIDIA NIM and OpenRouter)
# ---------------------------------------------------------------------------

class OpenAICompatibleProvider(LLMProvider):
    """Provider for any OpenAI-compatible API (NVIDIA NIM, OpenRouter, etc.)."""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        name: str,
        model: str,
        extra_headers: dict | None = None,
    ) -> None:
        self.name = name
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        self.extra_headers = extra_headers or {}
        self._cooldown_until = 0.0

    def generate(
        self,
        messages: list[dict],
        tools: list[Callable] | None = None,
        system_prompt: str | None = None,
    ) -> LLMResponse:
        from openai import OpenAI

        client = OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            default_headers=self.extra_headers or None,
            max_retries=0,
        )

        # Build OpenAI-format messages
        oai_messages: list[dict[str, Any]] = []
        if system_prompt:
            oai_messages.append({"role": "system", "content": system_prompt})

        for msg in messages:
            role = msg["role"]
            if role == "tool_result":
                oai_messages.append({
                    "role": "tool",
                    "tool_call_id": msg.get("tool_call_id", msg["tool_name"]),
                    "content": str(msg["content"]),
                })
            elif role == "assistant_tool_call":
                oai_messages.append({
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": msg.get("tool_call_id", msg["tool_name"]),
                        "type": "function",
                        "function": {
                            "name": msg["tool_name"],
                            "arguments": json.dumps(msg["tool_args"]),
                        },
                    }],
                })
            elif role == "assistant":
                oai_messages.append({"role": "assistant", "content": msg["content"]})
            else:
                oai_messages.append({"role": "user", "content": msg["content"]})

        # Build tool schemas
        tool_schemas = _python_tools_to_openai_schema(tools) if tools else []

        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": oai_messages,
        }
        if tool_schemas:
            kwargs["tools"] = tool_schemas

        response = client.chat.completions.create(**kwargs)

        # Parse response
        choice = response.choices[0]
        result = LLMResponse(
            provider_name=self.name,
            model_name=self.model,
            raw=response,
        )

        if choice.message.content:
            result.text = choice.message.content

        if choice.message.tool_calls:
            for tc in choice.message.tool_calls:
                try:
                    args = json.loads(tc.function.arguments) if tc.function.arguments else {}
                except json.JSONDecodeError:
                    args = {}
                result.tool_calls.append(ToolCall(
                    name=tc.function.name,
                    arguments=args,
                ))

        return result


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

class LLMRouter:
    """Orchestrates multiple LLM providers with automatic failover.

    On rate-limit (429) or server errors (503), the failing provider enters
    a cooldown window and the next available provider is tried.
    """

    def __init__(self) -> None:
        self.providers: list[LLMProvider] = []
        self._init_providers()
        self.logs: list[dict] = []
        print(f"[LLMRouter] Initialised with {len(self.providers)} providers: "
              f"{[p.name for p in self.providers]}")

    def _init_providers(self) -> None:
        # Gemini (primary)
        if settings.gemini_api_key:
            self.providers.append(GeminiProvider(
                api_key=settings.gemini_api_key,
                name="gemini",
                model=settings.gemini_model,
            ))

        # NVIDIA NIM (DeepSeek V4 Flash — fallback #1, fastest at ~0.5s)
        if settings.nvidia_nim_api_key:
            self.providers.append(OpenAICompatibleProvider(
                api_key=settings.nvidia_nim_api_key,
                base_url="https://integrate.api.nvidia.com/v1",
                name="nvidia-nim",
                model=settings.nvidia_nim_model,
            ))

        # OpenRouter (DeepSeek V4 Flash — fallback #2)
        if settings.openrouter_api_key:
            self.providers.append(OpenAICompatibleProvider(
                api_key=settings.openrouter_api_key,
                base_url="https://openrouter.ai/api/v1",
                name="openrouter",
                model=settings.openrouter_model,
                extra_headers={
                    "HTTP-Referer": "http://localhost:3000",
                    "X-Title": "Runtime Agent",
                },
            ))

    def generate(
        self,
        messages: list[dict],
        tools: list[Callable] | None = None,
        system_prompt: str | None = None,
        anomaly_id: str | None = None,
    ) -> LLMResponse:
        """Try each provider in priority order until one succeeds."""
        errors: list[str] = []

        def utc_now_iso() -> str:
            from datetime import datetime, timezone
            return datetime.now(timezone.utc).isoformat()

        attempt_num = 0
        for provider in self.providers:
            if not provider.is_available:
                self.logs.append({
                    "timestamp": utc_now_iso(),
                    "provider": provider.name,
                    "model": provider.model,
                    "attempt": attempt_num + 1,
                    "anomaly_id": anomaly_id or "chat",
                    "status": "cooling down",
                })
                self.logs = self.logs[-200:]
                errors.append(f"{provider.name}: cooling down")
                continue

            attempt_num += 1
            start_time = time.time()
            try:
                print(f"[LLMRouter] Trying {provider.name} ({provider.model})...")
                response = provider.generate(messages, tools, system_prompt)
                print(f"[LLMRouter] [OK] Success via {provider.name}")

                self.logs.append({
                    "timestamp": utc_now_iso(),
                    "provider": provider.name,
                    "model": provider.model,
                    "attempt": attempt_num,
                    "anomaly_id": anomaly_id or "chat",
                    "status": "success",
                    "duration_ms": round((time.time() - start_time) * 1000, 1),
                })
                self.logs = self.logs[-200:]
                return response

            except Exception as e:
                err_str = str(e)
                self.logs.append({
                    "timestamp": utc_now_iso(),
                    "provider": provider.name,
                    "model": provider.model,
                    "attempt": attempt_num,
                    "anomaly_id": anomaly_id or "chat",
                    "status": "failed",
                    "error": err_str[:150],
                    "duration_ms": round((time.time() - start_time) * 1000, 1),
                })
                self.logs = self.logs[-200:]

                is_rate_limit = any(code in err_str for code in ["429", "503", "RESOURCE_EXHAUSTED", "rate_limit", "quota"])
                is_transient = "temporar" in err_str.lower() or "overloaded" in err_str.lower()

                if is_rate_limit or is_transient:
                    provider.enter_cooldown(60.0)
                    errors.append(f"{provider.name}: rate-limited ({err_str[:100]})")
                    print(f"[LLMRouter] [Error] {provider.name} rate-limited, trying next...")
                else:
                    # Non-rate-limit error — short cooldown, might be a transient API issue
                    provider.enter_cooldown(10.0)
                    errors.append(f"{provider.name}: error ({err_str[:150]})")
                    print(f"[LLMRouter] [Error] {provider.name} error: {err_str[:150]}")

        # All providers failed
        raise RuntimeError(
            f"All LLM providers failed.\n"
            + "\n".join(f"  - {e}" for e in errors)
        )

    def generate_simple(self, prompt: str, system_prompt: str | None = None) -> str:
        """Convenience method for simple text-in/text-out calls (e.g. chat)."""
        messages = [{"role": "user", "content": prompt}]
        response = self.generate(messages, tools=None, system_prompt=system_prompt)
        return response.text or ""

    def status(self) -> list[dict]:
        """Return the current status of all providers (for debugging/monitoring)."""
        now = time.time()
        return [
            {
                "name": p.name,
                "model": p.model,
                "available": p.is_available,
                "cooldown_remaining": max(0, round(p._cooldown_until - now, 1)),
            }
            for p in self.providers
        ]


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------
router = LLMRouter()
