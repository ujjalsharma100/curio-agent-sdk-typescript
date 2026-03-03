/**
 * Integration: Cost tracking and budget enforcement
 *
 * Verifies that CostTracker middleware tracks costs and enforces budgets.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import { CostTracker } from "../../src/middleware/cost-tracker.js";

describe("cost budget integration", () => {
  it("should track costs across LLM calls", async () => {
    const tracker = new CostTracker();
    const llm = new MockLLM();
    llm.addTextResponse("Hello!");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .middleware([tracker])
      .build();

    await agent.run("Hi.");

    expect(tracker.callCount).toBeGreaterThanOrEqual(1);
    expect(tracker.totalCost).toBeGreaterThan(0);
    expect(tracker.totalInputTokens).toBeGreaterThan(0);
    expect(tracker.totalOutputTokens).toBeGreaterThan(0);
  });

  it("should enforce budget limits", async () => {
    const tracker = new CostTracker({ budget: 0.000001 }); // Extremely low budget
    const llm = new MockLLM();
    // First call will succeed but use up budget
    llm.addTextResponse("First response with enough tokens to exceed budget.");
    // Second call should fail
    llm.addTextResponse("Should not reach.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .middleware([tracker])
      .build();

    // First run should succeed
    await agent.run("First call.");

    // Second run should fail with budget exceeded
    await expect(agent.run("Second call.")).rejects.toThrow("budget");
  });

  it("should provide per-model cost breakdown", async () => {
    const tracker = new CostTracker();
    const llm = new MockLLM();
    llm.addTextResponse("Response.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .middleware([tracker])
      .build();

    await agent.run("Test.");

    const summary = tracker.getSummary();
    expect(summary.callCount).toBeGreaterThanOrEqual(1);
    expect(summary.totalCost).toBeGreaterThan(0);
    expect(Object.keys(summary.perModel).length).toBeGreaterThanOrEqual(1);
  });

  it("should fire threshold alerts", async () => {
    const alerts: number[] = [];
    // Use an extremely small budget so any token usage crosses the threshold
    const tracker = new CostTracker({
      budget: 0.000001,
      alertThresholds: [0.5],
      onThreshold: (threshold) => {
        alerts.push(threshold);
      },
    });

    const llm = new MockLLM();
    llm.addTextResponse("Response that consumes tokens.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .middleware([tracker])
      .build();

    // The first call will exceed budget, but the threshold check
    // happens in afterLLMCall which runs after the response is received
    try {
      await agent.run("Test.");
    } catch {
      // Budget exceeded on second call is expected
    }

    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });

  it("should reset cost tracking", async () => {
    const tracker = new CostTracker();
    const llm = new MockLLM();
    llm.addTextResponse("Test.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .middleware([tracker])
      .build();

    await agent.run("Hello.");
    expect(tracker.callCount).toBeGreaterThan(0);

    tracker.reset();
    expect(tracker.callCount).toBe(0);
    expect(tracker.totalCost).toBe(0);
  });
});
