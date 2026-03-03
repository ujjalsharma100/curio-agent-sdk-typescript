/**
 * Event collector helpers for hook and event assertions in tests.
 */
import type { HookContext, HookHandler, AgentEvent } from "../../src/models/events.js";

/** Collects hook invocations for later assertion. */
export class HookCollector {
  readonly calls: Array<{ event: string; data: Record<string, unknown> }> = [];

  /** Returns a HookHandler that records invocations. */
  handler(): HookHandler {
    return (ctx: HookContext) => {
      this.calls.push({ event: ctx.event, data: { ...ctx.data } });
    };
  }

  /** Count how many times a specific event was captured. */
  countEvent(event: string): number {
    return this.calls.filter((c) => c.event === event).length;
  }

  /** Get data for calls matching a specific event. */
  getEventData(event: string): Array<Record<string, unknown>> {
    return this.calls.filter((c) => c.event === event).map((c) => c.data);
  }

  /** Whether a specific event was captured at least once. */
  hasFired(event: string): boolean {
    return this.calls.some((c) => c.event === event);
  }

  /** Get the ordered list of event names. */
  eventNames(): string[] {
    return this.calls.map((c) => c.event);
  }

  /** Reset collected calls. */
  clear(): void {
    this.calls.length = 0;
  }
}

/** Collects AgentEvent bus events for later assertion. */
export class EventBusCollector {
  readonly events: AgentEvent[] = [];

  /** Returns a handler suitable for eventBus.subscribe(). */
  handler(): (event: AgentEvent) => void {
    return (event: AgentEvent) => {
      this.events.push(event);
    };
  }

  /** Count events of a specific type. */
  countType(type: string): number {
    return this.events.filter((e) => e.type === type).length;
  }

  /** Get events of a specific type. */
  ofType(type: string): AgentEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /** Get the ordered list of event types. */
  types(): string[] {
    return this.events.map((e) => e.type);
  }

  clear(): void {
    this.events.length = 0;
  }
}

/** Create a cancelling hook handler (useful for testing hook cancellation). */
export function cancellingHandler(): HookHandler {
  return (ctx: HookContext) => {
    ctx.cancel();
  };
}

/** Create a hook handler that modifies a specific data key. */
export function modifyingHandler(key: string, value: unknown): HookHandler {
  return (ctx: HookContext) => {
    ctx.modify(key, value);
  };
}
