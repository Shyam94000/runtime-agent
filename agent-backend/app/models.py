from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class AnomalyType(str, Enum):
    cpu = "cpu"
    memory = "memory"
    event_loop = "event_loop"
    latency = "latency"
    db_latency = "db_latency"
    network_latency = "network_latency"
    runtime_error = "runtime_error"
    gc_pressure = "gc_pressure"
    elu_saturation = "elu_saturation"
    throughput_drop = "throughput_drop"


class CpuMetrics(BaseModel):
    user: int = 0
    system: int = 0
    percentage: float = 0.0


class MemoryMetrics(BaseModel):
    rss: int = 0
    heapTotal: int = 0
    heapUsed: int = 0
    external: int = 0
    rss_mb: float = 0.0
    heap_used_mb: float = 0.0
    heap_total_mb: float = 0.0


class EventLoopMetrics(BaseModel):
    lag_mean_ms: float = 0.0
    lag_p50_ms: float = 0.0
    lag_p99_ms: float = 0.0
    lag_max_ms: float = 0.0
    lag_min_ms: float = 0.0


class GcMetrics(BaseModel):
    count: int = 0
    total_pause_ms: float = 0.0
    max_pause_ms: float = 0.0
    last_major_pause_ms: float = 0.0
    gc_time_percent: float = 0.0


class ResponseLatencyMetrics(BaseModel):
    p50_ms: float = 0.0
    p95_ms: float = 0.0
    p99_ms: float = 0.0
    avg_ms: float = 0.0
    sample_size: int = 0
    db_p95_ms: float = 0.0
    network_p95_ms: float = 0.0


class UncaughtError(BaseModel):
    type: str = ""
    message: str = ""
    stack: str | None = None
    timestamp: int = 0


class RequestDetail(BaseModel):
    method: str = "GET"
    path: str = ""
    duration_ms: int = 0
    call_stack: list[str] = Field(default_factory=list)


class RawMetricSnapshot(BaseModel):
    timestamp: datetime
    cpu: CpuMetrics = Field(default_factory=CpuMetrics)
    memory: MemoryMetrics = Field(default_factory=MemoryMetrics)
    uptime: float = 0.0
    active_requests: int = 0
    request_details: list[RequestDetail] = Field(default_factory=list)
    call_stack: list[str] = Field(default_factory=list)
    pid: int | None = None
    node_version: str | None = None
    event_loop: EventLoopMetrics = Field(default_factory=EventLoopMetrics)
    response_latency: ResponseLatencyMetrics = Field(default_factory=ResponseLatencyMetrics)
    uncaught_errors: list[UncaughtError] = Field(default_factory=list)
    request_logs: list[dict] = Field(default_factory=list)
    gc: GcMetrics = Field(default_factory=GcMetrics)
    elu: float = 0.0
    throughput_rps: float = 0.0

    @classmethod
    def from_target_payload(cls, payload: dict[str, Any]) -> "RawMetricSnapshot":
        return cls.model_validate(payload)


class MetricPoint(BaseModel):
    timestamp: datetime
    cpu_percent: float
    memory_mb: float
    heap_used_mb: float
    active_requests: int
    uptime: float
    event_loop_p99_ms: float = 0.0
    response_latency_p99_ms: float = 0.0
    error_rate_per_sec: float = 0.0
    uncaught_error_count: int = 0
    db_p95_ms: float = 0.0
    network_p95_ms: float = 0.0
    gc_pause_max_ms: float = 0.0
    gc_time_percent: float = 0.0
    elu: float = 0.0
    throughput_rps: float = 0.0


class AnomalyEvent(BaseModel):
    id: str = Field(default_factory=lambda: f"anom-{uuid4().hex[:10]}")
    timestamp: datetime = Field(default_factory=utc_now)
    type: AnomalyType
    current_value: float
    threshold: float
    severity: Literal["low", "medium", "high", "critical"] = "high"
    status: Literal["new", "diagnosed", "ignored"] = "new"
    metric_window: list[MetricPoint] = Field(default_factory=list)
    call_stack: list[str] = Field(default_factory=list)
    details: str = ""


class SourceContext(BaseModel):
    function_name: str
    file_path: str
    relative_file_path: str
    start_line: int
    end_line: int
    source_code: str


class DiagnosticReport(BaseModel):
    id: str = Field(default_factory=lambda: f"diag-{uuid4().hex[:10]}")
    anomaly_id: str
    timestamp: datetime = Field(default_factory=utc_now)
    severity: Literal["low", "medium", "high", "critical"] = "high"
    root_cause_summary: str
    root_cause_function: str
    root_cause_file: str
    root_cause_lines: str
    explanation: str
    suggested_fix: str
    fix_justification: str
    confidence_score: float = 0.75
    source_code_context: str = ""
    model_used: str = "unknown"
    agent_trace_id: str | None = None
    investigation_steps: int = 1
    tools_used: list[str] = Field(default_factory=list)


class MonitorConfig(BaseModel):
    cpu_threshold: float
    memory_growth_rate: float
    poll_interval: int
    event_loop_lag_threshold_ms: float = 100.0
    latency_p99_threshold_ms: float = 500.0
    error_rate_threshold: float = 0.5
    llm_kill_switch: bool = False
    db_latency_threshold_ms: float = 2000.0
    network_latency_threshold_ms: float = 3000.0
    gc_pause_threshold_ms: float = 100.0
    elu_threshold: float = 0.85
    throughput_drop_percent: float = 50.0
    github_token: str = ""
    github_repo: str = ""
    last_updated: str | None = None


class SystemStatus(BaseModel):
    monitoring_active: bool
    target_reachable: bool
    last_poll: datetime | None
    anomaly_count: int
    diagnostic_count: int
    trace_count: int = 0
    uptime: float
    target_app_url: str
    source_path: str
    last_error: str | None = None
    last_updated: datetime | None = None


class AgentStep(BaseModel):
    step_number: int
    timestamp: datetime = Field(default_factory=utc_now)
    type: Literal["thinking", "tool_call", "tool_result", "conclusion"]
    tool_name: str | None = None
    tool_args: dict | None = None
    tool_result_summary: str | None = None
    reasoning: str | None = None
    duration_ms: float | None = None
    input_tokens: int = 0
    output_tokens: int = 0


class AgentTrace(BaseModel):
    id: str = Field(default_factory=lambda: f"trace-{uuid4().hex[:10]}")
    anomaly_id: str
    started_at: datetime = Field(default_factory=utc_now)
    completed_at: datetime | None = None
    status: Literal["investigating", "completed", "failed"] = "investigating"
    steps: list[AgentStep] = Field(default_factory=list)
    total_steps: int = 0
    total_duration_ms: float | None = None
    model_used: str = ""
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0


class ChatMessage(BaseModel):
    role: Literal["user", "agent"]
    content: str
    timestamp: datetime = Field(default_factory=utc_now)


class ChatRequest(BaseModel):
    message: str
    context: dict = Field(default_factory=dict)


class ApplyFixRequest(BaseModel):
    diagnostic_id: str
    branch_name: str
    commit_message: str


class FixRecord(BaseModel):
    id: str
    prNumber: int | None = None
    branchName: str | None = None
    title: str | None = None
    file: str | None = None
    severity: str | None = None
    status: Literal["open", "merged", "dismissed"] = "open"
    prUrl: str | None = None
    createdAt: datetime = Field(default_factory=utc_now)
    mergedAt: datetime | None = None
