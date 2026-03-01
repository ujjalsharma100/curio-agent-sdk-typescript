/**
 * Distributed event bus for cross-process / cross-agent event streaming.
 *
 * Extends the in-process HookRegistry with pattern-based pub/sub,
 * event replay, dead-letter handling, and pluggable backends (in-memory by default).
 *
 * Design:
 * - EventBus interface: subscribe (glob pattern) → unsubscribe, publish, replay.
 * - InMemoryEventBus: single-process bus with bounded history and dead letter queue.
 * - EventFilter: glob/fnmatch-style matching on dotted event names (e.g. "agent.*", "tool.call.*").
 */

import { Component } from "../../base/component.js";
import type { AgentEvent, EventBusHandler, Unsubscribe } from "../../models/events.js";
import { EventType } from "../../models/events.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("event-bus");

// ---------------------------------------------------------------------------
// Event filter (glob pattern matching)
// ---------------------------------------------------------------------------

/**
 * Pattern-based event filter using glob/fnmatch-style syntax on dotted event names.
 *
 * Patterns:
 * - "*"              — matches everything
 * - "agent.*"        — matches agent.run.before, agent.iteration.after, etc.
 * - "tool.call.*"    — matches tool.call.before, tool.call.after, tool.call.error
 * - "llm.call.after" — exact match
 * - "*.error"        — matches agent.run.error, llm.call.error, tool.call.error
 */
export class EventFilter {
  private readonly re: RegExp;

  constructor(pattern: string) {
    this.re = globToRegExp(pattern);
  }

  /** Return true if eventName matches this filter's pattern. */
  matches(eventName: string): boolean {
    return this.re.test(eventName);
  }
}

/** Convert a glob pattern (* and ?) to a RegExp. Dots are literal. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const reStr = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${reStr}$`);
}

// ---------------------------------------------------------------------------
// Dead letter entry
// ---------------------------------------------------------------------------

/** A failed event delivery stored for inspection / retry. */
export interface DeadLetterEntry {
  event: AgentEvent;
  handler: string;
  error: string;
  timestamp: number;
  pattern: string;
}

// ---------------------------------------------------------------------------
// EventType → hook-style dotted name (for pattern matching)
// ---------------------------------------------------------------------------

const EVENT_TYPE_TO_HOOK_NAME: Record<EventType, string> = {
  [EventType.RUN_STARTED]: "agent.run.before",
  [EventType.RUN_COMPLETED]: "agent.run.after",
  [EventType.RUN_ERROR]: "agent.run.error",
  [EventType.ITERATION_STARTED]: "agent.iteration.before",
  [EventType.ITERATION_COMPLETED]: "agent.iteration.after",
  [EventType.LLM_CALL_STARTED]: "llm.call.before",
  [EventType.LLM_CALL_COMPLETED]: "llm.call.after",
  [EventType.LLM_CALL_ERROR]: "llm.call.error",
  [EventType.TOOL_CALL_STARTED]: "tool.call.before",
  [EventType.TOOL_CALL_COMPLETED]: "tool.call.after",
  [EventType.TOOL_CALL_ERROR]: "tool.call.error",
};

function eventTypeToHookName(eventType: EventType): string {
  return EVENT_TYPE_TO_HOOK_NAME[eventType] ?? eventType;
}

// ---------------------------------------------------------------------------
// EventBus interface
// ---------------------------------------------------------------------------

export interface EventBus {
  /**
   * Subscribe a handler to events matching a glob pattern.
   * @returns Unsubscribe function.
   */
  subscribe(pattern: string, handler: EventBusHandler): Unsubscribe;

  /** Publish an event to all matching subscribers. */
  publish(event: AgentEvent): Promise<void>;

  /**
   * Replay stored events from a given time, optionally filtered by pattern.
   * Not all backends support replay; default may throw.
   */
  replay(startTime: Date, pattern?: string): AsyncIterableIterator<AgentEvent>;

  /** Dead letter queue (failed deliveries). */
  readonly deadLetters: DeadLetterEntry[];
}

// ---------------------------------------------------------------------------
// InMemoryEventBus
// ---------------------------------------------------------------------------

export interface InMemoryEventBusOptions {
  /** Max events to keep for replay. Default 10_000. */
  maxHistory?: number;
  /** Max dead letter entries. Default 1_000. */
  maxDeadLetters?: number;
}

/**
 * Single-process event bus with full replay support and dead letter queue.
 *
 * Good for testing, development, and single-process multi-agent setups.
 */
export class InMemoryEventBus extends Component implements EventBus {
  private readonly _subscribers = new Map<string, EventBusHandler[]>();
  private readonly _history: AgentEvent[] = [];
  private readonly _deadLetters: DeadLetterEntry[] = [];
  private readonly maxHistory: number;
  private readonly maxDeadLetters: number;
  private _started = false;

  constructor(options: InMemoryEventBusOptions = {}) {
    super();
    this.maxHistory = options.maxHistory ?? 10_000;
    this.maxDeadLetters = options.maxDeadLetters ?? 1_000;
  }

  async startup(): Promise<void> {
    this._started = true;
    log.debug("InMemoryEventBus started");
    this.markInitialized();
  }

  async shutdown(): Promise<void> {
    this._subscribers.clear();
    this._started = false;
    this.markShutdown();
    log.debug("InMemoryEventBus shut down");
  }

  async healthCheck(): Promise<boolean> {
    return this._started;
  }

  async publish(event: AgentEvent): Promise<void> {
    this._history.push(event);
    if (this._history.length > this.maxHistory) {
      this._history.shift();
    }
    const eventName = eventTypeToHookName(event.type);

    for (const [pattern, handlers] of this._subscribers) {
      const patFilter = new EventFilter(pattern);
      if (!patFilter.matches(eventName)) continue;
      for (const handler of handlers) {
        try {
          const result = handler(event);
          if (result instanceof Promise) await result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.warn({ err, eventName, pattern }, "EventBus handler failed");
          this._deadLetters.push({
            event,
            handler: String(handler),
            error: message,
            timestamp: Date.now(),
            pattern,
          });
          if (this._deadLetters.length > this.maxDeadLetters) {
            this._deadLetters.shift();
          }
        }
      }
    }
  }

  subscribe(pattern: string, handler: EventBusHandler): Unsubscribe {
    const list = this._subscribers.get(pattern) ?? [];
    list.push(handler);
    this._subscribers.set(pattern, list);
    return () => {
      const current = this._subscribers.get(pattern);
      if (!current) return;
      const idx = current.indexOf(handler);
      if (idx >= 0) current.splice(idx, 1);
      if (current.length === 0) this._subscribers.delete(pattern);
    };
  }

  async *replay(
    startTime: Date,
    pattern: string = "*",
  ): AsyncIterableIterator<AgentEvent> {
    const filt = new EventFilter(pattern);
    const fromTs = startTime.getTime();
    for (const event of this._history) {
      if (event.timestamp.getTime() < fromTs) continue;
      const eventName = eventTypeToHookName(event.type);
      if (filt.matches(eventName)) yield event;
    }
  }

  get deadLetters(): DeadLetterEntry[] {
    return [...this._deadLetters];
  }

  /** Clear the dead letter queue. */
  clearDeadLetters(): void {
    this._deadLetters.length = 0;
  }

  /** Clear event history (replay will yield nothing until new events). */
  clearHistory(): void {
    this._history.length = 0;
  }
}
