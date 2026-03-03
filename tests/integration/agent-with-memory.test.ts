/**
 * Integration: Agent + Memory system
 *
 * Verifies that memory injection, saving, and agent-managed memory tools
 * work correctly when wired into the agent.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import { MemoryManager } from "../../src/memory/manager.js";
import { ConversationMemory } from "../../src/memory/conversation.js";
import { seededMemoryManager } from "../fixtures/memory.js";

function buildAgentWithMemory(llm: MockLLM, manager: MemoryManager) {
  return Agent.builder()
    .model("mock-model")
    .systemPrompt("You are a helpful assistant with memory.")
    .llmClient(llm)
    .memoryManager(manager)
    .maxIterations(10)
    .build();
}

describe("agent with memory", () => {
  it("should inject memory tools into the agent", async () => {
    const llm = new MockLLM();
    llm.addTextResponse("Hello!");
    const manager = new MemoryManager({ memory: new ConversationMemory() });
    const agent = buildAgentWithMemory(llm, manager);

    const toolNames = agent.tools.map((t) => t.name);
    expect(toolNames).toContain("save_to_memory");
    expect(toolNames).toContain("search_memory");
    expect(toolNames).toContain("forget_memory");
  });

  it("should allow the agent to save and search memory via tools", async () => {
    const llm = new MockLLM();
    // Agent saves to memory
    llm.addToolCallResponse("save_to_memory", { content: "User likes TypeScript" });
    // Agent searches memory
    llm.addToolCallResponse("search_memory", { query: "TypeScript" });
    llm.addTextResponse("I found your preference for TypeScript.");

    const manager = new MemoryManager({ memory: new ConversationMemory() });
    const agent = buildAgentWithMemory(llm, manager);
    const result = await agent.run("Remember that I like TypeScript, then find it.");

    expect(result.output).toContain("TypeScript");
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].toolName).toBe("save_to_memory");
    expect(result.toolCalls[1].toolName).toBe("search_memory");
  });

  it("should work with pre-seeded memory", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("search_memory", { query: "favorite" });
    llm.addTextResponse("Your favorite color is blue.");

    const manager = await seededMemoryManager([
      "User's favorite color is blue",
      "User prefers dark mode",
    ]);
    const agent = buildAgentWithMemory(llm, manager);
    const result = await agent.run("What's my favorite color?");

    expect(result.output).toContain("blue");
  });

  it("should handle memory search returning no results", async () => {
    const llm = new MockLLM();
    llm.addToolCallResponse("search_memory", { query: "nonexistent" });
    llm.addTextResponse("I don't have that information.");

    const manager = new MemoryManager({ memory: new ConversationMemory() });
    const agent = buildAgentWithMemory(llm, manager);
    const result = await agent.run("Do you remember X?");

    expect(result.output).toBe("I don't have that information.");
  });
});
