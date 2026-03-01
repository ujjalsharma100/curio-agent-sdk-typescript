/**
 * Tool executor — executes tools with timeout, retry, caching, hooks, and optional permission checks.
 */

import type { ToolCall, ToolResult } from "../../models/llm.js";
import { withTimeout, withRetry } from "../../utils/async.js";
import { sha256 } from "../../utils/hash.js";
import { HookContext, HookEvent } from "../../models/events.js";
import type { HookRegistry } from "../events/hooks.js";
import { ToolRegistry } from "./registry.js";
import type { Tool } from "./tool.js";

// ---------------------------------------------------------------------------
// Permission policy (Phase 11 will provide concrete implementations)
// ---------------------------------------------------------------------------

/** Context passed to permission check. */
export interface ToolPermissionContext {
  runId?: string;
  agentId?: string;
  toolCallId: string;
  toolConfig?: Record<string, unknown>;
}

/** Result of a permission check. */
export interface ToolPermissionResult {
  allowed: boolean;
  reason?: string;
  /** If true, executor may prompt for user confirmation when humanInput is available. */
  askUser?: boolean;
}

/** Policy for allowing or denying tool calls. Phase 11 implements full security. */
export interface PermissionPolicy {
  checkToolCall(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolPermissionContext,
  ): Promise<ToolPermissionResult>;
}

// ---------------------------------------------------------------------------
// Run context (for hooks)
// ---------------------------------------------------------------------------

/** Optional context passed per executeTool call for hooks and permission. */
export interface ToolExecutorContext {
  runId?: string;
  agentId?: string;
}

// ---------------------------------------------------------------------------
// Cache / idempotency
// ---------------------------------------------------------------------------

interface CacheEntry {
  result: string;
  expiresAt: number;
}

interface IdempotencyRecord {
  result: string;
  error?: string;
}

/** Deterministic stringify for cache keys. */
function deterministicStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(deterministicStringify).join(",") + "]";
  const keys = Object.keys(obj as object).sort();
  const rec = obj as Record<string, unknown>;
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + deterministicStringify(rec[k])).join(",") + "}";
}

function cacheKey(toolName: string, args: Record<string, unknown>): string {
  return sha256(`${toolName}:${deterministicStringify(args)}`);
}

// ---------------------------------------------------------------------------
// ToolExecutor options
// ---------------------------------------------------------------------------

export interface ToolExecutorOptions {
  /** Optional hook registry for tool.call.before/after/error. */
  hookRegistry?: HookRegistry;
  /** Optional permission policy; when set, check before executing. */
  permissionPolicy?: PermissionPolicy;
}

// ---------------------------------------------------------------------------
// ToolExecutor
// ---------------------------------------------------------------------------

