/**
 * Logging middleware — structured, summary-level logging of LLM and tool operations.
 *
 * Logs: model, message/tool counts, token usage, latency, tool name + args, and a
 * short result preview (200 chars). Does not log full request messages, full
 * response content, or full tool results. For full run dumps (every prompt/response
 * and exact tool args/results) use hook-based logging to a file (e.g. the run-logger
 * in examples/lib/run-logger.ts).
 *
 * Consider using LoggingConsumer (hook-based) for trace-id/span-id correlation
 * when OpenTelemetry is available.
 */

import type { LLMRequest, LLMResponse } from "../models/llm.js";
import type { Middleware } from "./base.js";
import { createLogger } from "../utils/logger.js";

const defaultLog = createLogger("curio.middleware.logging");

export interface LoggingMiddlewareOptions {
  /** Log level: "debug" | "info" | "warn" | "error". Default "info". */
  level?: "debug" | "info" | "warn" | "error";
  /** Logger name for pino child. Default "curio.middleware.logging". */
  loggerName?: string;
}

/**
 * Logs all LLM calls and tool calls with structured information.
 */
export class LoggingMiddleware implements Middleware {
  readonly name = "LoggingMiddleware";
  private readonly level: "debug" | "info" | "warn" | "error";
  private readonly log: ReturnType<typeof createLogger>;
  private callStart = 0;

  constructor(options: LoggingMiddlewareOptions = {}) {
    this.level = options.level ?? "info";
    this.log = options.loggerName
      ? createLogger(options.loggerName)
      : defaultLog;
  }

  async beforeLLMCall(request: LLMRequest): Promise<LLMRequest> {
    this.callStart = performance.now();
    this.log[this.level](
      {
        model: request.model ?? "auto",
        messages: request.messages?.length ?? 0,
        tools: request.tools?.length ?? 0,
      },
      "LLM call started",
    );
    return request;
  }

  async afterLLMCall(_request: LLMRequest, response: LLMResponse): Promise<LLMResponse> {
    const elapsed = (performance.now() - this.callStart).toFixed(0);
    this.log[this.level](
      {
        model: response.model,
        finishReason: response.finishReason,
        inputTokens: response.usage.promptTokens,
        outputTokens: response.usage.completionTokens,
        latencyMs: Number(elapsed),
      },
      "LLM call completed",
    );
    return response;
  }

  async beforeToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    this.log[this.level]({ tool: toolName, args }, "Tool call started");
  }

  async afterToolCall(
    toolName: string,
    _args: Record<string, unknown>,
    result: string,
  ): Promise<void> {
    const preview = result.length > 200 ? `${result.slice(0, 200)}...` : result;
    this.log[this.level]({ tool: toolName, resultPreview: preview }, "Tool call completed");
  }

  async onError(error: Error, context: Record<string, unknown>): Promise<Error> {
    this.log.error({ err: error, phase: context.phase }, "Error in pipeline");
    return error;
  }
}
