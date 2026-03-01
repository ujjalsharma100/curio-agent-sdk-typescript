/**
 * OpenTelemetry tracing middleware for the Curio Agent SDK.
 *
 * If @opentelemetry/api is not installed, this middleware is a no-op.
 */

import type { LLMRequest, LLMResponse } from "../models/llm.js";
import type { Middleware } from "./base.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("middleware.tracing");

type Tracer = {
  startSpan: (name: string, attrs?: Record<string, unknown>) => Span;
};
type Span = {
  setAttribute: (k: string, v: unknown) => void;
  setStatus: (status: { code: number; message?: string }, msg?: string) => void;
  recordException: (err: Error) => void;
  end: () => void;
};
type Meter = {
  createHistogram: (name: string, opts?: { description?: string; unit?: string }) => Histogram;
  createCounter: (name: string, opts?: { description?: string; unit?: string }) => Counter;
};
type Histogram = { record: (value: number, attrs?: Record<string, string>) => void };
type Counter = { add: (value: number, attrs?: Record<string, string>) => void };

let otelAvailable = false;
let tracer: Tracer | null = null;
let metrics: Meter | null = null;
let StatusCode: { OK: number; ERROR: number } | null = null;
let warningLogged = false;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const otel = require("@opentelemetry/api");
  const trace = otel.trace;
  const metricsMod = otel.metrics;
  if (trace && trace.getTracer && metricsMod?.getMeter) {
    otelAvailable = true;
    tracer = trace;
    metrics = metricsMod;
    StatusCode = { OK: 1, ERROR: 2 };
  }
} catch {
  // optional dependency not installed
}

export interface TracingMiddlewareOptions {
  serviceName?: string;
  tracer?: Tracer;
  meter?: Meter;
}

/**
 * Emits OpenTelemetry spans and metrics for every LLM and tool call.
 * No-op if @opentelemetry/api is not installed.
 */
export class TracingMiddleware implements Middleware {
  readonly name = "TracingMiddleware";
  private readonly enabled: boolean;
  private readonly _tracer: Tracer | null;
  private readonly _meter: Meter | null;
  private readonly statusCode: { OK: number; ERROR: number } | null = null;
  private llmSpans = new Map<string, Span>();
  private llmStarts = new Map<string, number>();
  private toolSpans = new Map<string, Span>();
  private toolStarts = new Map<string, number>();
  private llmDuration?: Histogram;
  private llmInputTokens?: Counter;
  private llmOutputTokens?: Counter;
  private toolDuration?: Histogram;
  private toolErrors?: Counter;

  constructor(options: TracingMiddlewareOptions = {}) {
    this.enabled = otelAvailable;
    if (!this.enabled) {
      if (!warningLogged) {
        log.warn(
          "opentelemetry-api not installed. TracingMiddleware will be a no-op. Install with: npm install @opentelemetry/api",
        );
        warningLogged = true;
      }
      this._tracer = null;
      this._meter = null;
      return;
    }
    const serviceName = options.serviceName ?? "curio-agent";
    const traceApi = tracer as { getTracer?: (name: string) => Tracer } | Tracer | null;
    this._tracer = options.tracer ?? (traceApi && "getTracer" in traceApi && traceApi.getTracer ? traceApi.getTracer(serviceName) : (tracer as Tracer));
    const meterApi = metrics as { getMeter?: (name: string) => Meter } | Meter | null;
    this._meter = options.meter ?? (meterApi && "getMeter" in meterApi && meterApi.getMeter ? meterApi.getMeter(serviceName) : (metrics as Meter));
    this.statusCode = StatusCode;
    if (this._meter) {
      this.llmDuration = this._meter.createHistogram("agent.llm.duration", {
        description: "Duration of LLM calls in milliseconds",
        unit: "ms",
      });
      this.llmInputTokens = this._meter.createCounter("agent.llm.tokens.input", {
        description: "Total input tokens sent to LLMs",
        unit: "tokens",
      });
      this.llmOutputTokens = this._meter.createCounter("agent.llm.tokens.output", {
        description: "Total output tokens received from LLMs",
        unit: "tokens",
      });
      this.toolDuration = this._meter.createHistogram("agent.tool.duration", {
        description: "Duration of tool calls in milliseconds",
        unit: "ms",
      });
      this.toolErrors = this._meter.createCounter("agent.tool.errors", {
        description: "Total tool call errors",
      });
    }
  }