export class ToolExecutor {
  private readonly _cache = new Map<string, CacheEntry>();
  private readonly _idempotencyStore = new Map<string, IdempotencyRecord>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly options: ToolExecutorOptions = {},
  ) {}

  /**
   * Execute a single tool call.
   * When options.hookRegistry is set, emits tool.call.before/after/error.
   * When options.permissionPolicy is set, checks permission before executing.
   */
  async executeTool(call: ToolCall, context?: ToolExecutorContext): Promise<ToolResult> {
    const { hookRegistry, permissionPolicy } = this.options;
    const toolName = call.name;
    let args = { ...call.arguments };
    const runId = context?.runId ?? "";
    const agentId = context?.agentId ?? "";

    const tool = this.registry.get(toolName);
    if (!tool) {
      const errResult: ToolResult = {
        toolCallId: call.id,
        toolName: toolName,
        result: "",
        error: `Tool "${toolName}" not found`,
      };
      if (hookRegistry) {
        await hookRegistry.emit(
          HookEvent.TOOL_CALL_ERROR,
          new HookContext({
            event: HookEvent.TOOL_CALL_ERROR,
            data: { tool: toolName, toolName, args, error: errResult.error, toolCallId: call.id },
            runId,
            agentId,
          }),
        );
      }
      return errResult;
    }

    // tool.call.before
    if (hookRegistry) {
      const beforeCtx = new HookContext({
        event: HookEvent.TOOL_CALL_BEFORE,
        data: { tool: toolName, tool_name: toolName, args, toolCallId: call.id },
        runId,
        agentId,
      });
      await hookRegistry.emit(HookEvent.TOOL_CALL_BEFORE, beforeCtx);
      if (beforeCtx.cancelled) {
        return {
          toolCallId: call.id,
          toolName: toolName,
          result: "",
          error: "Tool call cancelled by hook",
        };
      }
      args = (beforeCtx.data["args"] as Record<string, unknown>) ?? args;
    }

    // Permission check
    if (permissionPolicy) {
      const permResult = await permissionPolicy.checkToolCall(toolName, args, {
        runId,
        agentId,
        toolCallId: call.id,
        toolConfig: tool.config as Record<string, unknown>,
      });
      if (!permResult.allowed) {
        const errResult: ToolResult = {
          toolCallId: call.id,
          toolName: toolName,
          result: "",
          error: `Permission denied: ${permResult.reason ?? "not allowed"}`,
        };
        if (hookRegistry) {
          await hookRegistry.emit(
            HookEvent.TOOL_CALL_ERROR,
            new HookContext({
              event: HookEvent.TOOL_CALL_ERROR,
              data: { toolName, args, error: errResult.error },
              runId,
              agentId,
            }),
          );
        }
        return errResult;
      }
    }

    const start = Date.now();

    // Cache lookup (TTL)
    const cacheTtl = tool.config.cacheTtl ?? 0;
    if (cacheTtl > 0) {
      const key = cacheKey(toolName, args);
      const entry = this._cache.get(key);
      if (entry && Date.now() < entry.expiresAt) {
        const cachedResult: ToolResult = {
          toolCallId: call.id,
          toolName: toolName,
          result: entry.result,
          duration: 0,
        };
        if (hookRegistry) {
          await hookRegistry.emit(
            HookEvent.TOOL_CALL_AFTER,
            new HookContext({
              event: HookEvent.TOOL_CALL_AFTER,
              data: { toolName, args, result: entry.result },
              runId,
              agentId,
            }),
          );
        }
        return cachedResult;
      }
    }

    // Idempotency replay
    if (tool.config.idempotent) {
      const key = cacheKey(toolName, args);
      const prev = this._idempotencyStore.get(key);
      if (prev) {
        const replayResult: ToolResult = {
          toolCallId: call.id,
          toolName: toolName,
          result: prev.result,
          error: prev.error,
          duration: 0,
        };
        if (hookRegistry) {
          await hookRegistry.emit(
            HookEvent.TOOL_CALL_AFTER,
            new HookContext({
              event: HookEvent.TOOL_CALL_AFTER,
              data: { toolName, args, result: prev.result },
              runId,
              agentId,
            }),
          );
        }
        return replayResult;
      }
    }

    try {
      const result = await this.runWithConfig(tool, args);

      // Cache store
      if (cacheTtl > 0) {
        const key = cacheKey(toolName, args);
        this._cache.set(key, { result, expiresAt: Date.now() + cacheTtl });
      }

      // Idempotency store
      if (tool.config.idempotent) {
        const key = cacheKey(toolName, args);
        this._idempotencyStore.set(key, { result });
      }

      const toolResult: ToolResult = {
        toolCallId: call.id,
        toolName: toolName,
        result,
        duration: Date.now() - start,
      };

      if (hookRegistry) {
        const afterCtx = new HookContext({
          event: HookEvent.TOOL_CALL_AFTER,
          data: { toolName, args, result, duration: toolResult.duration, toolCallId: call.id },
          runId,
          agentId,
        });
        await hookRegistry.emit(HookEvent.TOOL_CALL_AFTER, afterCtx);
        const modifiedResult = afterCtx.data["result"];
        if (modifiedResult !== undefined && typeof modifiedResult === "string") {
          toolResult.result = modifiedResult;
        }
      }

      return toolResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (tool.config.idempotent) {
        const key = cacheKey(toolName, args);
        this._idempotencyStore.set(key, { result: "", error: message });
      }
      const errResult: ToolResult = {
        toolCallId: call.id,
        toolName: toolName,
        result: "",
        error: message,
        duration: Date.now() - start,
      };
      if (hookRegistry) {
        await hookRegistry.emit(
          HookEvent.TOOL_CALL_ERROR,
          new HookContext({
            event: HookEvent.TOOL_CALL_ERROR,
            data: { toolName, args, error: message },
            runId,
            agentId,
          }),
        );
      }
      return errResult;
    }
  }

  /** Execute multiple tool calls in parallel. */
  async executeParallel(calls: ToolCall[], context?: ToolExecutorContext): Promise<ToolResult[]> {
    return Promise.all(calls.map((call) => this.executeTool(call, context)));
  }

  /** Run a tool with its config (timeout, retry). */
  private async runWithConfig(tool: Tool, args: Record<string, unknown>): Promise<string> {
    const timeout = tool.config.timeout ?? 120_000;
    const maxRetries = tool.config.maxRetries ?? 0;

    const execute = () =>
      withTimeout(tool.execute(args), timeout, `Tool "${tool.name}" timed out`);

    if (maxRetries > 0) {
      return withRetry(execute, {
        maxRetries,
        baseDelayMs: 1000,
        shouldRetry: (err) => {
          if (err instanceof Error && err.message.includes("timed out")) return false;
          return true;
        },
      });
    }

    return execute();
  }
}
