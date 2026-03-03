import { HookEvent } from "../models/events.js";
import type { HookContext } from "../models/events.js";
import type { HookRegistry } from "../core/events/hooks.js";

export interface AgentCoverageReport {
  toolsCalled: string[];
  hooksEmitted: string[];
  errorPaths: string[];
}

export class AgentCoverageTracker {
  private readonly toolsCalled = new Set<string>();
  private readonly hooksEmitted = new Set<string>();
  private readonly errorPaths = new Set<string>();

  register(registry: HookRegistry): void {
    for (const event of Object.values(HookEvent)) {
      registry.on(event, this.onEvent, 1000);
    }
  }

  reset(): void {
    this.toolsCalled.clear();
    this.hooksEmitted.clear();
    this.errorPaths.clear();
  }

  getReport(): AgentCoverageReport {
    return {
      toolsCalled: [...this.toolsCalled].sort(),
      hooksEmitted: [...this.hooksEmitted].sort(),
      errorPaths: [...this.errorPaths].sort(),
    };
  }

  private onEvent = (ctx: HookContext): void => {
    this.hooksEmitted.add(ctx.event);

    if (ctx.event === HookEvent.TOOL_CALL_AFTER) {
      const tool = (ctx.data["toolName"] ?? ctx.data["tool"]) as string | undefined;
      if (tool) this.toolsCalled.add(tool);
      return;
    }

    if (ctx.event === HookEvent.TOOL_CALL_ERROR) {
      this.errorPaths.add("tool_error");
      return;
    }

    if (ctx.event === HookEvent.LLM_CALL_ERROR) {
      this.errorPaths.add("llm_error");
      return;
    }

    if (ctx.event === HookEvent.AGENT_RUN_ERROR) {
      this.errorPaths.add("run_error");
    }
  };
}

export function mergeCoverageReports(reports: AgentCoverageReport[]): AgentCoverageReport {
  const toolsCalled = new Set<string>();
  const hooksEmitted = new Set<string>();
  const errorPaths = new Set<string>();

  for (const report of reports) {
    report.toolsCalled.forEach((name) => toolsCalled.add(name));
    report.hooksEmitted.forEach((name) => hooksEmitted.add(name));
    report.errorPaths.forEach((name) => errorPaths.add(name));
  }

  return {
    toolsCalled: [...toolsCalled].sort(),
    hooksEmitted: [...hooksEmitted].sort(),
    errorPaths: [...errorPaths].sort(),
  };
}

