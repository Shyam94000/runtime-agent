from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.models import MonitorConfig, ChatRequest, ApplyFixRequest
from app.prompts import CHAT_SYSTEM_PROMPT
from app.monitor import monitor
from app.llm_router import router as llm_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.auto_start_monitor:
        await monitor.start()
    yield
    await monitor.stop()


app = FastAPI(
    title="AI Runtime Monitoring Agent",
    version="2.0.0",
    description="Runtime metrics polling, anomaly detection, and AI diagnosis with multi-provider LLM failover.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok", "monitoring_active": monitor.monitoring_active}


@app.get("/api/status")
async def status():
    return monitor.status()


@app.get("/api/metrics")
async def metrics(minutes: int = Query(default=30, ge=1, le=24 * 60)):
    return monitor.metric_points(minutes=minutes)


@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket):
    await monitor.connect_client(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        monitor.disconnect_client(websocket)


@app.get("/api/logs")
async def get_logs():
    return llm_router.logs


@app.get("/api/metrics/current")
async def current_metrics():
    latest = monitor.latest_point()
    if latest:
        return latest
    snapshot = await monitor.poll_once()
    if snapshot:
        return monitor.latest_point()
    raise HTTPException(status_code=503, detail=monitor.last_error or "No metrics available yet")


@app.get("/api/anomalies")
async def anomalies():
    return monitor.anomalies


@app.get("/api/diagnostics")
async def diagnostics():
    return monitor.diagnostics


@app.delete("/api/diagnostics")
async def clear_diagnostics():
    monitor.clear_all()
    return {"status": "cleared"}


@app.get("/api/diagnostics/{diagnostic_id}")
async def diagnostic_detail(diagnostic_id: str):
    report = monitor.get_diagnostic(diagnostic_id)
    if not report:
        raise HTTPException(status_code=404, detail="Diagnostic report not found")
    return report


@app.post("/api/diagnose/{anomaly_id}")
async def diagnose(anomaly_id: str):
    try:
        return await monitor.diagnose_anomaly(anomaly_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Anomaly not found")


@app.get("/api/config")
async def get_config():
    return monitor.config


@app.put("/api/config")
async def update_config(config: MonitorConfig):
    return monitor.update_config(config)


@app.post("/api/poll")
async def poll_now():
    snapshot = await monitor.poll_once()
    if not snapshot:
        raise HTTPException(status_code=503, detail=monitor.last_error or "Target app unavailable")
    return snapshot


@app.post("/api/monitor/start")
async def start_monitoring():
    await monitor.start()
    return monitor.status()


@app.post("/api/monitor/stop")
async def stop_monitoring():
    await monitor.stop()
    return monitor.status()


@app.get("/api/traces")
async def traces():
    return monitor.agent_traces


@app.get("/api/traces/{trace_id}")
async def trace_detail(trace_id: str):
    trace = monitor.get_trace(trace_id)
    if not trace:
        raise HTTPException(status_code=404, detail="Trace not found")
    return trace


@app.get("/api/diagnostics/{diagnostic_id}/trace")
async def diagnostic_trace(diagnostic_id: str):
    trace = monitor.get_trace_for_diagnostic(diagnostic_id)
    if not trace:
        raise HTTPException(status_code=404, detail="Trace not found for diagnostic")
    return trace


@app.get("/api/providers")
async def provider_status():
    """Check the status of all configured LLM providers."""
    return llm_router.status()


@app.get("/api/usage")
async def usage_stats():
    """Aggregate token usage and cost statistics from agent traces."""
    from app.pricing import estimate_cost

    total_input = 0
    total_output = 0
    total_cost = 0.0
    by_model: dict[str, dict] = {}

    for trace in monitor.agent_traces:
        total_input += trace.total_input_tokens
        total_output += trace.total_output_tokens
        total_cost += trace.estimated_cost_usd

        model = trace.model_used or "unknown"
        if model not in by_model:
            by_model[model] = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "cost_usd": 0.0, "calls": 0}
        by_model[model]["input_tokens"] += trace.total_input_tokens
        by_model[model]["output_tokens"] += trace.total_output_tokens
        by_model[model]["total_tokens"] += trace.total_input_tokens + trace.total_output_tokens
        by_model[model]["cost_usd"] += trace.estimated_cost_usd
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



@app.get("/api/usage")
async def usage_stats():
    """Aggregate token usage and cost statistics from agent traces."""
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


@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    from app.models import utc_now
    
    if not llm_router.providers:
        raise HTTPException(status_code=503, detail="No LLM providers configured")
        
    full_context = monitor.memory.build_full_context()
    prompt = f"CONTEXT:\n{full_context}\n\nUSER QUESTION:\n{request.message}"
    
    def generate():
        generator = llm_router.generate_stream(prompt=prompt, system_prompt=CHAT_SYSTEM_PROMPT)
        for chunk in generator:
            yield chunk

    return StreamingResponse(generate(), media_type="text/event-stream")

@app.post("/api/chat")
async def chat(request: ChatRequest):
    from app.models import utc_now

    if not llm_router.providers:
        return {"role": "agent", "content": "Chat requires at least one LLM API key to be configured.", "timestamp": utc_now().isoformat()}

    if len(request.message) > 2000:
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

    if monitor.config.llm_kill_switch:
        return {"role": "agent", "content": "Chat is currently disabled because the LLM Kill Switch is enabled in settings.", "timestamp": utc_now().isoformat()}

    try:
        full_context = monitor.memory.build_full_context()
        prompt = f"CONTEXT:\n{full_context}\n\nUSER QUESTION:\n{request.message}"

        response = llm_router.generate_simple(
            prompt=prompt,
            system_prompt=CHAT_SYSTEM_PROMPT,
        )

        return {
            "role": "agent",
            "content": response.text or "",
            "timestamp": utc_now().isoformat(),
            "tokens": {
                "input": response.input_tokens,
                "output": response.output_tokens,
                "total": response.total_tokens,
            },
            "model": f"{response.provider_name}/{response.model_name}",
        }
    except Exception as e:
        return {"role": "agent", "content": f"Error: {str(e)}", "timestamp": utc_now().isoformat()}

@app.get("/api/fixes")
async def get_fixes():
    return [fix.model_dump() for fix in monitor.fixes]

@app.delete("/api/fixes/{fix_id}")
async def delete_fix(fix_id: str):
    monitor.fixes = [f for f in monitor.fixes if f.id != fix_id]
    monitor.store.delete_fix(fix_id)
    return {"status": "success"}

@app.post("/api/fixes/apply")
async def apply_fix(req: ApplyFixRequest):
    import os
    import subprocess
    import tempfile
    import httpx
    from app.models import FixRecord

    report = monitor.get_diagnostic(req.diagnostic_id)
    if not report:
        raise HTTPException(status_code=404, detail="Diagnostic report not found")
        
    diff = report.suggested_fix
    if not diff:
        raise HTTPException(status_code=400, detail="No suggested fix available in report")
        
    repo = monitor.config.github_repo
    token = monitor.config.github_token
    if not token or not repo:
        raise HTTPException(status_code=400, detail="GitHub Token or Repo not configured")
        
    import re
    import base64
    import httpx
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28"
    }
    
    async with httpx.AsyncClient() as client:
        # 1. Get main branch SHA
        ref_url = f"https://api.github.com/repos/{repo}/git/refs/heads/main"
        resp = await client.get(ref_url, headers=headers)
        if resp.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Failed to fetch main branch: {resp.text}")
        main_sha = resp.json()["object"]["sha"]
        
        # 2. Create new branch
        branch_url = f"https://api.github.com/repos/{repo}/git/refs"
        branch_data = {
            "ref": f"refs/heads/{req.branch_name}",
            "sha": main_sha
        }
        resp = await client.post(branch_url, headers=headers, json=branch_data)
        if resp.status_code not in (201, 422): # 422 might mean it already exists, which is fine, we'll overwrite the file
            raise HTTPException(status_code=500, detail=f"Failed to create branch: {resp.text}")
            
        # 3. Extract file path from diff
        file_path_match = re.search(r'^\+\+\+ b/(.*?)$', diff, re.MULTILINE)
        if not file_path_match:
            raise HTTPException(status_code=400, detail="Could not parse file path from diff")
        rel_path = file_path_match.group(1).strip()
        # Since the LLM diff might assume 'src/...', we assume the repo root structure. 
        # But wait, if the repo root IS the target-app, we might need to prepend 'src/' if rel_path doesn't have it and it should.
        # Actually, let's just try to fetch the file at `rel_path`, if 404, try `src/` + rel_path.
        
        content_url = f"https://api.github.com/repos/{repo}/contents/{rel_path}?ref={req.branch_name}"
        resp = await client.get(content_url, headers=headers)
        if resp.status_code == 404:
            rel_path = f"src/{rel_path}"
            content_url = f"https://api.github.com/repos/{repo}/contents/{rel_path}?ref={req.branch_name}"
            resp = await client.get(content_url, headers=headers)
            
        if resp.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Failed to fetch file content: {resp.text}")
            
        file_info = resp.json()
        file_sha = file_info["sha"]
        content_b64 = file_info["content"]
        content = base64.b64decode(content_b64).decode('utf-8')
        
        # 4. Patch file content
        lines = diff.splitlines()
        minus_lines = [l[1:] for l in lines if l.startswith('-') and not l.startswith('---')]
        plus_lines = [l[1:] for l in lines if l.startswith('+') and not l.startswith('+++')]
        
        content_lines = content.splitlines()
        match_start = -1
        if minus_lines:
            for i in range(len(content_lines) - len(minus_lines) + 1):
                match = True
                for j in range(len(minus_lines)):
                    if content_lines[i+j].strip() != minus_lines[j].strip():
                        match = False
                        break
                if match:
                    match_start = i
                    break
                    
        if match_start != -1:
            new_content_lines = content_lines[:match_start] + plus_lines + content_lines[match_start+len(minus_lines):]
            new_content = '\n'.join(new_content_lines) + '\n'
        else:
            raise HTTPException(status_code=400, detail="Could not find matching block in file to replace")
            
        # 5. Commit updated file
        update_data = {
            "message": req.commit_message,
            "content": base64.b64encode(new_content.encode('utf-8')).decode('utf-8'),
            "sha": file_sha,
            "branch": req.branch_name
        }
        resp = await client.put(content_url, headers=headers, json=update_data)
        if resp.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Failed to update file: {resp.text}")
            
        # 6. Create PR
        pr_url = f"https://api.github.com/repos/{repo}/pulls"
        pr_data = {
            "title": req.commit_message,
            "body": getattr(report, "explanation", "Automated fix generated by Runtime Agent"),
            "head": req.branch_name,
            "base": "main"
        }
        resp = await client.post(pr_url, headers=headers, json=pr_data)
            
        if resp.status_code >= 400:
            raise HTTPException(status_code=500, detail=f"Failed to create PR: {resp.text}")
            
        pr_data = resp.json()
        pr_url = pr_data.get("html_url")
        pr_number = pr_data.get("number")
        
        # Save fix to backend database
        fix_record = FixRecord(
            id=req.diagnostic_id,
            prNumber=pr_number,
            branchName=req.branch_name,
            title=req.commit_message,
            file=getattr(report, "root_cause_file", ""),
            severity=getattr(report, "severity", "high"),
            status="open",
            prUrl=pr_url
        )
        # Remove old fix if present
        monitor.fixes = [f for f in monitor.fixes if f.id != req.diagnostic_id]
        monitor.fixes.insert(0, fix_record)
        monitor._save()
        
        return {
            "status": "success",
            "pr_url": pr_url,
            "pr_number": pr_number
        }
