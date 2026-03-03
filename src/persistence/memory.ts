import type { AgentEvent } from "../models/events.js";
import type { AgentStats, AgentRun, LLMUsageRecord, Persistence } from "./base.js";

/**
 * Simple in-memory Persistence implementation.
 *
 * Intended for development and tests only — data is lost on process exit.
 */
export class InMemoryPersistence implements Persistence {
  private readonly runs = new Map<string, AgentRun>();
  private readonly events: AgentEvent[] = [];
  private readonly usage: LLMUsageRecord[] = [];

  async createAgentRun(run: AgentRun): Promise<void> {
    this.runs.set(run.runId, { ...run });
  }

  async updateAgentRun(runId: string, update: Partial<AgentRun>): Promise<void> {
    const existing = this.runs.get(runId);
    if (!existing) {
      // Best-effort upsert semantics: create a new run if we have enough data.
      const now = new Date();
      const created: AgentRun = {
        runId,
        agentId: update.agentId ?? "unknown",
        status: update.status ?? "running",
        startedAt: update.startedAt ?? now,
        ...update,
      };
      this.runs.set(runId, created);
      return;
    }
    this.runs.set(runId, { ...existing, ...update });
  }

  async getAgentRun(runId: string): Promise<AgentRun | null> {
    const run = this.runs.get(runId);
    return run ? { ...run } : null;
  }

  async logEvent(event: AgentEvent): Promise<void> {
    this.events.push({ ...event });
  }

  async logLLMUsage(usage: LLMUsageRecord): Promise<void> {
    this.usage.push({ ...usage });
  }

  async getStats(agentId?: string): Promise<AgentStats> {
    const runs = [...this.runs.values()].filter((r) =>
      agentId ? r.agentId === agentId : true,
    );
    const usage = this.usage.filter((u) => (agentId ? u.agentId === agentId : true));

    let runsTotal = runs.length;
    let runsSucceeded = 0;
    let runsFailed = 0;
    let totalTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let llmCalls = 0;
    let toolCalls = 0;
    let totalCostUsd = 0;
    let totalDurationMs = 0;
    let lastRunAt: Date | null = null;

    for (const run of runs) {
      if (run.status === "completed") runsSucceeded += 1;
      if (run.status === "error") runsFailed += 1;

      if (run.usage) {
        promptTokens += run.usage.promptTokens ?? 0;
        completionTokens += run.usage.completionTokens ?? 0;
        totalTokens += run.usage.totalTokens ?? 0;
      }
      if (run.metrics) {
        llmCalls += run.metrics.llmCalls ?? 0;
        toolCalls += run.metrics.toolCalls ?? 0;
        totalCostUsd += run.metrics.estimatedCost ?? 0;
      }
      if (run.durationMs != null) {
        totalDurationMs += run.durationMs;
      }
      const completed = run.completedAt ?? run.startedAt;
      if (!lastRunAt || completed > lastRunAt) {
        lastRunAt = completed;
      }
    }

    // Fall back to usage records when runs do not have usage attached.
    if (totalTokens === 0 && usage.length > 0) {
      for (const u of usage) {
        promptTokens += u.inputTokens;
        completionTokens += u.outputTokens;
        totalTokens += u.totalTokens;
        if (u.costUsd != null) totalCostUsd += u.costUsd;
      }
    }

    const averageRunDurationMs =
      runsTotal > 0 ? Math.round(totalDurationMs / runsTotal) : 0;

    return {
      agentId: agentId ?? null,
      runsTotal,
      runsSucceeded,
      runsFailed,
      totalTokens,
      promptTokens,
      completionTokens,
      llmCalls,
      toolCalls,
      totalCostUsd,
      averageRunDurationMs,
      lastRunAt,
    };
  }
}

