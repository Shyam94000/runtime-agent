# AI Runtime Monitor 

An autonomous AI agent designed to diagnose performance incidents (CPU spikes, memory leaks) in Node.js applications at runtime. The system uses native V8 profiling, Tree-sitter AST parsing, and the Gemini 3.1 Pro API to instantly pinpoint root causes in your source code without requiring manual investigation.

## System Architecture

The project consists of three main components:

### 1. Target Application (`/target-app`)
A Node.js Express server acting as the monitored service. It exposes several endpoints that intentionally trigger performance bottlenecks:
- `GET /api/cpu-heavy`: Triggers an $O(2^n)$ Fibonacci calculation to simulate CPU pegging.
- `GET /api/memory-leak`: Leaks a 1MB Buffer into an array to simulate uncollected garbage over time.
- **V8 Built-in Endpoints:** Provides native `/api/profile` (CPU profiling) and `/api/heap-snapshot` (memory profiling) using `node:inspector` and `node:v8`.

### 2. Agentic Backend (`/agent-backend`)
A Python FastAPI server that acts as the "brain".
- **Runtime Monitor:** Continuously polls the target app for telemetry (CPU, Memory, Active Requests).
- **Tree-sitter Parsing:** Dynamically analyzes the target app's AST to identify exact function boundaries, definitions, and surrounding context.
- **Diagnostic Agent:** A multi-step autonomous loop powered by Gemini 3.1 Pro. Instead of vector databases, it utilizes a full-context injection strategy (`AgentMemory`) to insert all relevant metrics, prior anomalies, and relevant source code into the context window.
- **Chat Endpoint:** Allows operators to interrogate the agent directly about runtime performance and anomalies.

### 3. Frontend UI (`/frontend`)
A modern Next.js 14 web interface featuring dark-mode glassmorphism and `framer-motion` animations.
- **Dashboard:** Live metric charts.
- **Diagnostics:** Feed of historical anomalies and detailed root-cause analysis reports.
- **Agent Chat:** Direct conversational interface with the autonomous backend, allowing you to ask questions like *"What does fibonacci do?"*

## Setup & Installation

### Prerequisites
- Node.js v20+
- Python 3.11+
- A valid Gemini API Key (`GEMINI_API_KEY`)

### 1. Target Application
```bash
cd target-app
npm install
npm run start # runs on port 3001
```

### 2. Agent Backend
```bash
cd agent-backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Create .env file
cp .env.example .env
# Edit .env and insert your GEMINI_API_KEY

uvicorn app.main:app --port 8000
```

### 3. Frontend UI
```bash
cd frontend
npm install
npm run dev # runs on port 3000
```

## How to Test
1. Start all three services as detailed above.
2. Visit the Target App UI at `http://localhost:3001` and click **"Simulate CPU Spike"** or **"Simulate Memory Leak"**.
3. Visit the Frontend Dashboard at `http://localhost:3000`. You will see the metrics spike.
4. The backend will detect the anomaly, invoke the Agentic Loop, and trace the issue back to the source code.
5. Click on the **Diagnostics** tab to view the generated root-cause report.
6. Click on the **Agent Chat** tab to interrogate the Agent.

## License
MIT License
