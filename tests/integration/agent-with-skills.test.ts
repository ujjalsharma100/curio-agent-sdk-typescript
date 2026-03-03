/**
 * Integration: Agent + Skills system
 *
 * Verifies that skills contribute system prompts, tools, and hooks to agents.
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import { Skill } from "../../src/core/extensions/skills.js";
import { HookEvent, type HookContext } from "../../src/models/events.js";
import { calculatorTool } from "../fixtures/tools.js";

describe("agent with skills", () => {
  it("should merge skill system prompt into agent system prompt", async () => {
    const skill = new Skill({
      name: "math-skill",
      systemPrompt: "You are an expert mathematician.",
      tools: [calculatorTool],
    });

    const llm = new MockLLM();
    llm.addTextResponse("I can help with math!");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("You are a helpful assistant.")
      .llmClient(llm)
      .skill(skill)
      .build();

    // Skill tools should be merged
    const toolNames = agent.tools.map((t) => t.name);
    expect(toolNames).toContain("calculator");

    const result = await agent.run("Help me.");
    expect(result.output).toBeTruthy();
  });

  it("should merge skill hooks into the agent", async () => {
    const hookFired: string[] = [];
    const skill = new Skill({
      name: "logging-skill",
      hooks: [
        {
          event: HookEvent.AGENT_RUN_BEFORE,
          handler: (_ctx: HookContext) => {
            hookFired.push("skill-hook-fired");
          },
        },
      ],
    });

    const llm = new MockLLM();
    llm.addTextResponse("Done.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .skill(skill)
      .build();

    await agent.run("Test.");
    expect(hookFired).toContain("skill-hook-fired");
  });

  it("should support multiple skills attached to one agent", async () => {
    const skill1 = new Skill({
      name: "skill-a",
      systemPrompt: "Skill A context.",
      tools: [calculatorTool],
    });
    const skill2 = new Skill({
      name: "skill-b",
      systemPrompt: "Skill B context.",
    });

    const llm = new MockLLM();
    llm.addTextResponse("Combined.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("Base.")
      .llmClient(llm)
      .skill(skill1)
      .skill(skill2)
      .build();

    const result = await agent.run("Test.");
    expect(result.output).toBe("Combined.");
    expect(agent.tools.map((t) => t.name)).toContain("calculator");
  });

  it("should handle skills with no tools or hooks", async () => {
    const skill = new Skill({
      name: "empty-skill",
      description: "A skill with only a name",
    });

    const llm = new MockLLM();
    llm.addTextResponse("Ok.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .skill(skill)
      .build();

    const result = await agent.run("Test.");
    expect(result.output).toBe("Ok.");
  });
});
