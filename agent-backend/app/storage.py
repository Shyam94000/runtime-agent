import json
from pathlib import Path

from pydantic import TypeAdapter

from app.config import settings
from app.models import AnomalyEvent, DiagnosticReport, AgentTrace


class JsonStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or settings.data_path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> tuple[list[AnomalyEvent], list[DiagnosticReport], list[AgentTrace]]:
        if not self.path.exists():
            return [], [], []
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            anomalies = TypeAdapter(list[AnomalyEvent]).validate_python(payload.get("anomalies", []))
            diagnostics = TypeAdapter(list[DiagnosticReport]).validate_python(payload.get("diagnostics", []))
            traces = TypeAdapter(list[AgentTrace]).validate_python(payload.get("agent_traces", []))
            return anomalies, diagnostics, traces
        except Exception:
            return [], [], []

    def save(self, anomalies: list[AnomalyEvent], diagnostics: list[DiagnosticReport], traces: list[AgentTrace] | None = None) -> None:
        payload = {
            "anomalies": [item.model_dump(mode="json") for item in anomalies[-200:]],
            "diagnostics": [item.model_dump(mode="json") for item in diagnostics[-200:]],
        }
        if traces is not None:
            payload["agent_traces"] = [item.model_dump(mode="json") for item in traces[-100:]]
            
        self.path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