  async beforeLLMCall(request: LLMRequest): Promise<LLMRequest> {
    if (!this.enabled || !this._tracer) return request;
    const span = this._tracer.startSpan("llm.call", {
      "llm.model": request.model ?? "",
      "llm.max_tokens": request.maxTokens,
      "llm.temperature": request.temperature,
      "llm.message_count": request.messages?.length ?? 0,
    });
    const key = `llm:${Math.random().toString(36).slice(2)}`;
    (request as { _tracingKey?: string })._tracingKey = key;
    this.llmSpans.set(key, span);
    this.llmStarts.set(key, performance.now());
    return request;
  }

  async afterLLMCall(request: LLMRequest, response: LLMResponse): Promise<LLMResponse> {
    if (!this.enabled) return response;
    const key = (request as { _tracingKey?: string })._tracingKey;
    const span = key ? this.llmSpans.get(key) : undefined;
    const start = key ? this.llmStarts.get(key) : undefined;
    if (key) {
      this.llmSpans.delete(key);
      this.llmStarts.delete(key);
    }
    const latencyMs = start != null ? performance.now() - start : 0;

    if (span) {
      span.setAttribute("llm.model", response.model);
      span.setAttribute("llm.input_tokens", response.usage.promptTokens);
      span.setAttribute("llm.output_tokens", response.usage.completionTokens);
      span.setAttribute("llm.finish_reason", response.finishReason);
      span.setAttribute("llm.latency_ms", latencyMs);
      if (response.finishReason === "error") {
        span.setStatus({ code: this.statusCode!.ERROR, message: (response as { error?: string }).error ?? "LLM call failed" });
      } else {
        span.setStatus({ code: this.statusCode!.OK });
      }
      span.end();
    }

    const attrs = { provider: (response as { provider?: string }).provider ?? "", model: response.model };
    this.llmDuration?.record(latencyMs, attrs);
    this.llmInputTokens?.add(response.usage.promptTokens, attrs);
    this.llmOutputTokens?.add(response.usage.completionTokens, attrs);
    return response;
  }

  async beforeToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ toolName: string; args: Record<string, unknown> }> {
    if (!this.enabled || !this._tracer) return { toolName, args };
    const span = this._tracer.startSpan("tool.call", { "tool.name": toolName });
    const callKey = `tool:${toolName}:${Math.random().toString(36).slice(2)}`;
    (args as Record<string, unknown>).__tracingCallKey = callKey;
    this.toolSpans.set(callKey, span);
    this.toolStarts.set(callKey, performance.now());
    return { toolName, args };
  }

  async afterToolCall(
    toolName: string,
    args: Record<string, unknown>,
    result: string,
  ): Promise<string> {
    if (!this.enabled) return result;
    const callKey = args.__tracingCallKey as string | undefined;
    if (callKey !== undefined) {
      delete args.__tracingCallKey;
    }
    const span = callKey ? this.toolSpans.get(callKey) : undefined;
    const start = callKey ? this.toolStarts.get(callKey) : undefined;
    if (callKey) {
      this.toolSpans.delete(callKey);
      this.toolStarts.delete(callKey);
    }
    const latencyMs = start != null ? performance.now() - start : 0;
    if (span) {
      span.setAttribute("tool.latency_ms", latencyMs);
      span.setStatus({ code: this.statusCode!.OK });
      span.end();
    }
    this.toolDuration?.record(latencyMs, { tool_name: toolName });
    return result;
  }

  async onError(error: Error, context: Record<string, unknown>): Promise<Error> {
    if (!this.enabled) return error;
    const phase = context.phase as string | undefined;
    if (phase === "llm_call") {
      const req = context.request as LLMRequest & { _tracingKey?: string } | undefined;
      const key = req?._tracingKey;
      if (key) {
        const span = this.llmSpans.get(key);
        this.llmSpans.delete(key);
        this.llmStarts.delete(key);
        if (span) {
          span.setStatus({ code: this.statusCode!.ERROR, message: error.message });
          span.recordException(error);
          span.end();
        }
      }
    }
    if (phase === "tool_call") {
      const toolName = (context.tool_name as string) ?? "unknown";
      this.toolErrors?.add(1, { tool_name: toolName });
      for (const [k, span] of this.toolSpans) {
        if (k.startsWith(`${toolName}:`)) {
          this.toolSpans.delete(k);
          this.toolStarts.delete(k);
          span.setStatus({ code: this.statusCode!.ERROR, message: error.message });
          span.recordException(error);
          span.end();
          break;
        }
      }
    }
    return error;
  }
}
