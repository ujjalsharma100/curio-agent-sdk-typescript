/**
 * Hook-based observability consumers — attach to HookRegistry for tracing,
 * logging, and persistence without wrapping the LLM client.
 *
 * Prefer these over middleware when you want run_id–based correlation and
 * cleaner trace graphs.
 */

import type { HookRegistry } from "../core/events/hooks.js";
import { HookContext, HookEvent } from "../models/events.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("middleware.consumers");

// ---------------------------------------------------------------------------
// TracingConsumer
// ---------------------------------------------------------------------------

let otelConsumerAvailable = false;
let traceApi: { getTracer: (name: string, version?: string) => Tracer; getCurrentSpan: () => Span } | null = null;
let metricsApi: { getMeter: (name: string, version?: string) => Meter } | null = null;
let StatusCode: { OK: number; ERROR: number } | null = null;

interface Tracer {
  startSpan: (name: string, attrs?: Record<string, unknown>) => Span;
}
interface Span {
  setAttribute: (k: string, v: unknown) => void;
  setStatus: (status: number, message?: string) => void;
  recordException: (err: Error) => void;
  end: () => void;
}
interface Meter {
  createHistogram: (name: string, opts?: { description?: string; unit?: string }) => Histogram;
  createCounter: (name: string, opts?: { description?: string; unit?: string }) => Counter;
}
interface Histogram {
  record: (value: number, attrs?: Record<string, string>) => void;
}
interface Counter {
  add: (value: number, attrs?: Record<string, string>) => void;
}

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const otel = require("@opentelemetry/api");
  if (otel.trace?.getTracer && otel.metrics?.getMeter) {
    otelConsumerAvailable = true;
    traceApi = otel.trace;
    metricsApi = otel.metrics;
    StatusCode = { OK: 1, ERROR: 2 };
  }
} catch {
  // optional
}

export interface TracingConsumerOptions {
  serviceName?: string;
  tracer?: Tracer;
  meter?: Meter;
}

/**
 * Hook-based OpenTelemetry tracing consumer. Creates spans for llm.call, tool.call, agent.run.
 */
export class TracingConsumer {
  private readonly enabled: boolean;
  private readonly tracer: Tracer | null;
  private readonly meter: Meter | null;
  private readonly statusCode: { OK: number; ERROR: number } | null = null;
  private llmSpans = new Map<string, Span>();
  private llmStarts = new Map<string, number>();
  private toolSpans = new Map<string, Span>();
  private toolStarts = new Map<string, number>();
  private runSpans = new Map<string, Span>();
  private _handlers: Array<{ event: string; handler: (ctx: HookContext) => Promise<void> }> = [];
  private llmDuration?: Histogram;
  private llmInputTokens?: Counter;
  private llmOutputTokens?: Counter;
  private toolDuration?: Histogram;
  private toolErrors?: Counter;

  constructor(options: TracingConsumerOptions = {}) {
    this.enabled = otelConsumerAvailable;
    const serviceName = options.serviceName ?? "curio-agent";
    this.tracer = options.tracer ?? (traceApi ? traceApi.getTracer(serviceName) : null) ?? null;
    this.meter = options.meter ?? (metricsApi ? metricsApi.getMeter(serviceName) : null) ?? null;
    this.statusCode = StatusCode;
    if (!this.enabled) {
      log.warn("opentelemetry-api not installed. TracingConsumer will be a no-op.");
      return;
    }
    if (this.meter) {
      this.llmDuration = this.meter.createHistogram("agent.llm.duration", {
        description: "Duration of LLM calls in milliseconds",
        unit: "ms",
      });
      this.llmInputTokens = this.meter.createCounter("agent.llm.tokens.input", {
        description: "Total input tokens sent to LLMs",
        unit: "tokens",
      });
      this.llmOutputTokens = this.meter.createCounter("agent.llm.tokens.output", {
        description: "Total output tokens received from LLMs",
        unit: "tokens",
      });
      this.toolDuration = this.meter.createHistogram("agent.tool.duration", {
        description: "Duration of tool calls in milliseconds",
        unit: "ms",
      });
      this.toolErrors = this.meter.createCounter("agent.tool.errors", {
        description: "Total tool call errors",
      });
    }
  }

