/**
 * Integration: Agent + Session management
 *
 * Verifies multi-turn conversation persistence through SessionManager.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import { SessionManager, InMemorySessionStore } from "../../src/core/state/session.js";

function buildSessionAgent(llm: MockLLM, sessionManager: SessionManager) {
  return Agent.builder()
    .model("mock-model")
    .systemPrompt("You are a helpful assistant.")
    .llmClient(llm)
    .sessionManager(sessionManager)
    .maxIterations(5)
    .build();
}

describe("agent with sessions", () => {
  it("should create and use a session for multi-turn conversation", async () => {
    const store = new InMemorySessionStore();
    const sessionManager = new SessionManager(store);
    const session = await sessionManager.create("test-agent");

    const llm = new MockLLM();
    llm.addTextResponse("Hello! How can I help?");
    llm.addTextResponse("Your name is Alice, as you mentioned.");

    const agent = buildSessionAgent(llm, sessionManager);

    // Turn 1
    const r1 = await agent.run("My name is Alice.", { sessionId: session.id });
    expect(r1.output).toBe("Hello! How can I help?");

    // Turn 2 — should have history from turn 1
    const r2 = await agent.run("What's my name?", { sessionId: session.id });
    expect(r2.output).toContain("Alice");

    // Verify messages were persisted to session
    const messages = await sessionManager.getMessages(session.id);
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });

  it("should work without a session (stateless mode)", async () => {
    const llm = new MockLLM();
    llm.addTextResponse("Hi there!");

    const store = new InMemorySessionStore();
    const sessionManager = new SessionManager(store);
    const agent = buildSessionAgent(llm, sessionManager);

    const result = await agent.run("Hello.");
    expect(result.output).toBe("Hi there!");
  });

  it("should handle session not found gracefully", async () => {
    const llm = new MockLLM();
    llm.addTextResponse("Ok.");

    const store = new InMemorySessionStore();
    const sessionManager = new SessionManager(store);
    const agent = buildSessionAgent(llm, sessionManager);

    // Using a non-existent session should still work (no history loaded)
    const result = await agent.run("Hello.", { sessionId: "nonexistent" });
    expect(result.output).toBe("Ok.");
  });
});
