#!/bin/bash
echo "Stopping AI Runtime Monitor services..."

# Ports used by Frontend (3000), Target App (3001), and Agent Backend (8000)
PORTS=(3000 3001 8000)

for PORT in "${PORTS[@]}"; do
  # Find PIDs listening on the specific port
  PIDS=$(lsof -t -i:$PORT)
  if [ -n "$PIDS" ]; then
    echo "Found process(es) running on port $PORT: $PIDS"
    for PID in $PIDS; do
      echo "Sending SIGTERM to PID $PID..."
      kill "$PID" 2>/dev/null
      sleep 0.5
      
      # Double check if process is still alive
      if kill -0 "$PID" 2>/dev/null; then
        echo "Process $PID is still running. Sending SIGKILL..."
        kill -9 "$PID" 2>/dev/null
      fi
    done
  else
    echo "No processes found running on port $PORT."
  fi
done

echo "Done! All services have been stopped."
