import asyncio
import time
from datetime import datetime, timezone
from typing import Any

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
from app.database import SQLiteStore
from fastapi import WebSocket
import websockets
import json

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
        self.store = SQLiteStore()
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
        self._detector_streaks: dict[AnomalyType, int] = {atype: 0 for atype in AnomalyType}
        self._diagnosing: set[str] = set()
        self.source_finder = JavaScriptSourceFinder()
        tool_context = ToolContext(settings.source_path, self, self.memory)
        self.agent = AgenticDiagnosticAgent(tool_context)
        self.active_connections: set[WebSocket] = set()

    async def connect_client(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect_client(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    async def broadcast(self, message: dict):
        for ws in list(self.active_connections):
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect_client(ws)

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self.monitoring_active = True
        self.loop = asyncio.get_running_loop()
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
        target_ws_url = self.target_app_url.replace("http", "ws").rstrip('/') + "/"
        while self.monitoring_active:
            try:
                async with websockets.connect(target_ws_url) as ws:
                    self.target_reachable = True
                    self.last_error = None
                    while self.monitoring_active:
                        msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
                        data = json.loads(msg)
                        
                        snapshot = RawMetricSnapshot.from_target_payload(data)
                        self.last_poll = datetime.now(timezone.utc)
                        self.metrics_history.append(snapshot)
                        self.metrics_history = self.metrics_history[-200:]
                        
                        anomaly = await self._detect_anomaly(snapshot)
                        if anomaly:
                            self.anomalies.insert(0, anomaly)
                            self.anomalies = self.anomalies[:200]
                            self._save()
                            print(f"Starting diagnosis for {anomaly.id}")
                            asyncio.create_task(self.diagnose_anomaly(anomaly.id))
                            await self.broadcast({"type": "anomaly_detected", "data": anomaly.model_dump(mode="json")})
                        
                        latest_point = self.latest_point()
                        if latest_point:
                            await self.broadcast({"type": "metrics_update", "data": latest_point.model_dump(mode="json")})
            except (websockets.exceptions.ConnectionClosed, OSError, asyncio.TimeoutError) as exc:
                self.target_reachable = False
                self.last_error = str(exc)
                await asyncio.sleep(2)
            except Exception as exc:
                self.target_reachable = False
                self.last_error = str(exc)
                await asyncio.sleep(2)

    def _save(self):
        try:
            self.store.save_all(self.anomalies, self.diagnostics, self.agent_traces)
        except Exception as e:
            print(f"Failed to save data to store: {e}")

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
                self._save()
                print(f"Starting diagnosis for {anomaly.id}"); asyncio.create_task(self.diagnose_anomaly(anomaly.id))
                await self.broadcast({"type": "anomaly_detected", "data": anomaly.model_dump(mode="json")})
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
            self._save()
            await self.broadcast({
                "type": "diagnostic_completed",
                "data": report.model_dump(mode="json"),
                "anomaly": anomaly.model_dump(mode="json"),
            })
            return report

        print(f"Added {anomaly_id} to diagnosing"); self._diagnosing.add(anomaly_id)
        try:
            source_context = self.source_finder.find_best_context(anomaly.call_stack, anomaly.type.value)
            report, trace = await self.agent.diagnose(anomaly, anomaly.metric_window or self.metric_points(), source_context, self.memory)
            self.diagnostics.insert(0, report)
            self.agent_traces.insert(0, trace)
            self.agent_traces = self.agent_traces[:100]
            anomaly.status = "diagnosed"
            self._save()
            await self.broadcast({
                "type": "diagnostic_completed",
                "data": report.model_dump(mode="json"),
                "anomaly": anomaly.model_dump(mode="json"),
            })
            return report
        finally:
            self._diagnosing.discard(anomaly_id)

    async def _detect_anomaly(self, snapshot: RawMetricSnapshot) -> AnomalyEvent | None:
        detector_results = [
            self._detect_runtime_error(snapshot),
            self._detect_error_burst(snapshot),
            self._detect_event_loop_block(snapshot),
            self._detect_db_degradation(snapshot),
            self._detect_network_delay(snapshot),
            self._detect_cpu_spike(snapshot),
            self._detect_memory_growth(snapshot),
            self._detect_response_latency(snapshot),
        ]
        for result in detector_results:
            if not result:
                continue
            anomaly_type, current_value, threshold, severity, details = result
            if self._recent_duplicate(anomaly_type):
                continue
            return await self._trigger_anomaly(
                anomaly_type,
                current_value,
                threshold,
                severity,
                details,
            )
        return None

    def _detect_runtime_error(self, snapshot: RawMetricSnapshot) -> tuple[AnomalyType, float, float, str, str] | None:
        recent = [
            err for err in snapshot.uncaught_errors
            if self._is_recent_timestamp(err.timestamp, seconds=30)
        ]
        active = len(recent) > 0
        self._set_streak(AnomalyType.runtime_error, active)
        if not active or self._detector_streaks[AnomalyType.runtime_error] != 1:
            return None
        latest = recent[-1]
        return (
            AnomalyType.runtime_error,
            float(len(recent)),
            1.0,
            "high",
            f"{latest.type} captured: {latest.message}",
        )

    def _detect_error_burst(self, snapshot: RawMetricSnapshot) -> tuple[AnomalyType, float, float, str, str] | None:
        recent_errors = self._recent_error_count(snapshot, seconds=60)
        route_errors = self._recent_error_count(snapshot, seconds=20, path="/api/error-burst")
        active = (
            route_errors >= 1
            or recent_errors >= 10
            or snapshot.error_rate.rate_per_second > self.config.error_rate_threshold
        )
        self._set_streak(AnomalyType.error_rate, active)
        if not active or self._detector_streaks[AnomalyType.error_rate] != 1:
            return None
        val = max(snapshot.error_rate.rate_per_second, recent_errors / 60)
        sev = "critical" if recent_errors >= 30 or val > 5.0 else ("high" if recent_errors >= 10 or val > 2.0 else "medium")
        return (
            AnomalyType.error_rate,
            val,
            self.config.error_rate_threshold,
            sev,
            f"{recent_errors} recent 5xx errors detected in the last 60s.",
        )

    def _detect_event_loop_block(self, snapshot: RawMetricSnapshot) -> tuple[AnomalyType, float, float, str, str] | None:
        val = max(snapshot.event_loop.lag_p99_ms, snapshot.event_loop.lag_max_ms)
        demo_request = self._recent_request(snapshot, "/api/event-loop-block", seconds=20)
        active = demo_request is not None or val > self.config.event_loop_lag_threshold_ms
        self._set_streak(AnomalyType.event_loop, active)
        should_fire = demo_request is not None or self._detector_streaks[AnomalyType.event_loop] >= 1
        if not active or not should_fire:
            return None
        if demo_request:
            val = max(val, float(demo_request.get("duration_ms") or 0))
        sev = "critical" if val > 500 else ("high" if val > 200 else "medium")
        return (
            AnomalyType.event_loop,
            val,
            self.config.event_loop_lag_threshold_ms,
            sev,
            f"Event loop lag reached {val:.1f}ms.",
        )

    def _detect_db_degradation(self, snapshot: RawMetricSnapshot) -> tuple[AnomalyType, float, float, str, str] | None:
        val = snapshot.response_latency.db_p95_ms
        demo_request = self._recent_request(snapshot, "/api/db-degradation", seconds=30)
        if demo_request:
            val = max(val, float(demo_request.get("duration_ms") or 0))
        active = val > self.config.db_latency_threshold_ms or (
            demo_request is not None and val > self.config.db_latency_threshold_ms * 0.75
        )
        self._set_streak(AnomalyType.db_latency, active)
        should_fire = demo_request is not None or self._detector_streaks[AnomalyType.db_latency] >= 2
        if not active or not should_fire:
            return None
        sev = "critical" if val > self.config.db_latency_threshold_ms * 2 else "high"
        return (
            AnomalyType.db_latency,
            val,
            self.config.db_latency_threshold_ms,
            sev,
            f"Database latency reached {val:.1f}ms.",
        )

    def _detect_network_delay(self, snapshot: RawMetricSnapshot) -> tuple[AnomalyType, float, float, str, str] | None:
        val = snapshot.response_latency.network_p95_ms
        demo_request = self._recent_request(snapshot, "/api/network-delay", seconds=30)
        if demo_request:
            val = max(val, float(demo_request.get("duration_ms") or 0))
        active = val > self.config.network_latency_threshold_ms or (
            demo_request is not None and val > self.config.network_latency_threshold_ms * 0.75
        )
        self._set_streak(AnomalyType.network_latency, active)
        should_fire = demo_request is not None or self._detector_streaks[AnomalyType.network_latency] >= 2
        if not active or not should_fire:
            return None
        sev = "critical" if val > self.config.network_latency_threshold_ms * 2 else "high"
        return (
            AnomalyType.network_latency,
            val,
            self.config.network_latency_threshold_ms,
            sev,
            f"Slow API response time reached {val:.1f}ms.",
        )

    def _detect_cpu_spike(self, snapshot: RawMetricSnapshot) -> tuple[AnomalyType, float, float, str, str] | None:
        demo_request = self._recent_request(snapshot, "/api/cpu-heavy", seconds=30)
        active_request = any(r.path == "/api/cpu-heavy" for r in snapshot.request_details)
        active = demo_request is not None or active_request or snapshot.cpu.percentage > self.config.cpu_threshold
        self._set_streak(AnomalyType.cpu, active)
        should_fire = demo_request is not None or active_request or self._detector_streaks[AnomalyType.cpu] >= 2
        if not active or not should_fire:
            return None
        val = snapshot.cpu.percentage
        return (
            AnomalyType.cpu,
            val,
            self.config.cpu_threshold,
            self._cpu_severity(val),
            f"CPU spike detected at {val:.1f}%.",
        )

    def _detect_memory_growth(self, snapshot: RawMetricSnapshot) -> tuple[AnomalyType, float, float, str, str] | None:
        stats = self._memory_growth_stats()
        demo_request = self._recent_request(snapshot, "/api/memory-leak", seconds=45)
        enough_history = stats["sample_count"] >= 8 and stats["window_seconds"] >= 20
        sustained_growth = (
            enough_history
            and stats["positive_steps"] >= max(3, stats["sample_count"] // 2)
            and stats["rss_growth_mb"] >= max(12.0, self.config.memory_growth_rate)
            and stats["rss_rate_mb_per_min"] > self.config.memory_growth_rate
        )
        demo_growth = (
            demo_request is not None
            and stats["sample_count"] >= 3
            and (
                stats["rss_growth_mb"] >= 5.0
                or stats["heap_growth_mb"] >= 3.0
                or stats["rss_rate_mb_per_min"] > self.config.memory_growth_rate
            )
        )
        active = sustained_growth or demo_growth
        self._set_streak(AnomalyType.memory, active)
        if not active:
            return None
        growth = max(stats["rss_rate_mb_per_min"], stats["heap_rate_mb_per_min"])
        return (
            AnomalyType.memory,
            growth,
            self.config.memory_growth_rate,
            self._memory_severity(growth),
            (
                f"Memory grew {stats['rss_growth_mb']:.1f}MB RSS and "
                f"{stats['heap_growth_mb']:.1f}MB heap over {stats['window_seconds']:.0f}s."
            ),
        )

    def _detect_response_latency(self, snapshot: RawMetricSnapshot) -> tuple[AnomalyType, float, float, str, str] | None:
        val = snapshot.response_latency.p99_ms
        sample_size = snapshot.response_latency.sample_size
        active = sample_size >= 30 and val > self.config.latency_p99_threshold_ms
        self._set_streak(AnomalyType.latency, active)
        if not active or self._detector_streaks[AnomalyType.latency] < 3:
            return None
        sev = "critical" if val > self.config.latency_p99_threshold_ms * 3 else "high"
        return (
            AnomalyType.latency,
            val,
            self.config.latency_p99_threshold_ms,
            sev,
            f"Global response p99 latency stayed above threshold for 3 readings with {sample_size} samples.",
        )

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

    def _memory_growth_stats(self) -> dict[str, float]:
        points = self.metrics_history[-30:]
        if len(points) < 2:
            return {
                "sample_count": float(len(points)),
                "window_seconds": 0.0,
                "rss_growth_mb": 0.0,
                "heap_growth_mb": 0.0,
                "rss_rate_mb_per_min": 0.0,
                "heap_rate_mb_per_min": 0.0,
                "positive_steps": 0.0,
            }
        first = points[0]
        last = points[-1]
        seconds = max(1.0, (last.timestamp - first.timestamp).total_seconds())
        rss_growth = last.memory.rss_mb - first.memory.rss_mb
        heap_growth = last.memory.heap_used_mb - first.memory.heap_used_mb
        positive_steps = 0
        for prev, curr in zip(points, points[1:]):
            if curr.memory.rss_mb >= prev.memory.rss_mb:
                positive_steps += 1
        return {
            "sample_count": float(len(points)),
            "window_seconds": seconds,
            "rss_growth_mb": max(0.0, rss_growth),
            "heap_growth_mb": max(0.0, heap_growth),
            "rss_rate_mb_per_min": max(0.0, rss_growth / seconds * 60),
            "heap_rate_mb_per_min": max(0.0, heap_growth / seconds * 60),
            "positive_steps": float(positive_steps),
        }

    def _set_streak(self, anomaly_type: AnomalyType, active: bool) -> int:
        if active:
            self._detector_streaks[anomaly_type] = self._detector_streaks.get(anomaly_type, 0) + 1
        else:
            self._detector_streaks[anomaly_type] = 0
        return self._detector_streaks[anomaly_type]

    def _recent_duplicate(self, anomaly_type: AnomalyType) -> bool:
        now = datetime.now(timezone.utc)
        for anomaly in self.anomalies[:20]:
            if anomaly.type == anomaly_type and (now - anomaly.timestamp).total_seconds() < 60:
                return True
        return False

    def _recent_request(self, snapshot: RawMetricSnapshot, path: str, seconds: int = 30) -> dict[str, Any] | None:
        matches = [
            log for log in snapshot.request_logs
            if log.get("path") == path and self._is_recent_iso_timestamp(log.get("timestamp"), seconds)
        ]
        return matches[-1] if matches else None

    def _recent_error_count(self, snapshot: RawMetricSnapshot, seconds: int = 60, path: str | None = None) -> int:
        count = 0
        for err in snapshot.error_rate.recent_errors:
            if path and err.get("path") != path:
                continue
            if self._is_recent_timestamp(err.get("timestamp"), seconds):
                count += 1
        return count

    def _is_recent_timestamp(self, timestamp: Any, seconds: int) -> bool:
        if not timestamp:
            return False
        try:
            ts = float(timestamp)
        except (TypeError, ValueError):
            return False
        if ts > 10_000_000_000:
            ts = ts / 1000
        now = datetime.now(timezone.utc).timestamp()
        return 0 <= now - ts <= seconds

    def _is_recent_iso_timestamp(self, timestamp: Any, seconds: int) -> bool:
        if not timestamp:
            return False
        try:
            parsed = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return False
        now = datetime.now(timezone.utc)
        return 0 <= (now - parsed).total_seconds() <= seconds

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
                db_p95_ms=s.response_latency.db_p95_ms,
                network_p95_ms=s.response_latency.network_p95_ms,
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
        self._save()

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