  attach(registry: HookRegistry): void {
    if (!this.enabled || !this.tracer) return;
    const onLlmBefore = async (ctx: HookContext) => {
      const request = ctx.data.request as { messages?: unknown[] } | undefined;
      const span = this.tracer!.startSpan("llm.call", {
        "llm.model": ctx.data.model ?? "",
        run_id: ctx.runId ?? "",
        agent_id: ctx.agentId ?? "",
        "llm.message_count": request?.messages?.length ?? 0,
      });
      const key = `llm:${ctx.runId ?? ""}:${Date.now()}`;
      (ctx.data as Record<string, unknown>)._tracing_key = key;
      this.llmSpans.set(key, span);
      this.llmStarts.set(key, performance.now());
    };
    const onLlmAfter = async (ctx: HookContext) => {
      const key = (ctx.data._tracing_key as string) ?? "";
      const span = this.llmSpans.get(key);
      this.llmSpans.delete(key);
      const start = this.llmStarts.get(key);
      this.llmStarts.delete(key);
      const latencyMs = start != null ? performance.now() - start : 0;
      const response = ctx.data.response as {
        provider?: string;
        model?: string;
        usage?: { promptTokens?: number; completionTokens?: number };
        finishReason?: string;
      } | undefined;
      const provider = response?.provider ?? "";
      const model = response?.model ?? "";
      const inputTokens = response?.usage?.promptTokens ?? 0;
      const outputTokens = response?.usage?.completionTokens ?? 0;
      if (span) {
        span.setAttribute("llm.provider", provider);
        span.setAttribute("llm.model", model);
        span.setAttribute("llm.input_tokens", inputTokens);
        span.setAttribute("llm.output_tokens", outputTokens);
        span.setAttribute("llm.finish_reason", response?.finishReason ?? "");
        span.setAttribute("llm.latency_ms", latencyMs);
        span.setStatus(
          response?.finishReason === "error" ? this.statusCode!.ERROR : this.statusCode!.OK,
          response?.finishReason === "error" ? "LLM call failed" : undefined,
        );
        span.end();
      }
      const attrs = { provider, model };
      this.llmDuration?.record(latencyMs, attrs);
      if (inputTokens) this.llmInputTokens?.add(inputTokens, attrs);
      if (outputTokens) this.llmOutputTokens?.add(outputTokens, attrs);
    };
    const onLlmError = async (ctx: HookContext) => {
      const key = (ctx.data._tracing_key as string) ?? "";
      const span = this.llmSpans.get(key);
      this.llmSpans.delete(key);
      this.llmStarts.delete(key);
      const err = ctx.data.exception as Error | undefined;
      if (span) {
        span.setStatus(this.statusCode!.ERROR, String(ctx.data.error));
        if (err) span.recordException(err);
        span.end();
      }
    };
    const onToolBefore = async (ctx: HookContext) => {
      const toolName = (ctx.data.tool_name as string) ?? "unknown";
      const span = this.tracer!.startSpan("tool.call", {
        "tool.name": toolName,
        run_id: ctx.runId ?? "",
        agent_id: ctx.agentId ?? "",
      });
      const key = `tool:${ctx.runId ?? ""}:${toolName}:${Date.now()}`;
      (ctx.data as Record<string, unknown>)._tracing_tool_key = key;
      this.toolSpans.set(key, span);
      this.toolStarts.set(key, performance.now());
    };
    const onToolAfter = async (ctx: HookContext) => {
      const key = (ctx.data._tracing_tool_key as string) ?? "";
      const toolName = (ctx.data.tool_name as string) ?? "unknown";
      const span = this.toolSpans.get(key);
      this.toolSpans.delete(key);
      const start = this.toolStarts.get(key);
      this.toolStarts.delete(key);
      const latencyMs = start != null ? performance.now() - start : 0;
      if (span) {
        span.setAttribute("tool.latency_ms", latencyMs);
        span.setStatus(this.statusCode!.OK);
        span.end();
      }
      this.toolDuration?.record(latencyMs, { tool_name: toolName });
    };
    const onToolError = async (ctx: HookContext) => {
      const key = (ctx.data._tracing_tool_key as string) ?? "";
      const toolName = (ctx.data.tool_name as string) ?? "unknown";
      const span = this.toolSpans.get(key);
      this.toolSpans.delete(key);
      this.toolStarts.delete(key);
      const err = ctx.data.error as Error | undefined;
      if (span) {
        span.setStatus(this.statusCode!.ERROR, String(ctx.data.error));
        if (err instanceof Error) span.recordException(err);
        span.end();
      }
      this.toolErrors?.add(1, { tool_name: toolName });
    };
    const onRunBefore = async (ctx: HookContext) => {
      const span = this.tracer!.startSpan("agent.run", {
        run_id: ctx.runId ?? "",
        agent_id: ctx.agentId ?? "",
      });
      this.runSpans.set(ctx.runId ?? "", span);
    };
    const onRunAfter = async (ctx: HookContext) => {
      const span = this.runSpans.get(ctx.runId ?? "");
      this.runSpans.delete(ctx.runId ?? "");
      if (span) {
        span.setStatus(this.statusCode!.OK);
        span.end();
      }
    };
    const onRunError = async (ctx: HookContext) => {
      const span = this.runSpans.get(ctx.runId ?? "");
      this.runSpans.delete(ctx.runId ?? "");
      const err = ctx.data.exception as Error | undefined;
      if (span) {
        span.setStatus(this.statusCode!.ERROR, String(ctx.data.error));
        if (err instanceof Error) span.recordException(err);
        span.end();
      }
    };

    registry.on(HookEvent.LLM_CALL_BEFORE, onLlmBefore);
    registry.on(HookEvent.LLM_CALL_AFTER, onLlmAfter);
    registry.on(HookEvent.LLM_CALL_ERROR, onLlmError);
    registry.on(HookEvent.TOOL_CALL_BEFORE, onToolBefore);
    registry.on(HookEvent.TOOL_CALL_AFTER, onToolAfter);
    registry.on(HookEvent.TOOL_CALL_ERROR, onToolError);
    registry.on(HookEvent.AGENT_RUN_BEFORE, onRunBefore);
    registry.on(HookEvent.AGENT_RUN_AFTER, onRunAfter);
    registry.on(HookEvent.AGENT_RUN_ERROR, onRunError);
    this._handlers = [
      { event: HookEvent.LLM_CALL_BEFORE, handler: onLlmBefore },
      { event: HookEvent.LLM_CALL_AFTER, handler: onLlmAfter },
      { event: HookEvent.LLM_CALL_ERROR, handler: onLlmError },
      { event: HookEvent.TOOL_CALL_BEFORE, handler: onToolBefore },
      { event: HookEvent.TOOL_CALL_AFTER, handler: onToolAfter },
      { event: HookEvent.TOOL_CALL_ERROR, handler: onToolError },
      { event: HookEvent.AGENT_RUN_BEFORE, handler: onRunBefore },
      { event: HookEvent.AGENT_RUN_AFTER, handler: onRunAfter },
      { event: HookEvent.AGENT_RUN_ERROR, handler: onRunError },
    ];
  }

