import asyncio
import time
from datetime import datetime, timezone

import httpx

from app.ast_parser import JavaScriptSourceFinder
from app.config import settings
from app.gemini_agent import AgenticDiagnosticAgent
from app.agent_tools import ToolContext
from app.agent_memory import AgentMemory
from app.models import (
    AnomalyEvent,
    AnomalyType,
    DiagnosticReport,
    MetricPoint,
    MonitorConfig,
    RawMetricSnapshot,
    SystemStatus,
    AgentTrace,
    AgentStep,
)
from app.storage import JsonStore


class RuntimeMonitor:
    def __init__(self) -> None:
        self.config = MonitorConfig(
            cpu_threshold=settings.cpu_threshold,
            memory_growth_rate=settings.memory_growth_rate_mb,
            poll_interval=settings.poll_interval_seconds,
            event_loop_lag_threshold_ms=settings.event_loop_lag_threshold_ms,
            latency_p99_threshold_ms=settings.latency_p99_threshold_ms,
            error_rate_threshold=settings.error_rate_threshold,
            llm_kill_switch=settings.llm_kill_switch,
        )
        self.metrics_history: list[RawMetricSnapshot] = []
        self.target_app_url = settings.target_app_url
        self.store = JsonStore()
        try:
            res = self.store.load()
            if len(res) == 3:
                self.anomalies, self.diagnostics, self.agent_traces = res
            else:
                self.anomalies, self.diagnostics = res
                self.agent_traces = []
        except Exception:
            self.anomalies, self.diagnostics, self.agent_traces = [], [], []
        self.memory = AgentMemory(settings.source_path, self.anomalies, self.diagnostics)
        self.started_at = time.monotonic()
        self.last_poll: datetime | None = None
        self.last_error: str | None = None
        self.target_reachable = False
        self.monitoring_active = False
        self._task: asyncio.Task | None = None
        self._cpu_streak = 0
        self._event_loop_streak = 0
        self._error_rate_streak = 0
        self._latency_streak = 0
        self._diagnosing: set[str] = set()
        self.source_finder = JavaScriptSourceFinder()
        tool_context = ToolContext(settings.source_path, self, self.memory)
        self.agent = AgenticDiagnosticAgent(tool_context)

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self.monitoring_active = True
        self._task = asyncio.create_task(self._run_loop())

    async def stop(self) -> None:
        self.monitoring_active = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run_loop(self) -> None:
        while self.monitoring_active:
            await self.poll_once()
            await asyncio.sleep(max(1, self.config.poll_interval))

    async def poll_once(self) -> RawMetricSnapshot | None:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.get(f"{settings.target_app_url.rstrip('/')}/api/metrics")
                response.raise_for_status()
            snapshot = RawMetricSnapshot.from_target_payload(response.json())
            self.target_reachable = True
            self.last_error = None
            self.last_poll = datetime.now(timezone.utc)
            self.metrics_history.append(snapshot)
            self.metrics_history = self.metrics_history[-200:]
            anomaly = await self._detect_anomaly(snapshot)
            if anomaly:
                self.anomalies.insert(0, anomaly)
                self.anomalies = self.anomalies[:200]
                self.store.save(self.anomalies, self.diagnostics, self.agent_traces)
                print(f"Starting diagnosis for {anomaly.id}"); asyncio.create_task(self.diagnose_anomaly(anomaly.id))
            return snapshot
        except Exception as exc:
            self.target_reachable = False
            self.last_error = str(exc)
            self.last_poll = datetime.now(timezone.utc)
            return None

    async def diagnose_anomaly(self, anomaly_id: str) -> DiagnosticReport:
        existing = next((d for d in self.diagnostics if d.anomaly_id == anomaly_id), None)
        if existing:
            return existing
        if anomaly_id in self._diagnosing:
            wait_start = time.monotonic()
            while anomaly_id in self._diagnosing and (time.monotonic() - wait_start) < 30:
                await asyncio.sleep(0.2)
            existing = next((d for d in self.diagnostics if d.anomaly_id == anomaly_id), None)
            if existing:
                return existing

        anomaly = self.get_anomaly(anomaly_id)
        if not anomaly:
            raise KeyError(f"Anomaly {anomaly_id} not found")

        if self.config.llm_kill_switch:
            print(f"Skipping diagnosis for {anomaly_id} because LLM kill switch is active.")
            report = DiagnosticReport(
                anomaly_id=anomaly_id,
                severity=anomaly.severity,
                root_cause_summary="Diagnosis skipped: LLM kill switch is enabled.",
                root_cause_function="N/A",
                root_cause_file="N/A",
                root_cause_lines="N/A",
                explanation="AI diagnosis was not performed because the LLM kill switch is enabled in the settings.",
                suggested_fix="Disable the LLM kill switch in settings to allow AI diagnosis.",
                fix_justification="The LLM kill switch is currently preventing any outbound LLM API requests.",
                confidence_score=0.0,
                model_used="None (Kill Switch Active)"
            )
            trace = AgentTrace(anomaly_id=anomaly_id, model_used="None")
            trace.status = "failed"
            trace.completed_at = datetime.now(timezone.utc)
            trace.steps.append(AgentStep(
                step_number=1,
                type="conclusion",
                reasoning="Diagnosis skipped: LLM kill switch is enabled.",
                duration_ms=0
            ))
            trace.total_steps = len(trace.steps)
            report.agent_trace_id = trace.id
            
            self.diagnostics.insert(0, report)
            self.agent_traces.insert(0, trace)
            self.agent_traces = self.agent_traces[:100]
            anomaly.status = "diagnosed"
            self.store.save(self.anomalies, self.diagnostics, self.agent_traces)
            return report

        print(f"Added {anomaly_id} to diagnosing"); self._diagnosing.add(anomaly_id)
        try:
            source_context = self.source_finder.find_best_context(anomaly.call_stack, anomaly.type.value)
            report, trace = await self.agent.diagnose(anomaly, anomaly.metric_window or self.metric_points(), source_context, self.memory)
            self.diagnostics.insert(0, report)
            self.agent_traces.insert(0, trace)
            self.agent_traces = self.agent_traces[:100]
            anomaly.status = "diagnosed"
            self.store.save(self.anomalies, self.diagnostics, self.agent_traces)
            return report
        finally:
            self._diagnosing.discard(anomaly_id)

    async def _detect_anomaly(self, snapshot: RawMetricSnapshot) -> AnomalyEvent | None:
        # --- Update all streak counters ---
        if snapshot.cpu.percentage > self.config.cpu_threshold:
            self._cpu_streak += 1
        else:
            self._cpu_streak = 0

        if max(snapshot.event_loop.lag_p99_ms, snapshot.event_loop.lag_max_ms) > self.config.event_loop_lag_threshold_ms:
            self._event_loop_streak += 1
        else:
            self._event_loop_streak = 0

        if snapshot.error_rate.rate_per_second > self.config.error_rate_threshold:
            self._error_rate_streak += 1
        else:
            self._error_rate_streak = 0

        if (snapshot.response_latency.p99_ms > self.config.latency_p99_threshold_ms
                and snapshot.response_latency.sample_size > 0):
            self._latency_streak += 1
        else:
            self._latency_streak = 0

        # --- Detect anomalies (priority: CPU > event loop > error rate > latency > memory) ---
        # Higher priority active metrics suppress lower ones to avoid cascades.

        # 1. CPU
        cpu_active = snapshot.cpu.percentage > self.config.cpu_threshold
        if self._cpu_streak >= 3:
            if not self._recent_duplicate(AnomalyType.cpu):
                return await self._trigger_anomaly(
                    AnomalyType.cpu,
                    snapshot.cpu.percentage,
                    self.config.cpu_threshold,
                    self._cpu_severity(snapshot.cpu.percentage),
                    f"CPU exceeded threshold for {self._cpu_streak} consecutive polls."
                )
            return None # Already reported; suppress others.
        if cpu_active: return None

        # 2. Event Loop
        event_loop_val = max(snapshot.event_loop.lag_p99_ms, snapshot.event_loop.lag_max_ms)
        event_loop_active = event_loop_val > self.config.event_loop_lag_threshold_ms
        if self._event_loop_streak >= 3:
            if not self._recent_duplicate(AnomalyType.event_loop):
                sev = "critical" if event_loop_val > 500 else ("high" if event_loop_val > 200 else "medium")
                return await self._trigger_anomaly(
                    AnomalyType.event_loop,
                    event_loop_val,
                    self.config.event_loop_lag_threshold_ms,
                    sev,
                    f"Event loop max lag is {event_loop_val:.1f}ms (threshold: {self.config.event_loop_lag_threshold_ms}ms)"
                )
            return None
        if event_loop_active: return None

        # 3. Error Rate
        error_rate_active = snapshot.error_rate.rate_per_second > self.config.error_rate_threshold
        if self._error_rate_streak >= 3:
            if not self._recent_duplicate(AnomalyType.error_rate):
                val = snapshot.error_rate.rate_per_second
                sev = "critical" if val > 5.0 else ("high" if val > 2.0 else "medium")
                return await self._trigger_anomaly(
                    AnomalyType.error_rate,
                    val,
                    self.config.error_rate_threshold,
                    sev,
                    f"Error rate is {val:.2f} errors/sec (threshold: {self.config.error_rate_threshold}/s)"
                )
            return None
        if error_rate_active: return None

        # 4. Latency
        latency_active = snapshot.response_latency.p99_ms > self.config.latency_p99_threshold_ms and snapshot.response_latency.sample_size > 0
        if self._latency_streak >= 3:
            if not self._recent_duplicate(AnomalyType.latency):
                val = snapshot.response_latency.p99_ms
                sev = "high" if val > 2000 else "medium"
                return await self._trigger_anomaly(
                    AnomalyType.latency,
                    val,
                    self.config.latency_p99_threshold_ms,
                    sev,
                    f"P99 latency is {val:.1f}ms (threshold: {self.config.latency_p99_threshold_ms}ms)"
                )
            return None
        if latency_active: return None

        # 5. Memory Leak
        growth = self._memory_growth_rate_mb_per_minute()
        if growth > self.config.memory_growth_rate:
            if not self._recent_duplicate(AnomalyType.memory):
                return await self._trigger_anomaly(
                    AnomalyType.memory,
                    growth,
                    self.config.memory_growth_rate,
                    self._memory_severity(growth),
                    f"Heap growth rate is {growth:.2f} MB/min (threshold: {self.config.memory_growth_rate} MB/min)"
                )
            return None

        return None

    async def _trigger_anomaly(self, type: AnomalyType, current_value: float, threshold: float, severity: str, details: str) -> AnomalyEvent:
        # Fetch real profiling data dynamically
        call_stack = []
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                res = await client.get(f"{settings.target_app_url.rstrip('/')}/api/profile")
                if res.status_code == 200:
                    profile_data = res.json()
                    call_stack = [hf.get("functionName", "") for hf in profile_data.get("hot_functions", [])]
        except Exception:
            pass

        return AnomalyEvent(
            type=type,
            current_value=current_value,
            threshold=threshold,
            severity=severity,
            metric_window=self.metric_points()[-20:],
            call_stack=call_stack,
            details=details,
        )

    def _memory_growth_rate_mb_per_minute(self) -> float:
        points = self.metrics_history[-12:]
        if len(points) < 4:
            return 0.0
        first = points[0]
        last = points[-1]
        seconds = max(1.0, (last.timestamp - first.timestamp).total_seconds())
        # Use RSS for a more inclusive measure of memory growth (includes heap, external, etc.)
        growth_mb = last.memory.rss_mb - first.memory.rss_mb
        return max(0.0, growth_mb / seconds * 60)

    def _recent_duplicate(self, anomaly_type: AnomalyType) -> bool:
        now = datetime.now(timezone.utc)
        for anomaly in self.anomalies[:5]:
            if anomaly.type == anomaly_type and (now - anomaly.timestamp).total_seconds() < 120:
                return True
        return False

    def _cpu_severity(self, value: float) -> str:
        if value >= 95:
            return "critical"
        if value >= 85:
            return "high"
        return "medium"

    def _memory_severity(self, value: float) -> str:
        if value >= self.config.memory_growth_rate * 3:
            return "critical"
        if value >= self.config.memory_growth_rate * 2:
            return "high"
        return "medium"

    def metric_points(self, minutes: int | None = None) -> list[MetricPoint]:
        points = [
            MetricPoint(
                timestamp=s.timestamp,
                cpu_percent=s.cpu.percentage,
                memory_mb=s.memory.rss_mb,
                heap_used_mb=s.memory.heap_used_mb,
                active_requests=s.active_requests,
                uptime=s.uptime,
                event_loop_p99_ms=s.event_loop.lag_p99_ms,
                response_latency_p99_ms=s.response_latency.p99_ms,
                error_rate_per_sec=s.error_rate.rate_per_second,
                uncaught_error_count=len(s.uncaught_errors),
            )
            for s in self.metrics_history
        ]
        if minutes is None:
            return points
        cutoff = datetime.now(timezone.utc).timestamp() - minutes * 60
        return [point for point in points if point.timestamp.timestamp() >= cutoff]

    def latest_point(self) -> MetricPoint | None:
        points = self.metric_points()
        return points[-1] if points else None

    def get_anomaly(self, anomaly_id: str) -> AnomalyEvent | None:
        return next((a for a in self.anomalies if a.id == anomaly_id), None)

    def get_diagnostic(self, diagnostic_id: str) -> DiagnosticReport | None:
        report = next(
            (d for d in self.diagnostics if d.id == diagnostic_id or d.anomaly_id == diagnostic_id),
            None,
        )
        if report:
            return report
        anomaly = self.get_anomaly(diagnostic_id)
        if anomaly:
            return DiagnosticReport(
                anomaly_id=anomaly.id,
                severity=anomaly.severity,
                root_cause_summary="Agent is diagnosing...",
                root_cause_function="Diagnosing...",
                root_cause_file="Diagnosing...",
                root_cause_lines="Diagnosing...",
                explanation="The agent is currently diagnosing this anomaly. Please wait.",
                suggested_fix="No fix available yet. Diagnosis in progress.",
                fix_justification="Diagnosis is in progress.",
                confidence_score=0.0,
                model_used="unknown"
            )
        return None

    def get_trace(self, trace_id: str) -> AgentTrace | None:
        return next((t for t in self.agent_traces if t.id == trace_id), None)

    def get_trace_for_diagnostic(self, diagnostic_id: str) -> AgentTrace | None:
        diag = self.get_diagnostic(diagnostic_id)
        if diag and diag.agent_trace_id:
            return self.get_trace(diag.agent_trace_id)
        return None

    def update_config(self, config: MonitorConfig) -> MonitorConfig:
        self.config = config
        return self.config

    def clear_all(self) -> None:
        self.anomalies = []
        self.diagnostics = []
        self.agent_traces = []
        self.store.save(self.anomalies, self.diagnostics, self.agent_traces)

    def status(self) -> SystemStatus:
        return SystemStatus(
            monitoring_active=self.monitoring_active,
            target_reachable=self.target_reachable,
            last_poll=self.last_poll,
            anomaly_count=len(self.anomalies),
            diagnostic_count=len(self.diagnostics),
            trace_count=len(self.agent_traces),
            uptime=round(time.monotonic() - self.started_at, 2),
            target_app_url=settings.target_app_url,
            source_path=str(settings.source_path),
            last_error=self.last_error,
        )


monitor = RuntimeMonitor()
