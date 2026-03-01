/**
 * Middleware base and pipeline for intercepting LLM and tool calls.
 *
 * Middleware provides a composable way to add cross-cutting concerns like
 * logging, cost tracking, rate limiting, and retry logic.
 *
 * When hookRegistry is provided, the pipeline emits llm.call.before / llm.call.after /
 * llm.call.error at the same lifecycle points for observability.
 */

import type { LLMRequest, LLMResponse, LLMStreamChunk } from "../models/llm.js";
import { HookContext, HookEvent } from "../models/events.js";
import type { HookRegistry } from "../core/events/hooks.js";
import { emptyTokenUsage } from "../models/llm.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("middleware");

// ---------------------------------------------------------------------------
// Middleware interface
// ---------------------------------------------------------------------------

/**
 * Middleware intercepts LLM calls and tool calls. All hooks are optional;
 * return undefined (or the same value) to pass through unchanged.
 */
export interface Middleware {
  readonly name: string;

  /** Called before each LLM call. Can modify the request. */
  beforeLLMCall?(request: LLMRequest): Promise<LLMRequest | void>;

  /** Called after each LLM call. Can modify the response. */
  afterLLMCall?(request: LLMRequest, response: LLMResponse): Promise<LLMResponse | void>;

  /** Called for each chunk in a streaming LLM call. Return the chunk, or undefined to drop it. */
  onLLMStreamChunk?(
    request: LLMRequest,
    chunk: LLMStreamChunk,
  ): Promise<LLMStreamChunk | undefined | void>;

  /** Called before each tool call. Can modify tool name and args. */
  beforeToolCall?(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ toolName: string; args: Record<string, unknown> } | void>;

  /** Called after each tool call. Can modify the result. */
  afterToolCall?(
    toolName: string,
    args: Record<string, unknown>,
    result: string,
  ): Promise<string | void>;

  /** Called on errors. Return the error to propagate, or null to suppress. */
  onError?(error: Error, context: Record<string, unknown>): Promise<Error | null | void>;
}

// ---------------------------------------------------------------------------
// MiddlewarePipeline
// ---------------------------------------------------------------------------

export interface MiddlewarePipelineOptions {
  /** Optional hook registry; when set, pipeline emits llm.call.before/after/error. */
  hookRegistry?: HookRegistry;
}

/**
 * Runs a list of middleware in order for LLM and tool call hooks.
 * Use wrapLLMClient() to wrap an ILLMClient so the loop uses the pipeline transparently.
 */
export class MiddlewarePipeline {
  private readonly middleware: Middleware[] = [];
  private readonly hookRegistry?: HookRegistry;

  constructor(
    middleware: Middleware[] = [],
    options: MiddlewarePipelineOptions = {},
  ) {
    this.middleware.push(...middleware);
    this.hookRegistry = options.hookRegistry;
  }

  /** Add a middleware to the pipeline. */
  add(mw: Middleware): void {
    this.middleware.push(mw);
  }

  /** Run all beforeLLMCall hooks in order; emit llm.call.before if hookRegistry set. */
  async runBeforeLLMCall(
    request: LLMRequest,
    runId?: string,
    agentId?: string,
  ): Promise<LLMRequest> {
    if (this.hookRegistry) {
      const ctx = new HookContext({
        event: HookEvent.LLM_CALL_BEFORE,
        data: { request },
        runId: runId ?? "",
        agentId: agentId ?? "",
      });
      await this.hookRegistry.emit(HookEvent.LLM_CALL_BEFORE, ctx);
      if (ctx.cancelled) {
        throw new Error("LLM call cancelled by hook");
      }
      const modified = ctx.data["request"];
      if (modified != null && typeof modified === "object") {
        request = modified as LLMRequest;
      }
    }
    for (const mw of this.middleware) {
      if (!mw.beforeLLMCall) continue;
      try {
        const out = await mw.beforeLLMCall(request);
        if (out !== undefined) request = out;
      } catch (e) {
        log.error({ err: e, middleware: mw.name }, "Middleware beforeLLMCall failed");
        throw e;
      }
    }
    return request;
  }

  /** Run all afterLLMCall hooks in order; emit llm.call.after if hookRegistry set. */
  async runAfterLLMCall(
    request: LLMRequest,
    response: LLMResponse,
    runId?: string,
    agentId?: string,
  ): Promise<LLMResponse> {
    for (const mw of this.middleware) {
      if (!mw.afterLLMCall) continue;
      try {
        const out = await mw.afterLLMCall(request, response);
        if (out !== undefined) response = out;
      } catch (e) {
        log.error({ err: e, middleware: mw.name }, "Middleware afterLLMCall failed");
        throw e;
      }
    }
    if (this.hookRegistry) {
      const ctx = new HookContext({
        event: HookEvent.LLM_CALL_AFTER,
        data: { request, response },
        runId: runId ?? "",
        agentId: agentId ?? "",
      });
      await this.hookRegistry.emit(HookEvent.LLM_CALL_AFTER, ctx);
      const modified = ctx.data["response"];
      if (modified != null && typeof modified === "object") {
        response = modified as LLMResponse;
      }
    }
    return response;
  }

