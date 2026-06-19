import asyncio
from app.config import settings
from app.ast_parser import JavaScriptSourceFinder
from app.gemini_agent import AgenticDiagnosticAgent
from app.agent_tools import ToolContext
from app.agent_memory import AgentMemory
from app.models import AnomalyEvent, AnomalyType, MetricPoint
from datetime import datetime, timezone
from pathlib import Path

class DummyMonitor:
    def __init__(self):
        self.target_app_url = settings.target_app_url
        self.anomalies = []
        self.diagnostics = []

    def metric_points(self, minutes=None):
        return []

async def main():
    source = JavaScriptSourceFinder(settings.source_path).find_function('addToCache')
    
    anomaly = AnomalyEvent(
        type=AnomalyType.memory,
        current_value=12.5,
        threshold=10,
        severity='high',
        call_stack=['addToCache(key, data)'],
        details='Smoke test'
    )
    metrics = [MetricPoint(timestamp=datetime.now(timezone.utc), cpu_percent=2.0, memory_mb=90.0, heap_used_mb=40.0, active_requests=0, uptime=30)]
    
    monitor = DummyMonitor()
    memory = AgentMemory(settings.source_path, [], [])
    tool_context = ToolContext(settings.source_path, monitor, memory)
    
    agent = AgenticDiagnosticAgent(tool_context)
    try:
        report, trace = await agent.diagnose(anomaly, metrics, source, memory)
        print("Success:", report.model_used)
        print("Root Cause Summary:", report.root_cause_summary)
        print("Suggested Fix:", report.suggested_fix)
    except Exception as e:
        import traceback
        traceback.print_exc()

asyncio.run(main())
