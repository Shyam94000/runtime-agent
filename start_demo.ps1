Write-Host "Starting AI Runtime Monitor Demo..."

Write-Host "Starting Frontend on port 3000..."
Start-Process -NoNewWindow -FilePath "npm.cmd" -ArgumentList "install" -WorkingDirectory "frontend" -Wait
Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" -WorkingDirectory "frontend" -WindowStyle Minimized

Write-Host "Starting Target App on port 3001..."
Start-Process -NoNewWindow -FilePath "npm.cmd" -ArgumentList "install" -WorkingDirectory "target-app" -Wait
Start-Process -FilePath "node.exe" -ArgumentList "src/index.js" -WorkingDirectory "target-app" -WindowStyle Minimized

Write-Host "Starting Agent Backend on port 8000..."
Set-Location "agent-backend"
if (!(Test-Path ".venv")) {
    python -m venv .venv
}
.venv\Scripts\activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --port 8000

Write-Host "----------------------------------------"
Write-Host "All services started successfully!"
Write-Host "Frontend Dashboard: http://localhost:3000"
Write-Host "Target App UI:      http://localhost:3001"
Write-Host "Agent Backend:      http://localhost:8000"
Write-Host "----------------------------------------"
Write-Host "Press Ctrl+C to stop all services."
