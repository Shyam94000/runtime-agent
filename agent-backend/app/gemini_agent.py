import asyncio
import json
import re
import time
from typing import Any

from app.config import settings
from app.models import AnomalyEvent, DiagnosticReport, MetricPoint, SourceContext, AgentStep, AgentTrace
from app.prompts import (
    AGENT_SYSTEM_PROMPT,
    INITIAL_ANOMALY_PROMPT,
)
from app.agent_tools import create_tools
from pydantic import BaseModel, Field
from app.agent_memory import AgentMemory
from app.pricing import estimate_cost
from app.llm_router import router, LLMResponse
from app.pricing import estimate_cost


def utc_now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)



class DiagnosticResponseSchema(BaseModel):
    root_cause_summary: str = Field(description="A short summary of the root cause.")
    root_cause_function: str = Field(description="The function name where the anomaly originated.", default="")
    root_cause_file: str = Field(description="The file name where the anomaly originated.", default="")
    root_cause_lines: str = Field(description="The line numbers where the anomaly originated.", default="")
    explanation: str = Field(description="A detailed explanation of the root cause.")
    suggested_fix: str = Field(description="A suggested fix for the anomaly.")
    fix_justification: str = Field(description="A justification for the suggested fix.")
    confidence_score: float = Field(description="Confidence score between 0.0 and 1.0.", default=0.75)

