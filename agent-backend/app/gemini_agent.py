import asyncio
import json
import time
from typing import Any, TypedDict, List, Annotated

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
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langchain_core.messages import AnyMessage, HumanMessage, AIMessage, ToolMessage, ToolCall
import operator

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

class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    anomaly: AnomalyEvent
    trace: AgentTrace
    report: DiagnosticReport | None
    step_num: int
    tools: list[Any]
    tool_context: Any

class AgenticDiagnosticAgent:
    def __init__(self, tool_context) -> None:
        self.tool_context = tool_context
        self.model_name = "multi-provider"
        self.max_steps = getattr(settings, 'agent_max_steps', 5)
        self.tools = create_tools(tool_context)
        self.graph = self._build_graph()

    def _build_graph(self):
        workflow = StateGraph(AgentState)
        workflow.add_node("agent", self._call_model)
        workflow.add_node("tools", self._execute_tools)

        workflow.set_entry_point("agent")
        workflow.add_conditional_edges(
            "agent",
            self._should_continue,
            {
                "continue": "tools",
                "end": END
            }
        )
        workflow.add_edge("tools", "agent")

        return workflow.compile()

    def _messages_to_router_format(self, messages: list[AnyMessage]) -> list[dict]:
        router_messages = []
        for msg in messages:
            if isinstance(msg, HumanMessage):
                router_messages.append({"role": "user", "content": msg.content})
            elif isinstance(msg, AIMessage):
                if msg.tool_calls:
                    tc = msg.tool_calls[0]
                    router_messages.append({
                        "role": "assistant_tool_call",
                        "tool_name": tc["name"],
                        "tool_args": tc["args"],
                        "tool_call_id": tc["id"],
                        "raw_part": msg.additional_kwargs.get("raw_part"),
                        "content": msg.content or ""
                    })
                else:
                    router_messages.append({"role": "assistant", "content": msg.content})
            elif isinstance(msg, ToolMessage):
                router_messages.append({
                    "role": "tool_result",
                    "tool_name": msg.name,
                    "tool_call_id": msg.tool_call_id,
                    "content": str(msg.content)
                })
        return router_messages

    def _call_model(self, state: AgentState):
        if getattr(self.tool_context.monitor.config, 'llm_kill_switch', False):
            state["trace"].status = "failed"
            state["trace"].completed_at = utc_now()
            state["trace"].steps.append(AgentStep(
                step_number=state["step_num"] + 1,
                type="conclusion",
                reasoning="Diagnosis aborted: LLM Kill Switch activated during investigation.",
                duration_ms=0
            ))
            state["trace"].total_steps = len(state["trace"].steps)
            new_report = self._create_error_report(state["anomaly"], "Diagnosis aborted: LLM Kill Switch activated during investigation.")
            return {"report": new_report, "step_num": state["step_num"] + 1}

        start_time = time.time()
        messages = self._messages_to_router_format(state["messages"])

        response: LLMResponse | None = None
        for attempt in range(3):
            try:
                response = router.generate(
                    messages=messages,
                    tools=state["tools"],
                    system_prompt=AGENT_SYSTEM_PROMPT,
                    anomaly_id=state["anomaly"].id,
                )
                actual_model = f"{response.provider_name}/{response.model_name}"
                state["trace"].model_used = actual_model
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

        if response.tool_calls:
            tc = response.tool_calls[0]
            tool_name = tc.name
            tool_args = tc.arguments

            tool_call = ToolCall(name=tool_name, args=tool_args, id=f"call_{state['step_num']}_{tool_name}")
            ai_msg = AIMessage(content="", tool_calls=[tool_call], additional_kwargs={"raw_part": getattr(tc, "raw_part", None)})

            step = AgentStep(
                step_number=state["step_num"] + 1,
                type="tool_call",
                tool_name=tool_name,
                tool_args=tool_args,
                duration_ms=(time.time() - start_time) * 1000,
                input_tokens=response.input_tokens,
                output_tokens=response.output_tokens,
            )
            state["trace"].steps.append(step)

            if tool_name == "submit_diagnosis":
                state["trace"].status = "completed"
                state["trace"].completed_at = utc_now()
                state["trace"].total_steps = len(state["trace"].steps)
                state["trace"].total_input_tokens = sum(s.input_tokens for s in state["trace"].steps)
                state["trace"].total_output_tokens = sum(s.output_tokens for s in state["trace"].steps)
                state["trace"].total_tokens = state["trace"].total_input_tokens + state["trace"].total_output_tokens
                state["trace"].estimated_cost_usd = estimate_cost(actual_model, state["trace"].total_input_tokens, state["trace"].total_output_tokens)

                new_report = DiagnosticReport(
                    anomaly_id=state["anomaly"].id,
                    severity=state["anomaly"].severity,
                    agent_trace_id=state["trace"].id,
                    investigation_steps=len(state["trace"].steps),
                    tools_used=list(set(s.tool_name for s in state["trace"].steps if s.tool_name)),
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
                return {"messages": [ai_msg], "step_num": state["step_num"] + 1, "report": new_report}

            return {"messages": [ai_msg], "step_num": state["step_num"] + 1}

        elif response.text:
            ai_msg = AIMessage(content=response.text)
            state["trace"].steps.append(AgentStep(
                step_number=state["step_num"] + 1,
                type="thinking",
                reasoning=response.text[:1000],
                duration_ms=(time.time() - start_time) * 1000,
                input_tokens=response.input_tokens,
                output_tokens=response.output_tokens,
            ))
            return {"messages": [ai_msg], "step_num": state["step_num"] + 1}

        return {"step_num": state["step_num"] + 1}

    def _execute_tools(self, state: AgentState):
        last_message = state["messages"][-1]
        if not isinstance(last_message, AIMessage) or not last_message.tool_calls:
            return state

        tool_call = last_message.tool_calls[0]
        tool_name = tool_call["name"]

        if tool_name == "submit_diagnosis":
             return {"messages": [ToolMessage(content="DIAGNOSIS_SUBMITTED", name=tool_name, tool_call_id=tool_call["id"])]}

        try:
            tool_fn = next(t for t in state["tools"] if t.__name__ == tool_name)
            result = tool_fn(**tool_call["args"])
        except Exception as e:
            result = f"Error executing tool: {str(e)}"

        if state["trace"].steps:
            last_step = state["trace"].steps[-1]
            if isinstance(result, str):
                last_step.tool_result_summary = result[:500]
            else:
                last_step.tool_result_summary = str(result)[:500]

        return {"messages": [ToolMessage(content=str(result), name=tool_name, tool_call_id=tool_call["id"])]}

    def _should_continue(self, state: AgentState) -> str:
        if state["report"] is not None:
             return "end"
        if state["step_num"] >= self.max_steps:
             return "end"
        last_message = state["messages"][-1]
        if isinstance(last_message, AIMessage) and last_message.tool_calls:
            return "continue"
        return "end"

    async def diagnose(
        self,
        anomaly: AnomalyEvent,
        metrics_context: list[MetricPoint],
        source_context: SourceContext | None,
        memory: AgentMemory,
    ) -> tuple[DiagnosticReport, AgentTrace]:
        trace = AgentTrace(anomaly_id=anomaly.id, model_used=self.model_name)
        
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

            initial_state = AgentState(
                messages=[HumanMessage(content=initial_prompt)],
                anomaly=anomaly,
                trace=trace,
                report=None,
                step_num=0,
                tools=self.tools,
                tool_context=self.tool_context
            )

            final_state = await asyncio.wait_for(
                self.graph.ainvoke(initial_state),
                timeout=getattr(settings, 'agent_timeout_seconds', 120),
            )

            report = final_state.get("report")
            trace = final_state.get("trace")

            if report is None:
                 report = self._create_error_report(anomaly, "Agent reached max steps without submitting a diagnosis.")
                 trace.status = "failed"
                 trace.completed_at = utc_now()
                 trace.total_steps = len(trace.steps)
                 trace.total_input_tokens = sum(s.input_tokens for s in trace.steps)
                 trace.total_output_tokens = sum(s.output_tokens for s in trace.steps)
                 trace.total_tokens = trace.total_input_tokens + trace.total_output_tokens
                 trace.estimated_cost_usd = estimate_cost(trace.model_used, trace.total_input_tokens, trace.total_output_tokens)

            report.agent_trace_id = trace.id
            return report, trace
        except Exception as e:
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
