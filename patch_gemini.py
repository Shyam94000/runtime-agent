import re

with open("agent-backend/app/gemini_agent.py", "r") as f:
    content = f.read()

# Add import
content = content.replace("from app.agent_memory import AgentMemory\n", "from app.agent_memory import AgentMemory\nfrom app.pricing import estimate_cost\n")

# Update _run_single_call_diagnosis
content = content.replace(
    '            reasoning=str(payload.get("root_cause_summary") or "Single-call diagnosis completed."),\n            duration_ms=(time.time() - start_time) * 1000,\n        ))',
    '            reasoning=str(payload.get("root_cause_summary") or "Single-call diagnosis completed."),\n            duration_ms=(time.time() - start_time) * 1000,\n            input_tokens=response.input_tokens,\n            output_tokens=response.output_tokens,\n        ))\n        trace.total_input_tokens = response.input_tokens\n        trace.total_output_tokens = response.output_tokens\n        trace.total_tokens = response.total_tokens\n        trace.estimated_cost_usd = estimate_cost(response.model_name, response.input_tokens, response.output_tokens)'
)

# Update _run_agent_loop - tool call
content = content.replace(
    '                    tool_args=tool_args,\n                    duration_ms=(time.time() - start_time) * 1000,\n                )',
    '                    tool_args=tool_args,\n                    duration_ms=(time.time() - start_time) * 1000,\n                    input_tokens=response.input_tokens,\n                    output_tokens=response.output_tokens,\n                )'
)

# Update _run_agent_loop - submit diagnosis accumulation
content = content.replace(
    '                if tool_name == "submit_diagnosis":\n                    trace.status = "completed"\n                    trace.completed_at = utc_now()\n                    trace.total_steps = len(trace.steps)',
    '                if tool_name == "submit_diagnosis":\n                    trace.status = "completed"\n                    trace.completed_at = utc_now()\n                    trace.total_steps = len(trace.steps)\n                    trace.total_input_tokens = sum(s.input_tokens for s in trace.steps)\n                    trace.total_output_tokens = sum(s.output_tokens for s in trace.steps)\n                    trace.total_tokens = trace.total_input_tokens + trace.total_output_tokens\n                    trace.estimated_cost_usd = estimate_cost(actual_model, trace.total_input_tokens, trace.total_output_tokens)'
)

# Update _run_agent_loop - thinking step
content = content.replace(
    '                    reasoning=response.text[:1000],\n                    duration_ms=(time.time() - start_time) * 1000,\n                ))',
    '                    reasoning=response.text[:1000],\n                    duration_ms=(time.time() - start_time) * 1000,\n                    input_tokens=response.input_tokens,\n                    output_tokens=response.output_tokens,\n                ))'
)

# Update _run_agent_loop - final accumulation
content = content.replace(
    '        trace.status = "failed"\n        trace.completed_at = utc_now()\n        trace.total_steps = len(trace.steps)',
    '        trace.status = "failed"\n        trace.completed_at = utc_now()\n        trace.total_steps = len(trace.steps)\n        trace.total_input_tokens = sum(s.input_tokens for s in trace.steps)\n        trace.total_output_tokens = sum(s.output_tokens for s in trace.steps)\n        trace.total_tokens = trace.total_input_tokens + trace.total_output_tokens\n        trace.estimated_cost_usd = estimate_cost(actual_model, trace.total_input_tokens, trace.total_output_tokens)'
)

with open("agent-backend/app/gemini_agent.py", "w") as f:
    f.write(content)
