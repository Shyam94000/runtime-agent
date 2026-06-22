from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    environment: str = Field(default="development", alias="ENVIRONMENT")
    # Gemini (primary provider)
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    gemini_api_key_2: str = Field(default="", alias="GEMINI_API_KEY_2")
    gemini_model: str = Field(default="gemini-3.1-flash-lite", alias="GEMINI_MODEL")

    # NVIDIA NIM (fallback #1)
    nvidia_nim_api_key: str = Field(default="", alias="NVIDIA_NIM_API_KEY")
    nvidia_nim_model: str = Field(default="deepseek-ai/deepseek-v4-flash", alias="NVIDIA_NIM_MODEL")

    # OpenRouter (fallback #3)
    openrouter_api_key: str = Field(default="", alias="OPENROUTER_API_KEY")
    openrouter_model: str = Field(default="deepseek/deepseek-v4-flash", alias="OPENROUTER_MODEL")

    # Target application
    target_app_url: str = Field(default="http://localhost:3001", alias="TARGET_APP_URL")
    target_app_source_path: str = Field(default="../target-app/src", alias="TARGET_APP_SOURCE_PATH")

    # Monitoring thresholds
    cpu_threshold: float = Field(default=70.0, alias="CPU_THRESHOLD")
    memory_growth_rate_mb: float = Field(default=10.0, alias="MEMORY_GROWTH_RATE_MB")
    poll_interval_seconds: int = Field(default=5, alias="POLL_INTERVAL_SECONDS")
    auto_start_monitor: bool = Field(default=True, alias="AUTO_START_MONITOR")
    event_loop_lag_threshold_ms: float = Field(default=100.0, alias="EVENT_LOOP_LAG_THRESHOLD_MS")
    latency_p99_threshold_ms: float = Field(default=500.0, alias="LATENCY_P99_THRESHOLD_MS")
    error_rate_threshold: float = Field(default=0.5, alias="ERROR_RATE_THRESHOLD")
    llm_kill_switch: bool | None = Field(default=None, alias="LLM_KILL_SWITCH")
    gc_pause_threshold_ms: float = Field(default=100.0, alias="GC_PAUSE_THRESHOLD_MS")
    elu_threshold: float = Field(default=0.85, alias="ELU_THRESHOLD")
    throughput_drop_percent: float = Field(default=50.0, alias="THROUGHPUT_DROP_PERCENT")

    # Agent configuration
    data_file: str = Field(default="./data/runtime-monitor.json", alias="DATA_FILE")
    agent_max_steps: int = Field(default=10, alias="AGENT_MAX_STEPS")
    agent_timeout_seconds: int = Field(default=120, alias="AGENT_TIMEOUT_SECONDS")
    diagnosis_mode: str = Field(default="agent_loop", alias="DIAGNOSIS_MODE")

    github_token: str = Field(default="", alias="GITHUB_TOKEN")
    github_repo: str = Field(default="", alias="GITHUB_REPO")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    @model_validator(mode="after")
    def set_killswitch_default(self):
        if self.llm_kill_switch is None:
            self.llm_kill_switch = (self.environment.lower() == "production")
        return self

    @property
    def source_path(self) -> Path:
        path = Path(self.target_app_source_path)
        if not path.is_absolute():
            path = Path(__file__).resolve().parents[1] / path
        return path.resolve()

    @property
    def data_path(self) -> Path:
        path = Path(self.data_file)
        if not path.is_absolute():
            path = Path(__file__).resolve().parents[1] / path
        return path.resolve()


settings = Settings()