  detach(registry: HookRegistry): void {
    for (const { event, handler } of this._handlers) {
      registry.off(event, handler);
    }
    this._handlers = [];
  }
}

// ---------------------------------------------------------------------------
// LoggingConsumer
// ---------------------------------------------------------------------------

export interface LoggingConsumerOptions {
  level?: "debug" | "info" | "warn" | "error";
  loggerName?: string;
}

/**
 * Hook-based structured logging consumer.
 */
export class LoggingConsumer {
  private readonly level: "debug" | "info" | "warn" | "error";
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly starts = new Map<string, number>();
  private _handlers: Array<{ event: string; handler: (ctx: HookContext) => Promise<void> }> = [];

  constructor(options: LoggingConsumerOptions = {}) {
    this.level = options.level ?? "info";
    this.logger = options.loggerName
      ? createLogger(options.loggerName)
      : createLogger("curio.consumers.logging");
  }

  attach(registry: HookRegistry): void {
    const onLlmBefore = async (ctx: HookContext) => {
      const key = `llm:${ctx.runId ?? ""}:${Date.now()}`;
      (ctx.data as Record<string, unknown>)._logging_key = key;
      this.starts.set(key, performance.now());
      this.logger[this.level](
        { runId: ctx.runId, model: ctx.data.model, provider: ctx.data.provider },
        "LLM call started",
      );
    };
    const onLlmAfter = async (ctx: HookContext) => {
      const key = (ctx.data._logging_key as string) ?? "";
      const start = this.starts.get(key);
      this.starts.delete(key);
      const elapsed = start != null ? performance.now() - start : 0;
      const response = ctx.data.response as {
        model?: string;
        finishReason?: string;
        usage?: { promptTokens?: number; completionTokens?: number };
      } | undefined;
      this.logger[this.level](
        {
          runId: ctx.runId,
          model: response?.model,
          finishReason: response?.finishReason,
          inputTokens: response?.usage?.promptTokens ?? 0,
          outputTokens: response?.usage?.completionTokens ?? 0,
          latencyMs: Math.round(elapsed),
        },
        "LLM call completed",
      );
    };
    const onLlmError = async (ctx: HookContext) => {
      this.logger.error({ runId: ctx.runId, error: ctx.data.error }, "LLM call error");
    };
    const onToolBefore = async (ctx: HookContext) => {
      const toolName = (ctx.data.tool_name as string) ?? "unknown";
      const key = `tool:${ctx.runId ?? ""}:${toolName}:${Date.now()}`;
      (ctx.data as Record<string, unknown>)._logging_tool_key = key;
      this.starts.set(key, performance.now());
      this.logger[this.level]({ runId: ctx.runId, tool: toolName }, "Tool call started");
    };
    const onToolAfter = async (ctx: HookContext) => {
      const key = (ctx.data._logging_tool_key as string) ?? "";
      const start = this.starts.get(key);
      this.starts.delete(key);
      const elapsed = start != null ? performance.now() - start : 0;
      const toolName = (ctx.data.tool_name as string) ?? "unknown";
      const result = ctx.data.result as string | undefined;
      const preview = result != null ? String(result).slice(0, 200) : "None";
      this.logger[this.level](
        { runId: ctx.runId, tool: toolName, latencyMs: Math.round(elapsed), resultPreview: preview },
        "Tool call completed",
      );
    };
    const onToolError = async (ctx: HookContext) => {
      this.logger.error(
        { runId: ctx.runId, tool: ctx.data.tool_name, error: ctx.data.error },
        "Tool call error",
      );
    };
    const onRunBefore = async (ctx: HookContext) => {
      this.logger[this.level]({ runId: ctx.runId, agentId: ctx.agentId }, "Agent run started");
    };
    const onRunAfter = async (ctx: HookContext) => {
      this.logger[this.level]({ runId: ctx.runId, agentId: ctx.agentId }, "Agent run completed");
    };
    const onRunError = async (ctx: HookContext) => {
      this.logger.error(
        { runId: ctx.runId, agentId: ctx.agentId, error: ctx.data.error },
        "Agent run error",
      );
    };

    registry.on(HookEvent.LLM_CALL_BEFORE, onLlmBefore);
    registry.on(HookEvent.LLM_CALL_AFTER, onLlmAfter);
    registry.on(HookEvent.LLM_CALL_ERROR, onLlmError);
    registry.on(HookEvent.TOOL_CALL_BEFORE, onToolBefore);
    registry.on(HookEvent.TOOL_CALL_AFTER, onToolAfter);
    registry.on(HookEvent.TOOL_CALL_ERROR, onToolError);
    registry.on(HookEvent.AGENT_RUN_BEFORE, onRunBefore);
    registry.on(HookEvent.AGENT_RUN_AFTER, onRunAfter);
    registry.on(HookEvent.AGENT_RUN_ERROR, onRunError);
    this._handlers = [
      { event: HookEvent.LLM_CALL_BEFORE, handler: onLlmBefore },
      { event: HookEvent.LLM_CALL_AFTER, handler: onLlmAfter },
      { event: HookEvent.LLM_CALL_ERROR, handler: onLlmError },
      { event: HookEvent.TOOL_CALL_BEFORE, handler: onToolBefore },
      { event: HookEvent.TOOL_CALL_AFTER, handler: onToolAfter },
      { event: HookEvent.TOOL_CALL_ERROR, handler: onToolError },
      { event: HookEvent.AGENT_RUN_BEFORE, handler: onRunBefore },
      { event: HookEvent.AGENT_RUN_AFTER, handler: onRunAfter },
      { event: HookEvent.AGENT_RUN_ERROR, handler: onRunError },
    ];
  }