class AgenticDiagnosticAgent:
    def __init__(self, tool_context) -> None:
        self.tool_context = tool_context
        self.model_name = "multi-provider"  # will be resolved at runtime
        self.max_steps = getattr(settings, 'agent_max_steps', 5)
        self.tools = create_tools(tool_context)

    async def diagnose(
        self,
        anomaly: AnomalyEvent,
        metrics_context: list[MetricPoint],
        source_context: SourceContext | None,
        memory: AgentMemory,
    ) -> tuple[DiagnosticReport, AgentTrace]:
        trace = AgentTrace(anomaly_id=anomaly.id, model_used=self.model_name)
        
        # Check if any provider is configured
        if not router.providers:
            report = self._create_error_report(anomaly, "No LLM providers configured. Add at least one API key to .env.")
            trace.status = "failed"
            trace.completed_at = utc_now()
            trace.steps.append(AgentStep(
                step_number=1,
                type="conclusion",
                reasoning="Diagnosis aborted due to missing API keys.",
                duration_ms=0
            ))
            trace.total_steps = len(trace.steps)
            report.agent_trace_id = trace.id
            return report, trace

        try:
            full_context = memory.build_full_context()
            
            initial_prompt = INITIAL_ANOMALY_PROMPT.format(
                anomaly_id=anomaly.id,
                anomaly_type=anomaly.type.value,
                current_value=round(anomaly.current_value, 2),
                threshold=round(anomaly.threshold, 2),
                severity=anomaly.severity,
                details=anomaly.details,
                metrics_summary=json.dumps([m.model_dump(mode="json") for m in metrics_context[-20:]], indent=2),
                call_stack=json.dumps(anomaly.call_stack, indent=2),
                full_context=full_context,
            )

            report = await asyncio.wait_for(
                asyncio.to_thread(self._run_agent_loop, anomaly, initial_prompt, trace, source_context),
                timeout=getattr(settings, 'agent_timeout_seconds', 120),
            )
            report.agent_trace_id = trace.id
            return report, trace
        except Exception as e:
            # Return an error report on exception
            report = self._create_error_report(anomaly, f"Agent loop failed due to error: {str(e)}")
            trace.status = "failed"
            trace.completed_at = utc_now()
            trace.steps.append(AgentStep(
                step_number=len(trace.steps) + 1,
                type="conclusion",
                reasoning=f"Agent loop failed: {str(e)}",
                duration_ms=0
            ))
            trace.total_steps = len(trace.steps)
            report.agent_trace_id = trace.id
            return report, trace



    def _run_agent_loop(
        self,
        anomaly: AnomalyEvent,
        initial_prompt: str,
        trace: AgentTrace,
        source_context: SourceContext | None,
    ) -> DiagnosticReport:
        # Normalised message history for the router
        messages: list[dict] = [
            {"role": "user", "content": initial_prompt}
        ]

        actual_model = "unknown"

        for step_num in range(self.max_steps):
            if getattr(self.tool_context.monitor.config, 'llm_kill_switch', False):
                trace.status = "failed"
                trace.completed_at = utc_now()
                trace.steps.append(AgentStep(
                    step_number=step_num + 1,
                    type="conclusion",
                    reasoning="Diagnosis aborted: LLM Kill Switch activated during investigation.",
                    duration_ms=0
                ))
                trace.total_steps = len(trace.steps)
                return self._create_error_report(anomaly, "Diagnosis aborted: LLM Kill Switch activated during investigation.")

            start_time = time.time()

            # Retry up to 3 times (the router itself handles provider failover)
            response: LLMResponse | None = None
            for attempt in range(3):
                try:
                    response = router.generate(
                        messages=messages,
                        tools=self.tools,
                        system_prompt=AGENT_SYSTEM_PROMPT,
                        anomaly_id=anomaly.id,
                    )
                    actual_model = f"{response.provider_name}/{response.model_name}"
                    trace.model_used = actual_model
                    break
                except Exception as e:
                    err_str = str(e)
                    if attempt < 2:
                        print(f"[Agent] Router attempt {attempt+1}/3 failed. Retrying in 5s... Error: {err_str[:100]}")
                        time.sleep(5)
                        continue
                    raise e

            if response is None:
                raise RuntimeError("All LLM providers exhausted after retries.")

            # --- Handle tool calls ---
            if response.tool_calls:
                tc = response.tool_calls[0]  # process one tool call per loop
                tool_name = tc.name
                tool_args = tc.arguments

                step = AgentStep(
                    step_number=step_num + 1,
                    type="tool_call",
                    tool_name=tool_name,
                    tool_args=tool_args,
                    duration_ms=(time.time() - start_time) * 1000,
                    input_tokens=response.input_tokens,
                    output_tokens=response.output_tokens,
                )

                try:
                    tool_fn = next(t for t in self.tools if t.__name__ == tool_name)
                    result = tool_fn(**tool_args)
                except Exception as e:
                    result = f"Error executing tool: {str(e)}"

                if isinstance(result, str):
                    step.tool_result_summary = result[:500]
                else:
                    step.tool_result_summary = str(result)[:500]

                trace.steps.append(step)

                # Terminal tool — end the loop
                if tool_name == "submit_diagnosis":
                    trace.status = "completed"
                    trace.completed_at = utc_now()
                    trace.total_steps = len(trace.steps)
                    trace.total_input_tokens = sum(s.input_tokens for s in trace.steps)
                    trace.total_output_tokens = sum(s.output_tokens for s in trace.steps)
                    trace.total_tokens = trace.total_input_tokens + trace.total_output_tokens
                    trace.estimated_cost_usd = estimate_cost(actual_model, trace.total_input_tokens, trace.total_output_tokens)
                    trace.total_input_tokens = sum(s.input_tokens for s in trace.steps)
                    trace.total_output_tokens = sum(s.output_tokens for s in trace.steps)
                    trace.total_tokens = trace.total_input_tokens + trace.total_output_tokens
                    trace.estimated_cost_usd = estimate_cost(response.model_name, trace.total_input_tokens, trace.total_output_tokens)

                    return DiagnosticReport(
                        anomaly_id=anomaly.id,
                        severity=anomaly.severity,
                        agent_trace_id=trace.id,
                        investigation_steps=len(trace.steps),
                        tools_used=list(set(s.tool_name for s in trace.steps if s.tool_name)),
                        model_used=actual_model,
                        root_cause_summary=str(tool_args.get("root_cause_summary") or "Anomaly detected"),
                        root_cause_function=str(tool_args.get("root_cause_function") or ""),
                        root_cause_file=str(tool_args.get("root_cause_file") or ""),
                        root_cause_lines=str(tool_args.get("root_cause_lines") or ""),
                        explanation=str(tool_args.get("explanation") or ""),
                        suggested_fix=str(tool_args.get("suggested_fix") or ""),
                        fix_justification=str(tool_args.get("fix_justification") or ""),
                        confidence_score=float(tool_args.get("confidence_score") or 0.75),
                        source_code_context="",
                    )

                # Append assistant tool call + tool result to message history
                messages.append({
                    "role": "assistant_tool_call",
                    "tool_name": tool_name,
                    "tool_args": tool_args,
                    "tool_call_id": f"call_{step_num}_{tool_name}",
                    "raw_part": getattr(tc, "raw_part", None),
                    "content": "",
                })
                messages.append({
                    "role": "tool_result",
                    "tool_name": tool_name,
                    "tool_call_id": f"call_{step_num}_{tool_name}",
                    "content": str(result),
                })

            # --- Handle text-only response (thinking) ---
            elif response.text:
                trace.steps.append(AgentStep(
                    step_number=step_num + 1,
                    type="thinking",
                    reasoning=response.text[:1000],
                    duration_ms=(time.time() - start_time) * 1000,
                    input_tokens=response.input_tokens,
                    output_tokens=response.output_tokens,
                ))
                messages.append({
                    "role": "assistant",
                    "content": response.text,
                })

        trace.status = "failed"
        trace.completed_at = utc_now()
        trace.total_steps = len(trace.steps)
        trace.total_input_tokens = sum(s.input_tokens for s in trace.steps)
        trace.total_output_tokens = sum(s.output_tokens for s in trace.steps)
        trace.total_tokens = trace.total_input_tokens + trace.total_output_tokens
        trace.estimated_cost_usd = estimate_cost(actual_model, trace.total_input_tokens, trace.total_output_tokens)
        trace.total_input_tokens = sum(s.input_tokens for s in trace.steps)
        trace.total_output_tokens = sum(s.output_tokens for s in trace.steps)
        trace.total_tokens = trace.total_input_tokens + trace.total_output_tokens
        trace.estimated_cost_usd = estimate_cost(actual_model, trace.total_input_tokens, trace.total_output_tokens)
        return self._create_error_report(anomaly, "Agent reached max steps without submitting a diagnosis.")

    def _create_error_report(
        self,
        anomaly: AnomalyEvent,
        error_msg: str,
    ) -> DiagnosticReport:
        return DiagnosticReport(
            anomaly_id=anomaly.id,
            severity=anomaly.severity,
            root_cause_summary="Agent Diagnosis Failed",
            root_cause_function="Unknown",
            root_cause_file="Unknown",
            root_cause_lines="Unknown",
            explanation=f"The agent was unable to diagnose this anomaly. Reason: {error_msg}",
            suggested_fix="No fix available.",
            fix_justification="Diagnosis did not complete successfully.",
            confidence_score=0.0,
            source_code_context="",
        )
