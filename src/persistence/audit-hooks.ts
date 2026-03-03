import { HookContext, HookEvent, EventType, createAgentEvent } from "../models/events.js";
import type { HookRegistry } from "../core/events/hooks.js";
import type { AgentRunStatus, LLMUsageRecord, Persistence } from "./base.js";

/**
 * Wire audit logging into the hook registry.
 *
 * This attaches handlers for agent run, LLM, and tool lifecycle hooks and
 * forwards them to a Persistence implementation for durable storage.
 */
export function registerAuditHooks(
  registry: HookRegistry,
  persistence: Persistence,
): void {
  const onRunBefore = async (ctx: HookContext) => {
    const runId = ctx.runId ?? "";
    const agentId = ctx.agentId ?? "unknown";
    const startedAt = new Date();
    const agentName = (ctx.data.agent_name as string | undefined) ?? undefined;
    const input =
      (ctx.data.input as string | undefined) ??
      (ctx.data.prompt as string | undefined) ??
      undefined;

    await persistence.createAgentRun({
      runId,
      agentId,
      agentName,
      input,
      status: "running",
      startedAt,
      completedAt: null,
      durationMs: null,
      model: (ctx.data.model as string | undefined) ?? null,
      usage: null,
      metrics: null,
      errorMessage: null,
      metadata: (ctx.data.metadata as Record<string, unknown> | undefined) ?? null,
    });

    const event = createAgentEvent(
      EventType.RUN_STARTED,
      { ...ctx.data },
      { runId, agentId, iteration: ctx.iteration ?? 0 },
    );
    await persistence.logEvent(event);
  };

  const finalizeRun = async (
    ctx: HookContext,
    status: AgentRunStatus,
    extraData: Record<string, unknown> = {},
  ) => {
    const runId = ctx.runId ?? "";
    const agentId = ctx.agentId ?? "unknown";
    const completedAt = new Date();

    // Attach status and optional error to metadata.
    const error =
      (ctx.data.exception as Error | undefined)?.message ??
      (ctx.data.error as string | undefined);

    await persistence.updateAgentRun(runId, {
      status,
      completedAt,
      durationMs:
        typeof ctx.data.duration_ms === "number"
          ? (ctx.data.duration_ms as number)
          : undefined,
      errorMessage: error ?? null,
    });

    const eventType =
      status === "error" ? EventType.RUN_ERROR : EventType.RUN_COMPLETED;
    const event = createAgentEvent(
      eventType,
      { ...ctx.data, ...extraData, status },
      { runId, agentId, iteration: ctx.iteration ?? 0 },
    );
    await persistence.logEvent(event);
  };

  const onRunAfter = async (ctx: HookContext) => {
    await finalizeRun(ctx, "completed");
  };

  const onRunError = async (ctx: HookContext) => {
    await finalizeRun(ctx, "error");
  };

  const onLlmBefore = async (ctx: HookContext) => {
    const runId = ctx.runId ?? "";
    const agentId = ctx.agentId ?? "unknown";
    const event = createAgentEvent(
      EventType.LLM_CALL_STARTED,
      { ...ctx.data },
      { runId, agentId, iteration: ctx.iteration ?? 0 },
    );
    await persistence.logEvent(event);
  };

  const onLlmAfter = async (ctx: HookContext) => {
    const runId = ctx.runId ?? "";
    const agentId = ctx.agentId ?? "unknown";
    const response = ctx.data.response as {
      provider?: string;
      model?: string;
      usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    } | null;

    const event = createAgentEvent(
      EventType.LLM_CALL_COMPLETED,
      { ...ctx.data },
      { runId, agentId, iteration: ctx.iteration ?? 0 },
    );
    await persistence.logEvent(event);

    if (response) {
      const now = new Date();
      const usage = response.usage ?? {};
      const record: LLMUsageRecord = {
        runId,
        agentId,
        provider: response.provider ?? null,
        model: response.model ?? "",
        inputTokens: usage.promptTokens ?? 0,
        outputTokens: usage.completionTokens ?? 0,
        totalTokens:
          usage.totalTokens ??
          (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0),
        latencyMs:
          typeof ctx.data.latency_ms === "number"
            ? (ctx.data.latency_ms as number)
            : null,
        costUsd: undefined,
        timestamp: now,
      };
      await persistence.logLLMUsage(record);
    }
  };

  const onLlmError = async (ctx: HookContext) => {
    const runId = ctx.runId ?? "";
    const agentId = ctx.agentId ?? "unknown";
    const event = createAgentEvent(
      EventType.LLM_CALL_ERROR,
      { ...ctx.data },
      { runId, agentId, iteration: ctx.iteration ?? 0 },
    );
    await persistence.logEvent(event);
  };

  const onToolBefore = async (ctx: HookContext) => {
    const runId = ctx.runId ?? "";
    const agentId = ctx.agentId ?? "unknown";
    const event = createAgentEvent(
      EventType.TOOL_CALL_STARTED,
      { ...ctx.data },
      { runId, agentId, iteration: ctx.iteration ?? 0 },
    );
    await persistence.logEvent(event);
  };

  const onToolAfter = async (ctx: HookContext) => {
    const runId = ctx.runId ?? "";
    const agentId = ctx.agentId ?? "unknown";
    const event = createAgentEvent(
      EventType.TOOL_CALL_COMPLETED,
      { ...ctx.data },
      { runId, agentId, iteration: ctx.iteration ?? 0 },
    );
    await persistence.logEvent(event);
  };

  const onToolError = async (ctx: HookContext) => {
    const runId = ctx.runId ?? "";
    const agentId = ctx.agentId ?? "unknown";
    const event = createAgentEvent(
      EventType.TOOL_CALL_ERROR,
      { ...ctx.data },
      { runId, agentId, iteration: ctx.iteration ?? 0 },
    );
    await persistence.logEvent(event);
  };

  registry.on(HookEvent.AGENT_RUN_BEFORE, onRunBefore);
  registry.on(HookEvent.AGENT_RUN_AFTER, onRunAfter);
  registry.on(HookEvent.AGENT_RUN_ERROR, onRunError);

  registry.on(HookEvent.LLM_CALL_BEFORE, onLlmBefore);
  registry.on(HookEvent.LLM_CALL_AFTER, onLlmAfter);
  registry.on(HookEvent.LLM_CALL_ERROR, onLlmError);

  registry.on(HookEvent.TOOL_CALL_BEFORE, onToolBefore);
  registry.on(HookEvent.TOOL_CALL_AFTER, onToolAfter);
  registry.on(HookEvent.TOOL_CALL_ERROR, onToolError);
}

