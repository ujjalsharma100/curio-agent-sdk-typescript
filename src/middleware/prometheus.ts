/**
 * Prometheus metrics exporter — hook consumer that exposes Prometheus counters,
 * histograms, and gauges for LLM calls, tool calls, cost, and active runs.
 *
 * If prom-client is not installed, the exporter is a no-op.
 */

import type { HookRegistry } from "../core/events/hooks.js";
import { HookContext } from "../models/events.js";
import { HookEvent } from "../models/events.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("middleware.prometheus");

type Counter = { inc: (n?: number, labels?: Record<string, string>) => void };
type Histogram = { observe: (value: number, labels?: Record<string, string>) => void };
type Gauge = { inc: (n?: number) => void; dec: (n?: number) => void };

let promAvailable = false;
let CounterCtor: (new (config: { name: string; help: string; labelNames?: string[] }) => Counter) | undefined;
let HistogramCtor: (new (config: { name: string; help: string; labelNames?: string[] }) => Histogram) | undefined;
let GaugeCtor: (new (config: { name: string; help: string }) => Gauge) | undefined;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const prom = require("prom-client");
  if (prom.Counter && prom.Histogram && prom.Gauge) {
    promAvailable = true;
    CounterCtor = prom.Counter;
    HistogramCtor = prom.Histogram;
    GaugeCtor = prom.Gauge;
  }
} catch {
  // optional dependency not installed
}

export interface PrometheusExporterOptions {
  /** Port for optional HTTP metrics server (not started by default). */
  port?: number;
  /** Metric namespace prefix. Default "curio". */
  namespace?: string;
}

/**
 * Hook consumer that exposes Prometheus metrics.
 * Attach to a HookRegistry via attach(registry); detach via detach(registry).
 */
export class PrometheusExporter {
  private readonly namespace: string;
  private _enabled: boolean;
  private _handlers: Array<{ event: string; handler: (ctx: HookContext) => Promise<void> }> = [];
  private _llmStart: Map<string, number> = new Map();
  private _toolStart: Map<string, number> = new Map();
  private llmDuration?: Histogram;
  private llmInputTokens?: Counter;
  private llmOutputTokens?: Counter;
  private llmErrors?: Counter;
  private toolDuration?: Histogram;
  private toolErrors?: Counter;
  private activeRuns?: Gauge;

  constructor(options: PrometheusExporterOptions = {}) {
    this.namespace = options.namespace ?? "curio";
    this._enabled = promAvailable;
    if (!this._enabled) {
      log.warn(
        "prom-client not installed. PrometheusExporter will be a no-op. Install with: npm install prom-client",
      );
      return;
    }
    if (promAvailable && CounterCtor != null && HistogramCtor != null && GaugeCtor != null) {
      this.llmDuration = new HistogramCtor({
        name: `${this.namespace}_llm_duration_ms`,
        help: "LLM call duration in milliseconds",
        labelNames: ["provider", "model"],
      });
      this.llmInputTokens = new CounterCtor({
        name: `${this.namespace}_llm_tokens_input_total`,
        help: "Total input tokens",
        labelNames: ["provider", "model"],
      });
      this.llmOutputTokens = new CounterCtor({
        name: `${this.namespace}_llm_tokens_output_total`,
        help: "Total output tokens",
        labelNames: ["provider", "model"],
      });
      this.llmErrors = new CounterCtor({
        name: `${this.namespace}_llm_errors_total`,
        help: "Total LLM call errors",
        labelNames: ["provider", "model"],
      });
      this.toolDuration = new HistogramCtor({
        name: `${this.namespace}_tool_duration_ms`,
        help: "Tool call duration in milliseconds",
        labelNames: ["tool_name"],
      });
      this.toolErrors = new CounterCtor({
        name: `${this.namespace}_tool_errors_total`,
        help: "Total tool call errors",
        labelNames: ["tool_name"],
      });
    this.activeRuns = new GaugeCtor({
        name: `${this.namespace}_active_runs`,
        help: "Number of currently active agent runs",
      });
    }
  }

  attach(registry: HookRegistry): void {
    if (!this._enabled) return;
    const onLlmBefore = async (ctx: HookContext) => {
      const key = `llm:${ctx.runId ?? ""}:${ctx.agentId ?? ""}:${Date.now()}`;
      (ctx.data as Record<string, unknown>)._prom_llm_key = key;
      this._llmStart.set(key, performance.now());
    };
    const onLlmAfter = async (ctx: HookContext) => {
      const key = (ctx.data._prom_llm_key as string) ?? "";
      const start = this._llmStart.get(key);
      this._llmStart.delete(key);
      const latencyMs = start != null ? performance.now() - start : 0;
      const response = ctx.data.response as { provider?: string; model?: string; usage?: { promptTokens?: number; completionTokens?: number } } | undefined;
      const provider = response?.provider ?? "unknown";
      const model = response?.model ?? "unknown";
      const usage = response?.usage;
      const inputTokens = usage?.promptTokens ?? 0;
      const outputTokens = usage?.completionTokens ?? 0;
      this.llmDuration?.observe(latencyMs, { provider, model });
      this.llmInputTokens?.inc(inputTokens, { provider, model });
      this.llmOutputTokens?.inc(outputTokens, { provider, model });
    };
    const onLlmError = async (ctx: HookContext) => {
      const key = (ctx.data._prom_llm_key as string) ?? "";
      this._llmStart.delete(key);
      const provider = (ctx.data.provider as string) ?? "unknown";
      const model = (ctx.data.model as string) ?? "unknown";
      this.llmErrors?.inc(1, { provider, model });
    };
    const onToolBefore = async (ctx: HookContext) => {
      const toolName = (ctx.data.tool_name as string) ?? "unknown";
      const key = `tool:${ctx.runId ?? ""}:${toolName}:${Date.now()}`;
      (ctx.data as Record<string, unknown>)._prom_tool_key = key;
      this._toolStart.set(key, performance.now());
    };
    const onToolAfter = async (ctx: HookContext) => {
      const key = (ctx.data._prom_tool_key as string) ?? "";
      const toolName = (ctx.data.tool_name as string) ?? "unknown";
      const start = this._toolStart.get(key);
      this._toolStart.delete(key);
      const latencyMs = start != null ? performance.now() - start : 0;
      this.toolDuration?.observe(latencyMs, { tool_name: toolName });
    };
    const onToolError = async (ctx: HookContext) => {
      const key = (ctx.data._prom_tool_key as string) ?? "";
      this._toolStart.delete(key);
      const toolName = (ctx.data.tool_name as string) ?? "unknown";
      this.toolErrors?.inc(1, { tool_name: toolName });
    };
    const onRunBefore = async () => {
      this.activeRuns?.inc(1);
    };
    const onRunAfter = async () => {
      this.activeRuns?.dec(1);
    };
    const onRunError = async () => {
      this.activeRuns?.dec(1);
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