  /** Run per-chunk stream hooks. Middleware can modify or drop chunks (return undefined to drop). */
  async runOnLLMStreamChunk(
    request: LLMRequest,
    chunk: LLMStreamChunk,
    _runId?: string,
    _agentId?: string,
  ): Promise<LLMStreamChunk | undefined> {
    for (const mw of this.middleware) {
      if (!mw.onLLMStreamChunk) continue;
      try {
        const out = await mw.onLLMStreamChunk(request, chunk);
        if (out === undefined) return undefined;
        chunk = out;
      } catch (e) {
        log.error({ err: e, middleware: mw.name }, "Middleware onLLMStreamChunk failed");
        throw e;
      }
    }
    return chunk;
  }

  /** Run all beforeToolCall hooks in order. */
  async runBeforeToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ toolName: string; args: Record<string, unknown> }> {
    for (const mw of this.middleware) {
      if (!mw.beforeToolCall) continue;
      try {
        const out = await mw.beforeToolCall(toolName, args);
        if (out !== undefined) {
          toolName = out.toolName;
          args = out.args;
        }
      } catch (e) {
        log.error({ err: e, middleware: mw.name }, "Middleware beforeToolCall failed");
        throw e;
      }
    }
    return { toolName, args };
  }

  /** Run all afterToolCall hooks in order. */
  async runAfterToolCall(
    toolName: string,
    args: Record<string, unknown>,
    result: string,
  ): Promise<string> {
    for (const mw of this.middleware) {
      if (!mw.afterToolCall) continue;
      try {
        const out = await mw.afterToolCall(toolName, args, result);
        if (out !== undefined) result = out;
      } catch (e) {
        log.error({ err: e, middleware: mw.name }, "Middleware afterToolCall failed");
        throw e;
      }
    }
    return result;
  }

  /** Run all onError hooks; emit llm.call.error if hookRegistry set. If any returns null, error is suppressed. */
  async runOnError(
    error: Error,
    context: Record<string, unknown>,
    runId?: string,
    agentId?: string,
  ): Promise<Error | null> {
    if (this.hookRegistry) {
      const ctx = new HookContext({
        event: HookEvent.LLM_CALL_ERROR,
        data: { ...context, error: String(error), exception: error },
        runId: runId ?? "",
        agentId: agentId ?? "",
      });
      await this.hookRegistry.emit(HookEvent.LLM_CALL_ERROR, ctx);
    }
    for (const mw of this.middleware) {
      if (!mw.onError) continue;
      try {
        const out = await mw.onError(error, context);
        if (out === null) return null;
        if (out !== undefined) error = out;
      } catch (e) {
        log.error({ err: e, middleware: mw.name }, "Middleware onError failed");
      }
    }
    return error;
  }

  /**
   * Wrap an LLM client with this pipeline. The returned client runs
   * before/after middleware and hooks on each call and stream.
   */
  wrapLLMClient<T extends { call(req: LLMRequest): Promise<LLMResponse>; stream(req: LLMRequest): AsyncIterableIterator<LLMStreamChunk> }>(
    inner: T,
  ): T {
    const pipeline = this;
    return {
      ...inner,
      async call(request: LLMRequest): Promise<LLMResponse> {
        const runId = request.metadata?.runId as string | undefined;
        const agentId = request.metadata?.agentId as string | undefined;
        request = await pipeline.runBeforeLLMCall(request, runId, agentId);
        try {
          let response = await inner.call(request);
          response = await pipeline.runAfterLLMCall(request, response, runId, agentId);
          return response;
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          const result = await pipeline.runOnError(
            err,
            { phase: "llm_call", request },
            runId,
            agentId,
          );
          if (result === null) {
            return {
              content: "",
              toolCalls: [],
              usage: emptyTokenUsage(),
              model: request.model ?? "",
              finishReason: "error",
              metadata: { error: String(err) },
            } as LLMResponse;
          }
          throw result;
        }
      },
      async *stream(request: LLMRequest): AsyncIterableIterator<LLMStreamChunk> {
        const runId = request.metadata?.runId as string | undefined;
        const agentId = request.metadata?.agentId as string | undefined;
        request = await pipeline.runBeforeLLMCall(request, runId, agentId);
        let textParts: string[] = [];
        let toolCalls: LLMResponse["toolCalls"] = [];
        let totalUsage = emptyTokenUsage();
        let finishReason: string | undefined;
        try {
          for await (const chunk of inner.stream(request)) {
            const processed = await pipeline.runOnLLMStreamChunk(
              request,
              chunk,
              runId,
              agentId,
            );
            if (processed === undefined) continue;
            if (processed.type === "text_delta" && processed.text) {
              textParts.push(processed.text);
            }
            if (processed.type === "usage" && processed.usage) {
              const u = processed.usage;
              totalUsage.promptTokens += u.promptTokens ?? 0;
              totalUsage.completionTokens += u.completionTokens ?? 0;
              totalUsage.totalTokens += u.totalTokens ?? 0;
            }
            if (processed.type === "done" && processed.finishReason) {
              finishReason = processed.finishReason;
            }
            yield processed;
          }
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          const result = await pipeline.runOnError(
            err,
            { phase: "llm_stream", request },
            runId,
            agentId,
          );
          if (result === null) return;
          throw result;
        }
        const syntheticResponse: LLMResponse = {
          content: textParts.join(""),
          toolCalls,
          usage: totalUsage,
          model: request.model ?? "",
          finishReason: (finishReason as LLMResponse["finishReason"]) ?? "stop",
        };
        await pipeline.runAfterLLMCall(request, syntheticResponse, runId, agentId);
      },
    } as T;
  }
}
