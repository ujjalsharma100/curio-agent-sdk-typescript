/**
 * Integration: AgentBuilder full-stack wiring
 *
 * Verifies the complete builder API with all features wired together.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import { ConversationMemory } from "../../src/memory/conversation.js";
import { MemoryManager } from "../../src/memory/manager.js";
import { SessionManager, InMemorySessionStore } from "../../src/core/state/session.js";
import { AllowAll } from "../../src/core/security/permissions.js";
import { Skill } from "../../src/core/extensions/skills.js";
import { HookEvent } from "../../src/models/events.js";
import type { Middleware } from "../../src/middleware/base.js";
import { calculatorTool, searchTool } from "../fixtures/tools.js";

describe("agent builder full-stack", () => {
  it("should build an agent with all features wired together", async () => {
    const hookFired: string[] = [];
    const mwCalled: string[] = [];

    const loggingMw: Middleware = {
      name: "test-logging",
      async beforeLLMCall(req) {
        mwCalled.push("before-llm");
        return req;
      },
    };

    const skill = new Skill({
      name: "search-skill",
      systemPrompt: "You can search.",
      tools: [searchTool],
    });

    const memory = new MemoryManager({ memory: new ConversationMemory() });
    const sessions = new SessionManager(new InMemorySessionStore());

    const llm = new MockLLM();
    llm.addToolCallResponse("calculator", { expression: "100/4" });
    llm.addTextResponse("25.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Full-stack agent.")
      .llmClient(llm)
      .tool(calculatorTool)
      .skill(skill)
      .middleware([loggingMw])
      .memoryManager(memory)
      .sessionManager(sessions)
      .permissions(new AllowAll())
      .hook(HookEvent.AGENT_RUN_BEFORE, () => {
        hookFired.push("run-before");
      })
      .agentName("full-stack-agent")
      .maxIterations(20)
      .timeout(30000)
      .metadata("env", "test")
      .subagent("helper", { systemPrompt: "I help." })
      .build();

    const result = await agent.run("What is 100/4?");

    // Basic assertions
    expect(result.output).toBe("25.");
    expect(result.toolCalls).toHaveLength(1);
    expect(agent.agentName).toBe("full-stack-agent");
    expect(agent.metadata.env).toBe("test");

    // Tools from both direct registration and skill
    const toolNames = agent.tools.map((t) => t.name);
    expect(toolNames).toContain("calculator");
    expect(toolNames).toContain("search");
    // Memory tools
    expect(toolNames).toContain("save_to_memory");

    // Hooks fired
    expect(hookFired).toContain("run-before");

    // Middleware ran
    expect(mwCalled).toContain("before-llm");

    // Subagent registered
    expect(agent.subagents.has("helper")).toBe(true);
  });

  it("should throw when building without an LLM client", () => {
    expect(() => {
      Agent.builder()
        .model("mock-model")
        .systemPrompt("test")
        .build();
    }).toThrow("LLM client is required");
  });

  it("should support agent ID and name customization", async () => {
    const llm = new MockLLM();
    llm.addTextResponse("Hi.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .agentId("custom-id-123")
      .agentName("custom-agent")
      .build();

    expect(agent.agentId).toBe("custom-id-123");
    expect(agent.agentName).toBe("custom-agent");
  });
});
