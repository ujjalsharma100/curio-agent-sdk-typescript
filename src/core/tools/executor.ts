/**
 * Tool executor — executes tools with timeout, retry, caching, and hooks.
 *
 * Full implementation (parallel execution, permission checking) is in Phase 4.
 * This provides the core executor used by the agent loop.
 */

import type { ToolCall, ToolResult } from "../../models/llm.js";
import { withTimeout, withRetry } from "../../utils/async.js";
import { ToolRegistry } from "./registry.js";
import type { Tool } from "./tool.js";

export class ToolExecutor {
  constructor(private readonly registry: ToolRegistry) {}

  /** Execute a single tool call. */
  async executeTool(call: ToolCall): Promise<ToolResult> {
    const tool = this.registry.get(call.name);
    if (!tool) {
      return {
        toolCallId: call.id,
        toolName: call.name,
        result: "",
        error: `Tool "${call.name}" not found`,
      };
    }

    const start = Date.now();
    try {
      const result = await this.runWithConfig(tool, call.arguments);
      return {
        toolCallId: call.id,
        toolName: call.name,
        result,
        duration: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: call.id,
        toolName: call.name,
        result: "",
        error: message,
        duration: Date.now() - start,
      };
    }
  }

  /** Execute multiple tool calls in parallel. */
  async executeParallel(calls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(calls.map((call) => this.executeTool(call)));
  }

  /** Run a tool with its config (timeout, retry). */
  private async runWithConfig(tool: Tool, args: Record<string, unknown>): Promise<string> {
    const timeout = tool.config.timeout ?? 120_000;
    const maxRetries = tool.config.maxRetries ?? 0;

    const execute = () => withTimeout(tool.execute(args), timeout, `Tool "${tool.name}" timed out`);

    if (maxRetries > 0) {
      return withRetry(execute, {
        maxRetries,
        baseDelayMs: 1000,
        shouldRetry: (err) => {
          // Don't retry timeout errors
          if (err instanceof Error && err.message.includes("timed out")) return false;
          return true;
        },
      });
    }

    return execute();
  }
}
