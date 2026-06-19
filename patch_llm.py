import re

with open("agent-backend/app/llm_router.py", "r") as f:
    content = f.read()

# Add token fields to LLMResponse
content = content.replace(
    '    model_name: str = ""\n    raw: Any = None  # keep the raw provider response for debugging',
    '    model_name: str = ""\n    raw: Any = None  # keep the raw provider response for debugging\n    input_tokens: int = 0\n    output_tokens: int = 0\n    total_tokens: int = 0'
)

# Add Gemini token extraction
gemini_extract = """
        # Extract token usage from Gemini response
        try:
            usage = getattr(response, 'usage_metadata', None)
            if usage:
                result.input_tokens = getattr(usage, 'prompt_token_count', 0) or 0
                result.output_tokens = getattr(usage, 'candidates_token_count', 0) or 0
                result.total_tokens = getattr(usage, 'total_token_count', 0) or 0
        except Exception:
            pass  # Token extraction is best-effort

        return result
"""
content = content.replace("        return result\n\n\n# ---------------------------------------------------------------------------\n# OpenAI-compatible", gemini_extract + "\n\n# ---------------------------------------------------------------------------\n# OpenAI-compatible")

# Add OpenAI token extraction
openai_extract = """
        # Extract token usage from OpenAI-compatible response
        try:
            usage = getattr(response, 'usage', None)
            if usage:
                result.input_tokens = getattr(usage, 'prompt_tokens', 0) or 0
                result.output_tokens = getattr(usage, 'completion_tokens', 0) or 0
                result.total_tokens = getattr(usage, 'total_tokens', 0) or 0
        except Exception:
            pass  # Token extraction is best-effort

        return result
"""
content = content.replace("        return result\n\n\n# ---------------------------------------------------------------------------\n# Router", openai_extract + "\n\n# ---------------------------------------------------------------------------\n# Router")

# Add tokens to log entry
content = content.replace(
    '                    "status": "success",\n                    "duration_ms": round((time.time() - start_time) * 1000, 1),\n                })',
    '                    "status": "success",\n                    "duration_ms": round((time.time() - start_time) * 1000, 1),\n                    "input_tokens": response.input_tokens,\n                    "output_tokens": response.output_tokens,\n                    "total_tokens": response.total_tokens,\n                })'
)

# Update generate_simple
content = content.replace(
    '    def generate_simple(self, prompt: str, system_prompt: str | None = None) -> str:\n        """Convenience method for simple text-in/text-out calls (e.g. chat)."""\n        messages = [{"role": "user", "content": prompt}]\n        response = self.generate(messages, tools=None, system_prompt=system_prompt)\n        return response.text or ""',
    '    def generate_simple(self, prompt: str, system_prompt: str | None = None):\n        """Convenience method for simple text-in/text-out calls (e.g. chat)."""\n        messages = [{"role": "user", "content": prompt}]\n        return self.generate(messages, tools=None, system_prompt=system_prompt)'
)

with open("agent-backend/app/llm_router.py", "w") as f:
    f.write(content)
