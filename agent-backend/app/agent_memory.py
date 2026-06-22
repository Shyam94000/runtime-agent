from pathlib import Path
from app.models import DiagnosticReport, AnomalyEvent

class AgentMemory:
    """Full-context knowledge base. Assembles complete context for every agent call."""
    
    def __init__(self, source_path: Path | str, anomalies: list[AnomalyEvent], diagnostics: list[DiagnosticReport]):
        self.source_path = Path(source_path)
        self.anomalies = anomalies
        self.diagnostics = diagnostics

    def build_full_context(self) -> str:
        """Build a complete context string with ALL past incidents and source code."""
        sections = []
        
        # Source code
        sections.append("=== APPLICATION SOURCE CODE ===")
        sections.append(self.get_all_source_code())
        
        # Past Anomalies
        sections.append(f"=== PAST ANOMALIES ({len(self.anomalies)}) ===")
        anomalies_text = []
        for a in self.anomalies[:100]:
            anomalies_text.append(f"[{a.timestamp}] {a.type.value} | Value: {a.current_value} | Threshold: {a.threshold} | Severity: {a.severity} | Status: {a.status}")
        if anomalies_text:
            sections.append("\n".join(anomalies_text))
        else:
            sections.append("No past anomalies.")

        # Past Diagnostics
        sections.append(f"=== PAST DIAGNOSTIC REPORTS ({len(self.diagnostics)}) ===")
        diagnostics_text = []
        for d in self.diagnostics[:100]:
            diagnostics_text.append(f"[{d.timestamp}] Anomaly: {d.anomaly_id}\nSeverity: {d.severity}\nSummary: {d.root_cause_summary}\nFunction: {d.root_cause_function}\nFile: {d.root_cause_file}\nExplanation: {d.explanation[:200]}...")
        if diagnostics_text:
            sections.append("\n---\n".join(diagnostics_text))
        else:
            sections.append("No past diagnostic reports.")
            
        return "\n\n".join(sections)

    def get_all_source_code(self) -> str:
        """Read ALL JS source files and return as one context block."""
        files = []
        for path in self.source_path.rglob("*.js"):
            if "node_modules" in path.parts:
                continue
            if path.stat().st_size > 100 * 1024:
                continue # Skip files > 100KB
            try:
                content = path.read_text(encoding="utf-8")
                files.append(f"--- FILE: {path.relative_to(self.source_path)} ---\n{content}\n")
            except Exception:
                continue
        if not files:
            return "No source code found."
        return "\n".join(files)

    def search(self, anomaly_type: str, limit: int = 5) -> list[dict]:
        """Targeted search for the search_past_incidents tool."""
        results = []
        for d in self.diagnostics:
            # Try to match anomaly type from the anomaly itself if we can
            matching_anomaly = next((a for a in self.anomalies if a.id == d.anomaly_id), None)
            if matching_anomaly and matching_anomaly.type.value != anomaly_type:
                continue
            
            results.append({
                "timestamp": d.timestamp.isoformat(),
                "summary": d.root_cause_summary,
                "root_cause": f"{d.root_cause_function} in {d.root_cause_file}",
                "severity": d.severity
            })
            if len(results) >= limit:
                break
        return results

    def add_diagnostic(self, report: DiagnosticReport):
        """Add a new diagnostic to the knowledge base."""
        pass