  detach(registry: HookRegistry): void {
    for (const { event, handler } of this._handlers) {
      registry.off(event, handler);
    }
    this._handlers = [];
  }
}

// ---------------------------------------------------------------------------
// PersistenceConsumer (placeholder — requires BasePersistence from Phase 16)
// ---------------------------------------------------------------------------

/**
 * Hook-based persistence consumer. Writes run/LLM/tool events to a persistence backend.
 * Pass a persistence adapter when Phase 16 (Persistence) is implemented.
 */
export class PersistenceConsumer {
  private _handlers: Array<{ event: string; handler: (ctx: HookContext) => Promise<void> }> = [];
  private llmStarts = new Map<string, number>();

  constructor(
    private readonly persistence: {
      logAgentRunEvent?: (event: {
        agentId?: string;
        runId?: string;
        agentName?: string;
        timestamp: Date;
        eventType: string;
        data?: string | null;
      }) => void | Promise<void>;
      logLLMUsage?: (usage: {
        agentId?: string | null;
        runId?: string | null;
        provider: string;
        model: string;
        inputTokens: number;
        outputTokens: number;
        latencyMs: number;
        status: string;
      }) => void | Promise<void>;
    },
  ) {}

  attach(registry: HookRegistry): void {
    const onLlmBefore = async (ctx: HookContext) => {
      const key = `llm:${ctx.runId ?? ""}:${Date.now()}`;
      (ctx.data as Record<string, unknown>)._persist_key = key;
      this.llmStarts.set(key, performance.now());
    };
    const onLlmAfter = async (ctx: HookContext) => {
      const key = (ctx.data._persist_key as string) ?? "";
      const start = this.llmStarts.get(key);
      this.llmStarts.delete(key);
      const latencyMs = start != null ? Math.round(performance.now() - start) : 0;
      const response = ctx.data.response as {
        provider?: string;
        model?: string;
        usage?: { promptTokens?: number; completionTokens?: number };
      } | undefined;
      if (this.persistence.logLLMUsage && response) {
        try {
          await this.persistence.logLLMUsage({
            agentId: ctx.agentId ?? null,
            runId: ctx.runId ?? null,
            provider: response.provider ?? "",
            model: response.model ?? "",
            inputTokens: response.usage?.promptTokens ?? 0,
            outputTokens: response.usage?.completionTokens ?? 0,
            latencyMs,
            status: "success",
          });
        } catch (e) {
          log.warn({ err: e }, "PersistenceConsumer failed to log LLM usage");
        }
      }
    };
    const onToolAfter = async (ctx: HookContext) => {
      const toolName = (ctx.data.tool_name as string) ?? "unknown";
      const result = ctx.data.result;
      const resultStr = result != null ? String(result).slice(0, 500) : "";
      if (this.persistence.logAgentRunEvent) {
        try {
          await this.persistence.logAgentRunEvent({
            agentId: ctx.agentId,
            runId: ctx.runId,
            agentName: (ctx.data.agent_name as string) ?? "",
            timestamp: new Date(),
            eventType: "tool_call",
            data: JSON.stringify({ tool_name: toolName, result_preview: resultStr }),
          });
        } catch (e) {
          log.warn({ err: e }, "PersistenceConsumer failed to log tool event");
        }
      }
    };
    const onRunBefore = async (ctx: HookContext) => {
      if (this.persistence.logAgentRunEvent) {
        try {
          await this.persistence.logAgentRunEvent({
            agentId: ctx.agentId,
            runId: ctx.runId,
            agentName: (ctx.data.agent_name as string) ?? "",
            timestamp: new Date(),
            eventType: "agent_run_started",
            data: undefined,
          });
        } catch (e) {
          log.warn({ err: e }, "PersistenceConsumer failed to log run start");
        }
      }
    };
    const onRunAfter = async (ctx: HookContext) => {
      if (this.persistence.logAgentRunEvent) {
        try {
          await this.persistence.logAgentRunEvent({
            agentId: ctx.agentId,
            runId: ctx.runId,
            agentName: (ctx.data.agent_name as string) ?? "",
            timestamp: new Date(),
            eventType: "agent_run_completed",
            data: JSON.stringify({ status: (ctx.data.status as string) ?? "completed" }),
          });
        } catch (e) {
          log.warn({ err: e }, "PersistenceConsumer failed to log run end");
        }
      }
    };

    registry.on(HookEvent.LLM_CALL_BEFORE, onLlmBefore);
    registry.on(HookEvent.LLM_CALL_AFTER, onLlmAfter);
    registry.on(HookEvent.TOOL_CALL_AFTER, onToolAfter);
    registry.on(HookEvent.AGENT_RUN_BEFORE, onRunBefore);
    registry.on(HookEvent.AGENT_RUN_AFTER, onRunAfter);
    this._handlers = [
      { event: HookEvent.LLM_CALL_BEFORE, handler: onLlmBefore },
      { event: HookEvent.LLM_CALL_AFTER, handler: onLlmAfter },
      { event: HookEvent.TOOL_CALL_AFTER, handler: onToolAfter },
      { event: HookEvent.AGENT_RUN_BEFORE, handler: onRunBefore },
      { event: HookEvent.AGENT_RUN_AFTER, handler: onRunAfter },
    ];
  }

  detach(registry: HookRegistry): void {
    for (const { event, handler } of this._handlers) {
      registry.off(event, handler);
    }
    this._handlers = [];
  }
}

// ---------------------------------------------------------------------------
// TraceContextFilter — for pino/logging to add trace_id/span_id (no-op if no OTel)
// ---------------------------------------------------------------------------

/**
 * Placeholder for a logging filter that injects trace_id/span_id when OpenTelemetry is available.
 * Can be used with pino or other loggers that support a filter/bind step.
 */
export function getTraceContext(): { trace_id?: string; span_id?: string } {
  if (!otelConsumerAvailable || !traceApi) return {};
  try {
    const span = traceApi.getCurrentSpan();
    if (!span) return {};
    const sc = (span as { spanContext?: () => { traceId: string; spanId: string } }).spanContext?.();
    if (!sc?.traceId) return {};
    return {
      trace_id: sc.traceId,
      span_id: sc.spanId,
    };
  } catch {
    return {};
  }
}
