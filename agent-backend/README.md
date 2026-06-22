# Agent Backend

FastAPI backend for the AI Runtime Monitoring Agent demo.

## Run

```bash
cd /Users/shyam/RND/ai-runtime-monitor/agent-backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --reload --port 8000
```

The backend polls the target app at `http://localhost:3001/api/metrics`, stores recent metrics and anomalies in memory, persists diagnostics to `data/runtime-monitor.json`, and calls Gemini when `GEMINI_API_KEY` is set. By default it uses `GEMINI_MODEL=gemini-3-flash-preview`. If Gemini is unavailable, it returns a deterministic local diagnosis so the demo remains usable.
