/**
 * Integration: Agent + Subagent system
 *
 * Verifies parent-child agent spawning and communication.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import { calculatorTool } from "../fixtures/tools.js";

describe("agent with subagents", () => {
  it("should spawn and run a named subagent", async () => {
    const llm = new MockLLM();
    // Subagent consumes from the same queue: tool call then text
    llm.addToolCallResponse("calculator", { expression: "7*8" });
    llm.addTextResponse("56.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("You are a coordinator.")
      .llmClient(llm)
      .subagent("math", {
        systemPrompt: "You are a math specialist.",
        tools: [calculatorTool],
      })
      .build();

    // Run the subagent directly
    const subResult = await agent.spawnSubagent("math", "What is 7*8?");
    expect(subResult.output).toBe("56.");
    expect(subResult.toolCalls).toHaveLength(1);
  });

  it("should throw when spawning a non-existent subagent", async () => {
    const llm = new MockLLM();
    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .build();

    await expect(agent.spawnSubagent("nonexistent", "hi")).rejects.toThrow(
      'Subagent "nonexistent" is not registered',
    );
  });

  it("should list registered subagents", async () => {
    const llm = new MockLLM();
    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .subagent("research", { systemPrompt: "Research agent." })
      .subagent("coding", { systemPrompt: "Coding agent." })
      .build();

    expect(agent.subagents.size).toBe(2);
    expect(agent.subagents.has("research")).toBe(true);
    expect(agent.subagents.has("coding")).toBe(true);
  });

  it("should share hooks between parent and subagent", async () => {
    const hookFired: string[] = [];
    const llm = new MockLLM();
    llm.addTextResponse("Sub done.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("parent")
      .llmClient(llm)
      .hook("agent.run.before", () => {
        hookFired.push("run-before");
      })
      .subagent("child", { systemPrompt: "child" })
      .build();

    await agent.spawnSubagent("child", "Go.");
    expect(hookFired.length).toBeGreaterThanOrEqual(1);
  });
});
