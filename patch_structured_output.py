import re

with open("agent-backend/app/gemini_agent.py", "r") as f:
    content = f.read()

# Replace _parse_json_response with structured output configuration
schema_import = """from pydantic import BaseModel, Field
from app.agent_memory import AgentMemory
"""
content = content.replace("from app.agent_memory import AgentMemory\n", schema_import)

diagnostic_schema = """
class DiagnosticResponseSchema(BaseModel):
    root_cause_summary: str = Field(description="A short summary of the root cause.")
    root_cause_function: str = Field(description="The function name where the anomaly originated.", default="")
    root_cause_file: str = Field(description="The file name where the anomaly originated.", default="")
    root_cause_lines: str = Field(description="The line numbers where the anomaly originated.", default="")
    explanation: str = Field(description="A detailed explanation of the root cause.")
    suggested_fix: str = Field(description="A suggested fix for the anomaly.")
    fix_justification: str = Field(description="A justification for the suggested fix.")
    confidence_score: float = Field(description="Confidence score between 0.0 and 1.0.", default=0.75)

"""

content = content.replace("class AgenticDiagnosticAgent:\n", diagnostic_schema + "class AgenticDiagnosticAgent:\n")

# Update _run_single_call_diagnosis
single_call_update = """        start_time = time.time()
        response = router.generate(
            messages=[{"role": "user", "content": prompt}],
            tools=None,
            system_prompt=SINGLE_CALL_DIAGNOSIS_SYSTEM_PROMPT,
            anomaly_id=anomaly.id,
            response_schema=DiagnosticResponseSchema
        )
        actual_model = f"{response.provider_name}/{response.model_name}"
        trace.model_used = actual_model
        
        try:
            payload = json.loads(response.text or "{}")
        except json.JSONDecodeError:
            payload = {}"""

content = re.sub(
    r'        start_time = time\.time\(\)\s+response = router\.generate\([\s\S]*?payload = self\._parse_json_response\(response\.text or ""\)',
    single_call_update,
    content
)

# Remove _parse_json_response
content = re.sub(
    r'    def _parse_json_response[\s\S]*?return parsed\n\n',
    '',
    content
)

with open("agent-backend/app/gemini_agent.py", "w") as f:
    f.write(content)

# Update llm_router.py to support response_schema
with open("agent-backend/app/llm_router.py", "r") as f:
    router_content = f.read()

# Update generate signatures
router_content = router_content.replace(
    '        system_prompt: str | None = None,\n    ) -> LLMResponse:',
    '        system_prompt: str | None = None,\n        response_schema: Any = None,\n    ) -> LLMResponse:'
)

router_content = router_content.replace(
    '        system_prompt: str | None = None,\n        anomaly_id: str | None = None,\n    ) -> LLMResponse:',
    '        system_prompt: str | None = None,\n        anomaly_id: str | None = None,\n        response_schema: Any = None,\n    ) -> LLMResponse:'
)

# Update GeminiProvider
gemini_config = """        config = types.GenerateContentConfig(
            system_instruction=system_prompt or "",
            tools=tools or [],
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
        if response_schema:
            config.response_mime_type = "application/json"
            config.response_schema = response_schema"""

router_content = router_content.replace(
    '        config = types.GenerateContentConfig(\n            system_instruction=system_prompt or "",\n            tools=tools or [],\n            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),\n        )',
    gemini_config
)

# Update OpenAICompatibleProvider
openai_config = """        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": oai_messages,
        }
        if tool_schemas:
            kwargs["tools"] = tool_schemas
        
        # Note: OpenRouter/NIM might have varying support for response_format, 
        # but standard OpenAI schema format is used here
        if response_schema:
            kwargs["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": response_schema.__name__,
                    "schema": response_schema.model_json_schema()
                }
            }"""

router_content = re.sub(
    r'        kwargs: dict\[str, Any\] = {[\s\S]*?kwargs\["tools"\] = tool_schemas',
    openai_config,
    router_content
)

# Update LLMRouter generate call
router_content = router_content.replace(
    '                response = provider.generate(messages, tools, system_prompt)',
    '                response = provider.generate(messages, tools, system_prompt, response_schema=response_schema)'
)

with open("agent-backend/app/llm_router.py", "w") as f:
    f.write(router_content)
