import re

with open("agent-backend/app/llm_router.py", "r") as f:
    content = f.read()

# Add streaming to GeminiProvider
gemini_stream = """
    def stream(self, messages: list[dict], system_prompt: str | None = None):
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=self.api_key, http_options={'retry_options': {'attempts': 1}})
        
        contents = []
        for msg in messages:
            contents.append(types.Content(role=msg["role"] if msg["role"] == "model" else "user", parts=[types.Part.from_text(text=msg["content"])]))
            
        config = types.GenerateContentConfig(system_instruction=system_prompt or "")
        
        try:
            response = client.models.generate_content_stream(model=self.model, contents=contents, config=config)
            for chunk in response:
                if chunk.text:
                    yield chunk.text
        except Exception as e:
            raise e
"""

content = content.replace(
    '        return result\n\n\n# ---------------------------------------------------------------------------\n# OpenAI-compatible',
    '        return result\n' + gemini_stream + '\n\n# ---------------------------------------------------------------------------\n# OpenAI-compatible'
)

# Add streaming to OpenAICompatibleProvider
openai_stream = """
    def stream(self, messages: list[dict], system_prompt: str | None = None):
        from openai import OpenAI
        client = OpenAI(api_key=self.api_key, base_url=self.base_url, default_headers=self.extra_headers or None, max_retries=0)
        
        oai_messages = []
        if system_prompt:
            oai_messages.append({"role": "system", "content": system_prompt})
        for msg in messages:
            oai_messages.append({"role": "assistant" if msg["role"] == "model" else "user", "content": msg["content"]})
            
        try:
            response = client.chat.completions.create(model=self.model, messages=oai_messages, stream=True)
            for chunk in response:
                if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as e:
            raise e
"""

content = content.replace(
    '        return result\n\n\n# ---------------------------------------------------------------------------\n# Router',
    '        return result\n' + openai_stream + '\n\n# ---------------------------------------------------------------------------\n# Router'
)

# Add generate_stream to LLMRouter
router_stream = """
    def generate_stream(self, prompt: str, system_prompt: str | None = None):
        messages = [{"role": "user", "content": prompt}]
        for provider in self.providers:
            if not provider.is_available:
                continue
            try:
                print(f"[LLMRouter] Streaming via {provider.name} ({provider.model})...")
                return provider.stream(messages, system_prompt)
            except Exception as e:
                print(f"[LLMRouter] [Error] Streaming failed via {provider.name}: {e}")
                provider.enter_cooldown(10.0)
        raise RuntimeError("All LLM providers failed to stream.")
"""

content = content.replace(
    '        messages = [{"role": "user", "content": prompt}]\n        return self.generate(messages, tools=None, system_prompt=system_prompt)',
    '        messages = [{"role": "user", "content": prompt}]\n        return self.generate(messages, tools=None, system_prompt=system_prompt)\n' + router_stream
)

with open("agent-backend/app/llm_router.py", "w") as f:
    f.write(content)
