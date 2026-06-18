import glob
from pathlib import Path
import httpx
from app.ast_parser import JavaScriptSourceFinder

class ToolContext:
    """Holds references to shared state that tools need."""
    def __init__(self, source_path: str, monitor, memory):
        self.source_path = source_path
        self.monitor = monitor
        self.memory = memory

def create_tools(context: ToolContext):
    def read_source_file(file_path: str) -> str:
        """
        Reads a JS source file from the target app.
        
        Args:
            file_path: The relative path to the file (e.g., "utils/fibonacci.js")
        """
        try:
            full_path = Path(context.source_path) / file_path
            # Security check
            if not str(full_path.resolve()).startswith(str(Path(context.source_path).resolve())):
                return f"Access denied: invalid path {file_path}"
            if not full_path.exists():
                return f"File not found: {file_path}"
            with open(full_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
            return "".join([f"{i+1}: {line}" for i, line in enumerate(lines)])
        except Exception as e:
            return f"Error reading file: {str(e)}"

    def search_function_in_codebase(function_name: str) -> str:
        """
        Finds a function definition by name and returns its source code and location.
        
        Args:
            function_name: The exact name of the function to search for
        """
        try:
            # We initialize without the dir since JavaScriptSourceFinder might require it
            finder = JavaScriptSourceFinder(context.source_path)
            result = finder.find_function(function_name)
            if not result:
                return f"Function '{function_name}' not found in codebase."
            return (f"Function: {result.function_name}\n"
                    f"File: {result.relative_file_path}\n"
                    f"Lines: {result.start_line}-{result.end_line}\n\n"
                    f"Code:\n{result.source_code}")
        except Exception as e:
            return f"Error searching codebase: {str(e)}"

    def query_recent_metrics(minutes: int) -> str:
        """
        Gets recent metric datapoints (CPU, memory, requests) from the monitor.
        
        Args:
            minutes: How many minutes of history to retrieve
        """
        try:
            points = context.monitor.metric_points(minutes=minutes)
            if not points:
                return "No metric data available."
            # Limit to last 20 for brevity
            recent_points = points[-20:]
            res = []
            for p in recent_points:
                res.append(f"[{p.timestamp.isoformat()}] CPU: {p.cpu_percent:.1f}%, Mem: {p.memory_mb:.1f}MB, Req: {p.active_requests}")
            return "\n".join(res)
        except Exception as e:
            return f"Error querying metrics: {str(e)}"

    def get_call_stacks() -> str:
        """
        Fetches currently active request call stacks from the target app.
        """
        try:
            url = f"{context.monitor.target_app_url}/api/metrics"
            response = httpx.get(url, timeout=3.0)
            response.raise_for_status()
            data = response.json()
            requests = data.get("request_details", [])
            if not requests:
                return "No active requests."
            res = []
            for r in requests:
                call_stack_str = "\n  ".join(r.get("call_stack", []))
                res.append(f"{r.get('method')} {r.get('path')} ({r.get('duration_ms')}ms)\nCall stack:\n  {call_stack_str}")
            return "\n---\n".join(res)
        except Exception as e:
            return f"Target app is not reachable or error occurred: {str(e)}"

    def list_source_files() -> str:
        """
        Lists all JS source files in the target app.
        """
        try:
            source_path = Path(context.source_path)
            files = []
            for path in source_path.rglob("*.js"):
                if "node_modules" not in path.parts:
                    files.append(str(path.relative_to(source_path)))
            if not files:
                return "No source files found."
            return "\n".join(files)
        except Exception as e:
            return f"Error listing files: {str(e)}"

    def search_past_incidents(anomaly_type: str) -> str:
        """
        Searches historical anomalies/diagnostics for similar past incidents.
        
        Args:
            anomaly_type: The type of anomaly ('cpu' or 'memory')
        """
        try:
            incidents = context.memory.search(anomaly_type)
            if not incidents:
                return f"No past incidents found for type: {anomaly_type}"
            res = []
            for inc in incidents:
                res.append(f"Time: {inc.get('timestamp')}\nSummary: {inc.get('summary')}\nRoot Cause: {inc.get('root_cause')}\nSeverity: {inc.get('severity')}")
            return "\n---\n".join(res)
        except Exception as e:
            return f"Error searching past incidents: {str(e)}"

    def submit_diagnosis(root_cause_summary: str, root_cause_function: str,
                         root_cause_file: str, root_cause_lines: str,
                         explanation: str, suggested_fix: str,
                         fix_justification: str, confidence_score: float) -> str:
        """
        Terminal tool — calling it ends the agent loop with a structured diagnosis.
        
        Args:
            root_cause_summary: Short human-readable summary
            root_cause_function: Name of the function causing the issue
            root_cause_file: Relative path to the file containing the function
            root_cause_lines: Line range (e.g. "12-15")
            explanation: Clear multi-sentence explanation of the root cause
            suggested_fix: A unified diff string with the proposed fix
            fix_justification: Explanation of why this fix addresses the incident
            confidence_score: Float between 0.0 and 1.0
        """
        return "DIAGNOSIS_SUBMITTED"

    return [
        read_source_file,
        search_function_in_codebase,
        query_recent_metrics,
        get_call_stacks,
        list_source_files,
        search_past_incidents,
        submit_diagnosis
    ]
