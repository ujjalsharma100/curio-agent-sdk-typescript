/**
 * Run logger — optional granular logging of full agent run execution.
 *
 * Use for debugging and audit: captures run start/end, every LLM request
 * (messages, model, tools), every LLM response (content, tool calls, usage),
 * and every tool call (name, exact args, result). Opt-in only; no effect when
 * not attached.
 *
 * Production use: enable only when needed (e.g. debug flag, support sessions).
 * Prefer `sink` to send to your logging pipeline instead of (or in addition to)
 * a file. Avoid logging sensitive data in production unless required.
 *
 * @example
 * ```ts
 * const builder = Agent.builder();
 * const runLogger = useRunLogger(builder, { baseName: "agent-run" });
 * const agent = builder.model("openai:gpt-4o-mini").llmClient(client).build();
 * await agent.run("Hello");
 * console.log("Log file:", runLogger.getLogPath());
 * ```
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { HookContext } from "../models/events.js";
import { HookEvent } from "../models/events.js";

const SEP = "\n" + "=".repeat(80) + "\n";

function safeStringify(obj: unknown): string {
  try {
    if (obj === undefined) return "<undefined>";
    if (typeof obj === "string") return obj;
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

export interface RunLoggerOptions {
  /** Directory for the log file. Ignored if only `sink` is used. Default: process.cwd() */
  outputDir?: string;
  /** Base name for the file (timestamp appended). Default: "agent-run" */
  baseName?: string;
  /**
   * Optional sink for every log chunk (e.g. stream, or forward to your logger).
   * When set, each section is passed here; use with or without file output.
   */
  sink?: (chunk: string) => void | Promise<void>;
}

export interface RunLogger {
  /** Log file path once the run has started; null if only `sink` is used or not yet written. */
  getLogPath(): string | null;
  onRunBefore(ctx: HookContext): void;
  onRunAfter(ctx: HookContext): void;
  onRunError(ctx: HookContext): void;
  onLlmBefore(ctx: HookContext): void;
  onLlmAfter(ctx: HookContext): void;
  onLlmError(ctx: HookContext): void;
  onToolBefore(ctx: HookContext): void;
  onToolAfter(ctx: HookContext): void;
  onToolError(ctx: HookContext): void;
}

