import re

with open("agent-backend/app/main.py", "r") as f:
    content = f.read()

usage_endpoint = """
@app.get("/api/usage")
async def usage_stats():
    \"\"\"Aggregate token usage and cost statistics from agent traces.\"\"\"
    from app.pricing import estimate_cost

    total_input = 0
    total_output = 0
    total_cost = 0.0
    by_model: dict[str, dict] = {}

    for trace in monitor.agent_traces:
        total_input += getattr(trace, 'total_input_tokens', 0)
        total_output += getattr(trace, 'total_output_tokens', 0)
        total_cost += getattr(trace, 'estimated_cost_usd', 0.0)

        model = trace.model_used or "unknown"
        if model not in by_model:
            by_model[model] = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "cost_usd": 0.0, "calls": 0}
        by_model[model]["input_tokens"] += getattr(trace, 'total_input_tokens', 0)
        by_model[model]["output_tokens"] += getattr(trace, 'total_output_tokens', 0)
        by_model[model]["total_tokens"] += getattr(trace, 'total_input_tokens', 0) + getattr(trace, 'total_output_tokens', 0)
        by_model[model]["cost_usd"] += getattr(trace, 'estimated_cost_usd', 0.0)
        by_model[model]["calls"] += 1

    # Also tally chat usage from router logs
    chat_tokens = {"input": 0, "output": 0, "total": 0}
    for log in llm_router.logs:
        if log.get("anomaly_id") == "chat" and log.get("status") == "success":
            chat_tokens["input"] += log.get("input_tokens", 0)
            chat_tokens["output"] += log.get("output_tokens", 0)
            chat_tokens["total"] += log.get("total_tokens", 0)

    return {
        "diagnostics": {
            "total_input_tokens": total_input,
            "total_output_tokens": total_output,
            "total_tokens": total_input + total_output,
            "total_cost_usd": round(total_cost, 4),
            "total_diagnoses": len(monitor.agent_traces),
        },
        "chat": chat_tokens,
        "by_model": by_model,
    }

"""

content = content.replace("@app.post(\"/api/chat\")", usage_endpoint + "@app.post(\"/api/chat\")")

chat_replace = """        response = llm_router.generate_simple(
            prompt=prompt,
            system_prompt=CHAT_SYSTEM_PROMPT,
        )

        return {
            "role": "agent", 
            "content": response.text or "", 
            "timestamp": utc_now().isoformat(),
            "tokens": {
                "input": getattr(response, "input_tokens", 0),
                "output": getattr(response, "output_tokens", 0),
                "total": getattr(response, "total_tokens", 0),
            },
            "model": f"{response.provider_name}/{response.model_name}"
        }"""

content = re.sub(r'        response_text = llm_router\.generate_simple\([\s\S]*?return {"role": "agent", "content": response_text, "timestamp": utc_now\(\)\.isoformat\(\)}', chat_replace, content)

with open("agent-backend/app/main.py", "w") as f:
    f.write(content)
