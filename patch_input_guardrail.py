with open("agent-backend/app/main.py", "r") as f:
    content = f.read()

guardrail = """    if len(request.message) > 2000:
        return {"role": "agent", "content": "Error: Message is too long (max 2000 characters).", "timestamp": utc_now().isoformat()}
        
    # Basic system prompt injection protection
    suspicious_patterns = [
        "ignore previous instructions",
        "you are now",
        "forget everything",
        "system prompt"
    ]
    if any(p in request.message.lower() for p in suspicious_patterns):
        return {"role": "agent", "content": "I am a diagnostic agent and cannot process requests to change my core instructions.", "timestamp": utc_now().isoformat()}

"""

content = content.replace("    if monitor.config.llm_kill_switch:\n        return", guardrail + "    if monitor.config.llm_kill_switch:\n        return")

with open("agent-backend/app/main.py", "w") as f:
    f.write(content)