/** Create a run logger that writes to a timestamped file and/or a custom sink. */
export function createRunLogger(options: RunLoggerOptions = {}): RunLogger {
  const outputDir = options.outputDir ?? process.cwd();
  const baseName = options.baseName ?? "agent-run";
  const sink = options.sink;
  /** When sink-only (no file), we never set logPath. */
  const useFile = options.outputDir !== undefined || options.baseName !== undefined || !sink;
  let logPath: string | null = null;

  function ensurePath(): string | null {
    if (logPath) return logPath;
    if (!useFile) return null;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    logPath = path.join(outputDir, `${baseName}-${ts}.log`);
    return logPath;
  }

  function writeSync(text: string): void {
    const p = ensurePath();
    if (p) fs.appendFileSync(p, text, "utf8");
    if (sink) {
      try {
        sink(text);
      } catch {
        // sink may throw; avoid breaking the hook chain
      }
    }
  }

  return {
    getLogPath() {
      return logPath;
    },

    onRunBefore(ctx: HookContext) {
      ensurePath();
      const input = ctx.data.input ?? ctx.data.prompt ?? "";
      writeSync(
        `[AGENT RUN START] ${new Date().toISOString()}\n` +
          `runId: ${ctx.runId ?? "—"}\nagentId: ${ctx.agentId ?? "—"}\n` +
          `input: ${typeof input === "string" ? input : safeStringify(input)}\n${SEP}`,
      );
    },

    onRunAfter(ctx: HookContext) {
      if (!logPath && !sink) return;
      const result = ctx.data.result as { output?: string; toolCalls?: unknown[] } | undefined;
      writeSync(
        `[AGENT RUN END] ${new Date().toISOString()}\n` +
          `output: ${result?.output ?? "—"}\n` +
          `toolCalls count: ${Array.isArray(result?.toolCalls) ? result.toolCalls.length : 0}\n${SEP}`,
      );
    },

    onRunError(ctx: HookContext) {
      if (!logPath && !sink) return;
      const err = ctx.data.error ?? ctx.data.exception;
      writeSync(
        `[AGENT RUN ERROR] ${new Date().toISOString()}\n` +
          `error: ${err instanceof Error ? err.message : safeStringify(err)}\n${SEP}`,
      );
    },

    onLlmBefore(ctx: HookContext) {
      ensurePath();
      const request = ctx.data.request as {
        model?: string;
        messages?: unknown[];
        tools?: unknown[];
        temperature?: number;
        maxTokens?: number;
      } | undefined;
      if (!request) return;
      writeSync(
        `[LLM REQUEST] ${new Date().toISOString()} iteration: ${ctx.iteration ?? "—"}\n` +
          `model: ${request.model ?? "—"}\n` +
          `temperature: ${request.temperature ?? "—"} maxTokens: ${request.maxTokens ?? "—"}\n` +
          `messages (${Array.isArray(request.messages) ? request.messages.length : 0}):\n${safeStringify(request.messages)}\n` +
          `tools (${Array.isArray(request.tools) ? request.tools.length : 0}):\n${safeStringify(request.tools)}\n${SEP}`,
      );
    },

    onLlmAfter(ctx: HookContext) {
      if (!logPath && !sink) return;
      const request = ctx.data.request as { model?: string } | undefined;
      const response = ctx.data.response as {
        content?: string;
        toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
        usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
      } | undefined;
      const duration = ctx.data.duration as number | undefined;
      writeSync(
        `[LLM RESPONSE] ${new Date().toISOString()}\n` +
          `model: ${request?.model ?? "—"} durationMs: ${duration ?? "—"}\n` +
          `content: ${response?.content ?? "—"}\n` +
          `toolCalls: ${Array.isArray(response?.toolCalls) ? response.toolCalls.length : 0}\n` +
          (Array.isArray(response?.toolCalls) && response.toolCalls.length > 0
            ? response.toolCalls
                .map(
                  (tc) =>
                    `  - ${tc.name} id=${tc.id} args=${safeStringify(tc.arguments)}`,
                )
                .join("\n") + "\n"
            : "") +
          `usage: ${safeStringify(response?.usage ?? {})}\n${SEP}`,
      );
    },

    onLlmError(ctx: HookContext) {
      if (!logPath && !sink) return;
      const err = ctx.data.error;
      writeSync(
        `[LLM ERROR] ${new Date().toISOString()}\n` +
          `error: ${err instanceof Error ? err.message : safeStringify(err)}\n${SEP}`,
      );
    },

    onToolBefore(ctx: HookContext) {
      ensurePath();
      const toolName = (ctx.data.tool_name ?? ctx.data.tool) as string;
      const args = ctx.data.args as Record<string, unknown>;
      const toolCallId = ctx.data.toolCallId as string;
      writeSync(
        `[TOOL CALL START] ${new Date().toISOString()}\n` +
          `tool: ${toolName ?? "—"} toolCallId: ${toolCallId ?? "—"}\n` +
          `arguments: ${safeStringify(args ?? {})}\n${SEP}`,
      );
    },

    onToolAfter(ctx: HookContext) {
      if (!logPath && !sink) return;
      const toolName = ctx.data.toolName as string;
      const args = ctx.data.args as Record<string, unknown>;
      const result = ctx.data.result as string | undefined;
      const duration = ctx.data.duration as number | undefined;
      const toolCallId = ctx.data.toolCallId as string;
      writeSync(
        `[TOOL CALL END] ${new Date().toISOString()}\n` +
          `tool: ${toolName ?? "—"} toolCallId: ${toolCallId ?? "—"} durationMs: ${duration ?? "—"}\n` +
          `arguments: ${safeStringify(args ?? {})}\n` +
          `result: ${typeof result === "string" ? result : safeStringify(result)}\n${SEP}`,
      );
    },

    onToolError(ctx: HookContext) {
      if (!logPath && !sink) return;
      const toolName = (ctx.data.toolName ?? ctx.data.tool) as string;
      const args = ctx.data.args as Record<string, unknown>;
      const error = ctx.data.error as string | Error | undefined;
      writeSync(
        `[TOOL CALL ERROR] ${new Date().toISOString()}\n` +
          `tool: ${toolName ?? "—"}\n` +
          `arguments: ${safeStringify(args ?? {})}\n` +
          `error: ${error instanceof Error ? error.message : safeStringify(error)}\n${SEP}`,
      );
    },
  };
}

/**
 * Register all run-logger hooks on the builder. Returns the logger so you can
 * call getLogPath() after the run or use a custom sink.
 */
export function useRunLogger<
  T extends { hook(event: string, handler: (ctx: HookContext) => void | Promise<void>): T },
>(builder: T, options?: RunLoggerOptions): RunLogger {
  const logger = createRunLogger(options);
  builder
    .hook(HookEvent.AGENT_RUN_BEFORE, (ctx) => logger.onRunBefore(ctx))
    .hook(HookEvent.AGENT_RUN_AFTER, (ctx) => logger.onRunAfter(ctx))
    .hook(HookEvent.AGENT_RUN_ERROR, (ctx) => logger.onRunError(ctx))
    .hook(HookEvent.LLM_CALL_BEFORE, (ctx) => logger.onLlmBefore(ctx))
    .hook(HookEvent.LLM_CALL_AFTER, (ctx) => logger.onLlmAfter(ctx))
    .hook(HookEvent.LLM_CALL_ERROR, (ctx) => logger.onLlmError(ctx))
    .hook(HookEvent.TOOL_CALL_BEFORE, (ctx) => logger.onToolBefore(ctx))
    .hook(HookEvent.TOOL_CALL_AFTER, (ctx) => logger.onToolAfter(ctx))
    .hook(HookEvent.TOOL_CALL_ERROR, (ctx) => logger.onToolError(ctx));
  return logger;
}
