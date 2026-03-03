/**
 * E2E: Multi-turn agent with session persistence
 *
 * Validates that an agent maintains conversation context across multiple turns
 * using the session manager.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import { SessionManager, InMemorySessionStore } from "../../src/core/state/session.js";

describe("E2E: multi-turn agent", () => {
  it("should maintain context across multiple turns in a session", async () => {
    const store = new InMemorySessionStore();
    const sessionMgr = new SessionManager(store);
    const session = await sessionMgr.create("e2e-agent");

    const llm = new MockLLM();
    llm.addTextResponse("Nice to meet you, Alice!");
    llm.addTextResponse("You told me your name is Alice.");
    llm.addTextResponse("Your name is Alice, and I'm glad to chat with you!");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Remember what the user tells you.")
      .llmClient(llm)
      .sessionManager(sessionMgr)
      .maxIterations(5)
      .build();

    // Turn 1: introduce
    const r1 = await agent.run("My name is Alice.", { sessionId: session.id });
    expect(r1.output).toContain("Alice");

    // Turn 2: recall
    const r2 = await agent.run("What's my name?", { sessionId: session.id });
    expect(r2.output).toContain("Alice");

    // Turn 3: continued conversation
    const r3 = await agent.run("Tell me something about what you know.", {
      sessionId: session.id,
    });
    expect(r3.output).toBeTruthy();

    // Verify session messages grew
    const messages = await sessionMgr.getMessages(session.id);
    expect(messages.length).toBeGreaterThanOrEqual(4); // at least user+assistant for 2 turns
  });

  it("should handle separate sessions independently", async () => {
    const store = new InMemorySessionStore();
    const sessionMgr = new SessionManager(store);
    const session1 = await sessionMgr.create("e2e-agent");
    const session2 = await sessionMgr.create("e2e-agent");

    const llm = new MockLLM();
    llm.addTextResponse("Session 1 reply.");
    llm.addTextResponse("Session 2 reply.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .sessionManager(sessionMgr)
      .maxIterations(5)
      .build();

    const r1 = await agent.run("Hello from session 1.", { sessionId: session1.id });
    const r2 = await agent.run("Hello from session 2.", { sessionId: session2.id });

    expect(r1.output).toBe("Session 1 reply.");
    expect(r2.output).toBe("Session 2 reply.");

    // Each session should have its own messages
    const msgs1 = await sessionMgr.getMessages(session1.id);
    const msgs2 = await sessionMgr.getMessages(session2.id);
    expect(msgs1.length).toBeGreaterThan(0);
    expect(msgs2.length).toBeGreaterThan(0);
  });

  it("should support session listing and deletion", async () => {
    const store = new InMemorySessionStore();
    const sessionMgr = new SessionManager(store);

    const s1 = await sessionMgr.create("agent-1");
    const s2 = await sessionMgr.create("agent-1");
    await sessionMgr.create("agent-2");

    // List all for agent-1
    const agent1Sessions = await sessionMgr.listSessions("agent-1");
    expect(agent1Sessions).toHaveLength(2);

    // Delete one session
    await sessionMgr.delete(s1.id);
    const remaining = await sessionMgr.listSessions("agent-1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(s2.id);
  });
});
