import { describe, it, expect } from "vitest";
import { checkpointFromState, deserializeCheckpoint, serializeCheckpoint, stateFromCheckpoint } from "../../src/core/state/checkpoint.js";
import { AgentState } from "../../src/core/state/state.js";
import type { Message } from "../../src/models/llm.js";

function makeLargeMessages(count: number): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? "user" : "assistant";
    messages.push({
      role,
      content: `Message ${i} `.repeat(50),
    });
  }
  return messages;
}

describe("Performance: Checkpoint serialization/deserialization", () => {
  it("serializes a large checkpoint 100 times in under 2000ms", () => {
    const messages = makeLargeMessages(1000);

    const state = new AgentState({
      messages,
      toolSchemas: [],
      maxIterations: 500,
      runId: "perf-run-1",
      agentId: "perf-agent-1",
      model: "test-model",
    });

    // Roughly mirror the Python perf test: 100 serializations of a large checkpoint.
    const iterations = 100;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const data = checkpointFromState(state);
      const json = serializeCheckpoint(data);
      expect(json.length).toBeGreaterThan(0);
    }
    const elapsedMs = performance.now() - start;

    // Keep parity with Python limit (< 2s).
    expect(elapsedMs).toBeLessThan(2000);
  });

  it("deserializes a large checkpoint 100 times in under 2000ms", () => {
    const messages = makeLargeMessages(1000);

    const baseState = new AgentState({
      messages,
      toolSchemas: [],
      maxIterations: 500,
      runId: "perf-run-2",
      agentId: "perf-agent-2",
      model: "test-model",
    });

    const data = checkpointFromState(baseState);
    const json = serializeCheckpoint(data);

    const iterations = 100;
    const start = performance.now();
    let restored: AgentState | undefined;
    for (let i = 0; i < iterations; i++) {
      const parsed = deserializeCheckpoint(json);
      restored = stateFromCheckpoint(parsed);
    }
    const elapsedMs = performance.now() - start;

    expect(restored).toBeDefined();
    expect(restored?.runId).toBe("perf-run-2");
    expect(restored?.messages.length).toBe(1000);
    expect(elapsedMs).toBeLessThan(2000);
  });

  it("round-trips checkpoint serialize/deserialize 500 times under 5000ms", () => {
    const messages: Message[] = Array.from({ length: 100 }, (_, i) => ({
      role: "user",
      content: `msg ${i}`,
    }));

    const state = new AgentState({
      messages,
      toolSchemas: [],
      maxIterations: 100,
      runId: "integrity-run",
      agentId: "integrity-agent",
      model: "test-model",
    });

    const iterations = 500;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const data = checkpointFromState(state);
      const json = serializeCheckpoint(data);
      const parsed = deserializeCheckpoint(json);
      const restored = stateFromCheckpoint(parsed);

      expect(restored.runId).toBe(state.runId);
      expect(restored.agentId).toBe(state.agentId);
      expect(restored.iteration).toBe(state.iteration);
      expect(restored.messages.length).toBe(state.messages.length);
    }
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(5000);
  });
});

