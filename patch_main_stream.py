import re

with open("agent-backend/app/main.py", "r") as f:
    content = f.read()

# Add StreamingResponse import
content = content.replace(
    "from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect",
    "from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect\nfrom fastapi.responses import StreamingResponse"
)

stream_endpoint = """
@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    from app.models import utc_now
    
    if not llm_router.providers:
        raise HTTPException(status_code=503, detail="No LLM providers configured")
        
    full_context = monitor.memory.build_full_context()
    prompt = f"CONTEXT:\\n{full_context}\\n\\nUSER QUESTION:\\n{request.message}"
    
    def generate():
        generator = llm_router.generate_stream(prompt=prompt, system_prompt=CHAT_SYSTEM_PROMPT)
        for chunk in generator:
            yield chunk

    return StreamingResponse(generate(), media_type="text/event-stream")

"""

content = content.replace("@app.post(\"/api/chat\")", stream_endpoint + "@app.post(\"/api/chat\")")

with open("agent-backend/app/main.py", "w") as f:
    f.write(content)
