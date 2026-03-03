/**
 * E2E: Memory-enabled agent workflow
 *
 * Validates that an agent with memory can persist information across runs
 * and use memory tools to store/retrieve facts.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import { MemoryManager } from "../../src/memory/manager.js";
import { ConversationMemory } from "../../src/memory/conversation.js";
import { KeyValueMemory } from "../../src/memory/key-value.js";
import { CompositeMemory } from "../../src/memory/composite.js";

describe("E2E: memory agent", () => {
  it("should save information and retrieve it in a later run", async () => {
    const memory = new ConversationMemory();
    const manager = new MemoryManager({ memory });

    const llm = new MockLLM();
    // Run 1: save to memory
    llm.addToolCallResponse("save_to_memory", {
      content: "User's favorite language is TypeScript",
    });
    llm.addTextResponse("I'll remember that you love TypeScript!");
    // Run 2: search memory
    llm.addToolCallResponse("search_memory", { query: "favorite language" });
    llm.addTextResponse("Your favorite language is TypeScript!");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("You have memory. Use it to remember and recall facts.")
      .llmClient(llm)
      .memoryManager(manager)
      .maxIterations(5)
      .build();

    // Run 1: save
    const r1 = await agent.run("Remember: my favorite language is TypeScript.");
    expect(r1.output).toContain("TypeScript");
    expect(r1.toolCalls[0].toolName).toBe("save_to_memory");

    // Verify memory was populated
    expect(await memory.count()).toBeGreaterThanOrEqual(1);

    // Run 2: recall
    const r2 = await agent.run("What's my favorite language?");
    expect(r2.output).toContain("TypeScript");
    expect(r2.toolCalls[0].toolName).toBe("search_memory");
  });

  it("should work with composite memory (conversation + KV)", async () => {
    const conv = new ConversationMemory();
    const kv = new KeyValueMemory();
    const composite = new CompositeMemory({ conversation: conv, kv });
    const manager = new MemoryManager({ memory: composite });

    const llm = new MockLLM();
    llm.addToolCallResponse("save_to_memory", { content: "API key is abc123" });
    llm.addTextResponse("Saved.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("You have composite memory.")
      .llmClient(llm)
      .memoryManager(manager)
      .maxIterations(5)
      .build();

    await agent.run("Save the API key: abc123");

    // Both backends should have the entry
    expect(await conv.count()).toBeGreaterThanOrEqual(1);
    expect(await kv.count()).toBeGreaterThanOrEqual(1);
  });

  it("should handle memory deletion", async () => {
    const memory = new ConversationMemory();
    const manager = new MemoryManager({ memory });

    // Pre-seed memory
    const entryId = await memory.add("Secret data");
    const countBefore = await memory.count();
    expect(countBefore).toBe(1);

    const llm = new MockLLM();
    llm.addToolCallResponse("forget_memory", { entryId });
    llm.addTextResponse("I've forgotten that information.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("You can manage memory.")
      .llmClient(llm)
      .memoryManager(manager)
      .maxIterations(5)
      .build();

    const result = await agent.run(`Delete memory entry ${entryId}.`);

    expect(result.output).toContain("forgotten");
    // The seeded entry should have been deleted via the forget_memory tool
    const entry = await memory.get(entryId);
    expect(entry).toBeUndefined();
  });

  it("should handle memory search with no results", async () => {
    const memory = new ConversationMemory();
    const manager = new MemoryManager({ memory });

    const llm = new MockLLM();
    llm.addToolCallResponse("search_memory", { query: "nonexistent topic" });
    llm.addTextResponse("I don't have any information about that topic.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Search memory when asked.")
      .llmClient(llm)
      .memoryManager(manager)
      .maxIterations(5)
      .build();

    const result = await agent.run("What do you know about quantum physics?");
    expect(result.output).toContain("don't have");
  });
});
