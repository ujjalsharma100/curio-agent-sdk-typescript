/**
 * Unit tests for Phase 7: Hooks & Events — HookContext, HookRegistry, EventFilter, InMemoryEventBus.
 */

import { describe, it, expect } from "vitest";
import type { AgentEvent } from "../../src/index.js";
import {
  HookContext,
  HookEvent,
  HookRegistry,
  EventFilter,
  InMemoryEventBus,
  createAgentEvent,
  EventType,
} from "../../src/index.js";

// ---------------------------------------------------------------------------
// HookContext — state, isCancelled
// ---------------------------------------------------------------------------

describe("HookContext", () => {
  it("should support optional state", () => {
    const state = { messages: [] };
    const ctx = new HookContext({
      event: HookEvent.AGENT_RUN_BEFORE,
      data: {},
      state,
    });
    expect(ctx.state).toBe(state);
  });

  it("should expose isCancelled()", () => {
    const ctx = new HookContext({
      event: HookEvent.AGENT_RUN_BEFORE,
      data: {},
    });
    expect(ctx.isCancelled()).toBe(false);
    expect(ctx.cancelled).toBe(false);
    ctx.cancel();
    expect(ctx.isCancelled()).toBe(true);
    expect(ctx.cancelled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HookRegistry — listHandlers, priority, emit, cancel
// ---------------------------------------------------------------------------

describe("HookRegistry", () => {
  it("should register and emit to sync handler", async () => {
    const reg = new HookRegistry();
    const seen: string[] = [];
    const handler = (ctx: HookContext) => {
      seen.push(ctx.event);
    };
    reg.on(HookEvent.AGENT_RUN_BEFORE, handler);
    const ctx = new HookContext({
      event: HookEvent.AGENT_RUN_BEFORE,
      data: {},
    });
    await reg.emit(HookEvent.AGENT_RUN_BEFORE, ctx);
    expect(seen).toEqual([HookEvent.AGENT_RUN_BEFORE]);
  });

  it("should register and emit to async handler", async () => {
    const reg = new HookRegistry();
    const seen: string[] = [];
    const handler = async (ctx: HookContext) => {
      seen.push(ctx.event);
    };
    reg.on(HookEvent.AGENT_RUN_BEFORE, handler);
    const ctx = new HookContext({
      event: HookEvent.AGENT_RUN_BEFORE,
      data: {},
    });
    await reg.emit(HookEvent.AGENT_RUN_BEFORE, ctx);
    expect(seen).toEqual([HookEvent.AGENT_RUN_BEFORE]);
  });

  it("should run handlers in priority order (lower first)", async () => {
    const reg = new HookRegistry();
    const order: string[] = [];
    reg.on(HookEvent.TOOL_CALL_BEFORE, () => order.push("low"), 10);
    reg.on(HookEvent.TOOL_CALL_BEFORE, () => order.push("high"), 0);
    const ctx = new HookContext({
      event: HookEvent.TOOL_CALL_BEFORE,
      data: {},
    });
    await reg.emit(HookEvent.TOOL_CALL_BEFORE, ctx);
    expect(order).toEqual(["high", "low"]);
  });

  it("should stop calling handlers after cancel", async () => {
    const reg = new HookRegistry();
    const order: string[] = [];
    reg.on(HookEvent.LLM_CALL_BEFORE, (ctx) => {
      order.push("first");
      ctx.cancel();
    });
    reg.on(HookEvent.LLM_CALL_BEFORE, () => order.push("second"));
    const ctx = new HookContext({
      event: HookEvent.LLM_CALL_BEFORE,
      data: {},
    });
    await reg.emit(HookEvent.LLM_CALL_BEFORE, ctx);
    expect(order).toEqual(["first"]);
    expect(ctx.isCancelled()).toBe(true);
  });

  it("should remove handler with off", async () => {
    const reg = new HookRegistry();
    const seen: number[] = [];
    const handler = () => seen.push(1);
    reg.on(HookEvent.AGENT_RUN_BEFORE, handler);
    await reg.emit(
      HookEvent.AGENT_RUN_BEFORE,
      new HookContext({ event: HookEvent.AGENT_RUN_BEFORE, data: {} }),
    );
    expect(seen).toHaveLength(1);
    reg.off(HookEvent.AGENT_RUN_BEFORE, handler);
    await reg.emit(
      HookEvent.AGENT_RUN_BEFORE,
      new HookContext({ event: HookEvent.AGENT_RUN_BEFORE, data: {} }),
    );
    expect(seen).toHaveLength(1);
  });

  it("should list handlers for an event", () => {
    const reg = new HookRegistry();
    const h1 = () => {};
    const h2 = () => {};
    expect(reg.listHandlers(HookEvent.AGENT_RUN_AFTER)).toEqual([]);
    reg.on(HookEvent.AGENT_RUN_AFTER, h1);
    reg.on(HookEvent.AGENT_RUN_AFTER, h2, 0);
    const list = reg.listHandlers(HookEvent.AGENT_RUN_AFTER);
    expect(list).toHaveLength(2);
    expect(list[0]).toBe(h2); // priority order
    expect(list[1]).toBe(h1);
  });

  it("should return same context from emit", async () => {
    const reg = new HookRegistry();
    const ctx = new HookContext({
      event: HookEvent.AGENT_RUN_BEFORE,
      data: { x: 1 },
    });
    const result = await reg.emit(HookEvent.AGENT_RUN_BEFORE, ctx);
    expect(result).toBe(ctx);
    expect(result.data.x).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// EventFilter — glob pattern matching
// ---------------------------------------------------------------------------

describe("EventFilter", () => {
  it("should match * to all", () => {
    const f = new EventFilter("*");
    expect(f.matches("agent.run.before")).toBe(true);
    expect(f.matches("llm.call.after")).toBe(true);
    expect(f.matches("tool.call.error")).toBe(true);
  });

  it("should match agent.* to agent events", () => {
    const f = new EventFilter("agent.*");
    expect(f.matches("agent.run.before")).toBe(true);
    expect(f.matches("agent.iteration.after")).toBe(true);
    expect(f.matches("llm.call.after")).toBe(false);
  });

  it("should match exact event", () => {
    const f = new EventFilter("llm.call.after");
    expect(f.matches("llm.call.after")).toBe(true);
    expect(f.matches("llm.call.before")).toBe(false);
  });

  it("should match *.error", () => {
    const f = new EventFilter("*.error");
    expect(f.matches("agent.run.error")).toBe(true);
    expect(f.matches("llm.call.error")).toBe(true);
    expect(f.matches("tool.call.after")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// InMemoryEventBus — publish, subscribe, replay, dead letters, lifecycle
// ---------------------------------------------------------------------------

function makeEvent(
  type: EventType,
  overrides: Partial<{ runId: string; agentId: string; iteration: number }> = {},
) {
  return createAgentEvent(type, {}, {
    runId: "r1",
    agentId: "a1",
    iteration: 0,
    ...overrides,
  });
}

describe("InMemoryEventBus", () => {
  it("should startup and shutdown", async () => {
    const bus = new InMemoryEventBus();
    expect(await bus.healthCheck()).toBe(false);
    await bus.startup();
    expect(await bus.healthCheck()).toBe(true);
    await bus.shutdown();
    expect(await bus.healthCheck()).toBe(false);
  });

  it("should publish and deliver to subscriber", async () => {
    const bus = new InMemoryEventBus({ maxHistory: 100 });
    await bus.startup();
    const received: AgentEvent[] = [];
    const handler = (ev: AgentEvent) => received.push(ev);
    bus.subscribe("*", handler);
    const event = makeEvent(EventType.RUN_STARTED);
    await bus.publish(event);
    expect(received).toHaveLength(1);
    expect(received[0].runId).toBe("r1");
    await bus.shutdown();
  });

  it("should deliver only to matching pattern", async () => {
    const bus = new InMemoryEventBus();
    await bus.startup();
    const agentEvents: EventType[] = [];
    const llmEvents: EventType[] = [];
    bus.subscribe("agent.*", (ev) => agentEvents.push(ev.type));
    bus.subscribe("llm.call.*", (ev) => llmEvents.push(ev.type));
    await bus.publish(makeEvent(EventType.RUN_STARTED));
    await bus.publish(makeEvent(EventType.LLM_CALL_COMPLETED));
    await bus.publish(makeEvent(EventType.TOOL_CALL_STARTED));
    expect(agentEvents).toHaveLength(1);
    expect(agentEvents[0]).toBe(EventType.RUN_STARTED);
    expect(llmEvents).toHaveLength(1);
    expect(llmEvents[0]).toBe(EventType.LLM_CALL_COMPLETED);
    await bus.shutdown();
  });

  it("should unsubscribe via returned function", async () => {
    const bus = new InMemoryEventBus();
    await bus.startup();
    let count = 0;
    const handler = () => count++;
    const unsub = bus.subscribe("*", handler);
    await bus.publish(makeEvent(EventType.RUN_STARTED));
    expect(count).toBe(1);
    unsub();
    await bus.publish(makeEvent(EventType.RUN_COMPLETED));
    expect(count).toBe(1);
    await bus.shutdown();
  });

  it("should replay events from startTime", async () => {
    const bus = new InMemoryEventBus({ maxHistory: 100 });
    await bus.startup();
    const t0 = new Date();
    await bus.publish(makeEvent(EventType.RUN_STARTED));
    await bus.publish(makeEvent(EventType.LLM_CALL_STARTED));
    await bus.publish(makeEvent(EventType.TOOL_CALL_STARTED));
    const replayed: EventType[] = [];
    for await (const ev of bus.replay(t0, "*")) {
      replayed.push(ev.type);
    }
    expect(replayed).toContain(EventType.RUN_STARTED);
    expect(replayed).toContain(EventType.LLM_CALL_STARTED);
    expect(replayed).toContain(EventType.TOOL_CALL_STARTED);
    expect(replayed).toHaveLength(3);
    await bus.shutdown();
  });

  it("should replay with pattern filter", async () => {
    const bus = new InMemoryEventBus({ maxHistory: 100 });
    await bus.startup();
    const t0 = new Date();
    await bus.publish(makeEvent(EventType.RUN_STARTED));
    await bus.publish(makeEvent(EventType.LLM_CALL_COMPLETED));
    const replayed: EventType[] = [];
    for await (const ev of bus.replay(t0, "agent.*")) {
      replayed.push(ev.type);
    }
    expect(replayed).toEqual([EventType.RUN_STARTED]);
    await bus.shutdown();
  });

  it("should push failed delivery to dead letters", async () => {
    const bus = new InMemoryEventBus({ maxHistory: 100, maxDeadLetters: 10 });
    await bus.startup();
    const failingHandler = () => {
      throw new Error("handler failed");
    };
    bus.subscribe("*", failingHandler);
    await bus.publish(makeEvent(EventType.RUN_STARTED));
    expect(bus.deadLetters).toHaveLength(1);
    expect(bus.deadLetters[0].error).toBe("handler failed");
    expect(bus.deadLetters[0].event.type).toBe(EventType.RUN_STARTED);
    await bus.shutdown();
  });

  it("should clear dead letters and history", async () => {
    const bus = new InMemoryEventBus({ maxHistory: 10, maxDeadLetters: 10 });
    await bus.startup();
    bus.subscribe("*", () => {
      throw new Error("oops");
    });
    await bus.publish(makeEvent(EventType.RUN_STARTED));
    expect(bus.deadLetters).toHaveLength(1);
    bus.clearDeadLetters();
    expect(bus.deadLetters).toHaveLength(0);
    bus.clearHistory();
    const replayed: unknown[] = [];
    for await (const ev of bus.replay(new Date(0), "*")) {
      replayed.push(ev);
    }
    expect(replayed).toHaveLength(0);
    await bus.shutdown();
  });

  it("should support async handler", async () => {
    const bus = new InMemoryEventBus();
    await bus.startup();
    const payload: EventType[] = [];
    const asyncHandler = async (ev: { type: EventType }) => {
      payload.push(ev.type);
    };
    bus.subscribe("*", asyncHandler);
    await bus.publish(
      createAgentEvent(EventType.ITERATION_STARTED, { x: 1 }, {
        runId: "r1",
        agentId: "a1",
        iteration: 0,
      }),
    );
    expect(payload).toEqual([EventType.ITERATION_STARTED]);
    await bus.shutdown();
  });
});
