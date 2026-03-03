/**
 * Integration: EventBus pub/sub, replay, and dead letters
 *
 * Verifies event bus functionality end-to-end.
 */
import { describe, it, expect } from "vitest";
import { InMemoryEventBus, EventFilter } from "../../src/core/events/event-bus.js";
import { EventType, type AgentEvent } from "../../src/models/events.js";
import { EventBusCollector } from "../fixtures/events.js";

function createEvent(type: EventType, data: Record<string, unknown> = {}): AgentEvent {
  return {
    type,
    timestamp: new Date(),
    data,
    runId: "run-1",
    agentId: "agent-1",
    iteration: 0,
  };
}

describe("event bus integration", () => {
  it("should publish and receive events matching a pattern", async () => {
    const bus = new InMemoryEventBus();
    await bus.startup();

    const collector = new EventBusCollector();
    bus.subscribe("agent.*", collector.handler());

    await bus.publish(createEvent(EventType.RUN_STARTED));
    await bus.publish(createEvent(EventType.RUN_COMPLETED));

    expect(collector.events).toHaveLength(2);
    await bus.shutdown();
  });

  it("should filter events by pattern", async () => {
    const bus = new InMemoryEventBus();
    await bus.startup();

    const toolCollector = new EventBusCollector();
    const llmCollector = new EventBusCollector();
    bus.subscribe("tool.*", toolCollector.handler());
    bus.subscribe("llm.*", llmCollector.handler());

    await bus.publish(createEvent(EventType.TOOL_CALL_STARTED));
    await bus.publish(createEvent(EventType.LLM_CALL_STARTED));

    expect(toolCollector.events).toHaveLength(1);
    expect(llmCollector.events).toHaveLength(1);
    await bus.shutdown();
  });

  it("should support wildcard subscriptions", async () => {
    const bus = new InMemoryEventBus();
    await bus.startup();

    const collector = new EventBusCollector();
    bus.subscribe("*", collector.handler());

    await bus.publish(createEvent(EventType.RUN_STARTED));
    await bus.publish(createEvent(EventType.TOOL_CALL_STARTED));
    await bus.publish(createEvent(EventType.LLM_CALL_STARTED));

    expect(collector.events).toHaveLength(3);
    await bus.shutdown();
  });

  it("should support unsubscribe", async () => {
    const bus = new InMemoryEventBus();
    await bus.startup();

    const collector = new EventBusCollector();
    const unsub = bus.subscribe("*", collector.handler());

    await bus.publish(createEvent(EventType.RUN_STARTED));
    expect(collector.events).toHaveLength(1);

    unsub();

    await bus.publish(createEvent(EventType.RUN_COMPLETED));
    expect(collector.events).toHaveLength(1); // no new events
    await bus.shutdown();
  });

  it("should replay events from a timestamp", async () => {
    const bus = new InMemoryEventBus();
    await bus.startup();

    const before = new Date();
    await bus.publish(createEvent(EventType.RUN_STARTED));
    await bus.publish(createEvent(EventType.RUN_COMPLETED));

    const replayed: AgentEvent[] = [];
    for await (const event of bus.replay(before)) {
      replayed.push(event);
    }
    expect(replayed).toHaveLength(2);
    await bus.shutdown();
  });

  it("should capture dead letters for failed handlers", async () => {
    const bus = new InMemoryEventBus();
    await bus.startup();

    bus.subscribe("*", () => {
      throw new Error("Handler boom");
    });

    await bus.publish(createEvent(EventType.RUN_STARTED));
    expect(bus.deadLetters).toHaveLength(1);
    expect(bus.deadLetters[0].error).toContain("Handler boom");
    await bus.shutdown();
  });

  it("should match patterns correctly with EventFilter", () => {
    expect(new EventFilter("agent.*").matches("agent.run.before")).toBe(true);
    expect(new EventFilter("agent.*").matches("llm.call.before")).toBe(false);
    expect(new EventFilter("*").matches("anything.here")).toBe(true);
    expect(new EventFilter("llm.call.after").matches("llm.call.after")).toBe(true);
    expect(new EventFilter("*.error").matches("tool.call.error")).toBe(true);
  });
});
