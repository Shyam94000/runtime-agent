#!/bin/bash
echo "Starting AI Runtime Monitor Demo..."

# 1. Start Frontend (Background)
echo "Starting Frontend on port 3000..."
cd frontend
npm install
npm run dev &
FRONTEND_PID=$!
cd ..

# 2. Start Target App (Background)
echo "Starting Target App on port 3001..."
cd target-app
npm install
node src/index.js &
TARGET_PID=$!
cd ..

# 3. Start Agent Backend (Foreground)
echo "Starting Agent Backend on port 8000..."
cd agent-backend
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --port 8000 &
BACKEND_PID=$!
cd ..

echo "----------------------------------------"
echo "All services started successfully!"
echo "Frontend Dashboard: http://localhost:3000"
echo "Target App UI:      http://localhost:3001"
echo "Agent Backend:      http://localhost:8000"
echo "----------------------------------------"
echo "Press Ctrl+C to stop all services."

# Wait for all background processes
wait $FRONTEND_PID $TARGET_PID $BACKEND_PID
