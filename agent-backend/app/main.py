from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.models import MonitorConfig, ChatRequest
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
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3002",
        "http://127.0.0.1:3002",
    ],
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


@app.post("/api/chat")
async def chat(request: ChatRequest):
    from app.models import utc_now

    if not llm_router.providers:
        return {"role": "agent", "content": "Chat requires at least one LLM API key to be configured.", "timestamp": utc_now().isoformat()}

    if monitor.config.llm_kill_switch:
        return {"role": "agent", "content": "Chat is currently disabled because the LLM Kill Switch is enabled in settings.", "timestamp": utc_now().isoformat()}

    try:
        full_context = monitor.memory.build_full_context()
        prompt = f"CONTEXT:\n{full_context}\n\nUSER QUESTION:\n{request.message}"

        response_text = llm_router.generate_simple(
            prompt=prompt,
            system_prompt=CHAT_SYSTEM_PROMPT,
        )

        return {"role": "agent", "content": response_text, "timestamp": utc_now().isoformat()}
    except Exception as e:
        return {"role": "agent", "content": f"Error: {str(e)}", "timestamp": utc_now().isoformat()}

