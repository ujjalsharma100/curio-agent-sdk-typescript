/**
 * E2E: Multi-agent / subagent workflow
 *
 * Validates parent-child agent orchestration where a parent delegates
 * tasks to specialized subagents.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import { calculatorTool, searchTool } from "../fixtures/tools.js";

describe("E2E: multi-agent", () => {
  it("should delegate to a math subagent and return results", async () => {
    const llm = new MockLLM();
    // Subagent: tool call + final answer
    llm.addToolCallResponse("calculator", { expression: "100 / 7" });
    llm.addTextResponse("100 divided by 7 is approximately 14.29.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("You are a coordinator that delegates to specialists.")
      .llmClient(llm)
      .subagent("math", {
        systemPrompt: "You are a math specialist. Use the calculator tool.",
        tools: [calculatorTool],
      })
      .build();

    const result = await agent.spawnSubagent("math", "What is 100 divided by 7?");

    expect(result.output).toContain("14");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolName).toBe("calculator");
  });

  it("should run multiple subagents independently", async () => {
    const llm = new MockLLM();
    // Math subagent
    llm.addToolCallResponse("calculator", { expression: "5+5" });
    llm.addTextResponse("10.");
    // Research subagent
    llm.addToolCallResponse("search", { query: "TypeScript history" });
    llm.addTextResponse("TypeScript was created by Microsoft in 2012.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Coordinator.")
      .llmClient(llm)
      .subagent("math", {
        systemPrompt: "Math agent.",
        tools: [calculatorTool],
      })
      .subagent("research", {
        systemPrompt: "Research agent.",
        tools: [searchTool],
      })
      .build();

    const mathResult = await agent.spawnSubagent("math", "5+5?");
    expect(mathResult.output).toBe("10.");

    const researchResult = await agent.spawnSubagent("research", "Tell me about TypeScript.");
    expect(researchResult.output).toContain("TypeScript");
  });

  it("should stream events from a subagent", async () => {
    const llm = new MockLLM();
    llm.addStreamResponse(["Sub", "agent", " reply."]);

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("parent")
      .llmClient(llm)
      .subagent("streamer", { systemPrompt: "Streaming sub." })
      .build();

    const events = [];
    for await (const event of agent.spawnSubagentStream("streamer", "Stream test.")) {
      events.push(event);
    }

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    if (doneEvent?.type === "done") {
      expect(doneEvent.result.output).toBeTruthy();
    }
  });

  it("should isolate subagent tool registries", async () => {
    const llm = new MockLLM();
    llm.addTextResponse("Parent has no tools.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("parent")
      .llmClient(llm)
      .subagent("tooled", {
        systemPrompt: "Has calculator.",
        tools: [calculatorTool],
      })
      .build();

    // Parent should not have calculator tool
    expect(agent.tools.map((t) => t.name)).not.toContain("calculator");

    // Subagent should have calculator tool
    const sub = agent.subagents.get("tooled");
    expect(sub).toBeDefined();
    expect(sub!.tools.map((t) => t.name)).toContain("calculator");
  });
});
