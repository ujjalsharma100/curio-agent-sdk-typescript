/**
 * Hook registry — central event handler system for the agent lifecycle.
 *
 * Hooks allow middleware, plugins, and application code to intercept and
 * modify agent behavior at well-defined points (before/after LLM calls,
 * tool calls, runs, etc.).
 */

import { HookContext } from "../../models/events.js";
import type { HookHandler } from "../../models/events.js";

interface RegisteredHook {
  handler: HookHandler;
  priority: number;
}

export class HookRegistry {
  private readonly hooks = new Map<string, RegisteredHook[]>();

  /**
   * Register a handler for an event.
   * @param event - The event name (e.g., "tool.call.before"). Supports wildcards not yet.
   * @param handler - The handler function.
   * @param priority - Lower priority = earlier execution. Default: 100.
   */
  on(event: string, handler: HookHandler, priority = 100): void {
    const list = this.hooks.get(event) ?? [];
    list.push({ handler, priority });
    list.sort((a, b) => a.priority - b.priority);
    this.hooks.set(event, list);
  }

  /** Remove a specific handler for an event. */
  off(event: string, handler: HookHandler): void {
    const list = this.hooks.get(event);
    if (!list) return;
    const idx = list.findIndex((h) => h.handler === handler);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0) this.hooks.delete(event);
  }

  /**
   * Emit an event, calling all registered handlers in priority order.
   * Handlers can cancel the operation via ctx.cancel() or modify data via ctx.modify().
   * @returns The (possibly mutated) HookContext.
   */
  async emit(event: string, ctx: HookContext): Promise<HookContext> {
    const list = this.hooks.get(event);
    if (!list || list.length === 0) return ctx;

    for (const { handler } of list) {
      await handler(ctx);
      if (ctx.cancelled) break;
    }

    return ctx;
  }

  /** Check if any handlers are registered for an event. */
  hasHandlers(event: string): boolean {
    const list = this.hooks.get(event);
    return !!list && list.length > 0;
  }

  /** Get the number of handlers registered for an event. */
  handlerCount(event: string): number {
    return this.hooks.get(event)?.length ?? 0;
  }

  /** Get all registered event names. */
  getRegisteredEvents(): string[] {
    return [...this.hooks.keys()];
  }

  /** Remove all handlers. */
  clear(): void {
    this.hooks.clear();
  }
}
