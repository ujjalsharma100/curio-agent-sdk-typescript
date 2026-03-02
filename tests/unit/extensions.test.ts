import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Agent,
  AgentBuilder,
  HookEvent,
  Skill,
  SkillRegistry,
  type SkillHookDefinition,
  PluginRegistry,
  type Plugin,
  createTool,
  type SubagentConfig,
} from "../../src/index.js";

// ---------------------------------------------------------------------------
// Skill & SkillRegistry
// ---------------------------------------------------------------------------

describe("Skill", () => {
  it("constructs with name, prompts, tools and hooks", () => {
    const hooks: SkillHookDefinition[] = [
      { event: HookEvent.AGENT_RUN_BEFORE, handler: () => {}, priority: 10 },
    ];

    const skill = new Skill({
      name: "test-skill",
      description: "A test skill",
      systemPrompt: "You are a test skill.",
      tools: [],
      hooks,
      instructions: "# Instructions",
    });

    expect(skill.name).toBe("test-skill");
    expect(skill.description).toBe("A test skill");
    expect(skill.systemPrompt).toContain("test skill");
    expect(skill.hooks).toHaveLength(1);
    expect(skill.instructions).toContain("Instructions");
  });
});

describe("SkillRegistry", () => {
  it("registers, lists, and retrieves skills", () => {
    const registry = new SkillRegistry();
    const a = new Skill({ name: "a" });
    const b = new Skill({ name: "b" });

    registry.register(a);
    registry.register(b);

    expect(registry.get("a")).toBe(a);
    expect(registry.list().map((s) => s.name).sort()).toEqual(["a", "b"]);
  });

  it("tracks active skills", () => {
    const registry = new SkillRegistry();
    const a = new Skill({ name: "a" });
    const b = new Skill({ name: "b" });
    registry.register(a);
    registry.register(b);

    registry.activate("a");
    expect(registry.isActive("a")).toBe(true);
    expect(registry.isActive("b")).toBe(false);
    expect(registry.getActiveSkills().map((s) => s.name)).toEqual(["a"]);

    registry.deactivate("a");
    expect(registry.isActive("a")).toBe(false);
    expect(registry.getActiveSkills()).toEqual([]);
  });

  it("unregister and clear remove skills", () => {
    const registry = new SkillRegistry();
    const a = new Skill({ name: "a" });
    registry.register(a);
    registry.activate("a");

    registry.unregister("a");
    expect(registry.get("a")).toBeUndefined();
    expect(registry.isActive("a")).toBe(false);

    const b = new Skill({ name: "b" });
    registry.register(b);
    registry.activate("b");
    registry.clear();
    expect(registry.list()).toEqual([]);
    expect(registry.getActiveSkills()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Skill.fromDirectory
// ---------------------------------------------------------------------------

describe("Skill.fromDirectory", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "curio-skill-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads manifest and instructions from directory", async () => {
    const skillDir = join(tmpDir, "my-skill");
    mkdirSync(skillDir);
    const manifestPath = join(skillDir, "skill.yaml");
    const instructionsPath = join(skillDir, "SKILL.md");

    writeFileSync(
      manifestPath,
      [
        "name: my-skill",
        "description: Test skill",
        "system_prompt: You are a filesystem skill.",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(instructionsPath, "# Skill Instructions\n\nUse carefully.", "utf8");

    const skill = await Skill.fromDirectory(skillDir);
    expect(skill.name).toBe("my-skill");
    expect(skill.description).toBe("Test skill");
    expect(skill.systemPrompt).toBe("You are a filesystem skill.");
    expect(skill.instructions).toContain("Skill Instructions");
  });
});

// ---------------------------------------------------------------------------
// PluginRegistry and builder.plugin integration
// ---------------------------------------------------------------------------

describe("PluginRegistry", () => {
  it("registers plugins and applies them to a builder", () => {
    const registry = new PluginRegistry();

    const pluginA: Plugin = {
      name: "plugin-a",
      register(builder: AgentBuilder) {
        builder.metadata("fromPluginA", true);
      },
    };

    const pluginB: Plugin = {
      name: "plugin-b",
      register(builder: AgentBuilder) {
        builder.metadata("fromPluginB", "ok");
      },
    };

    registry.register(pluginA);
    registry.register(pluginB);

    const builder = Agent.builder()
      .model("test-model")
      .systemPrompt("")
      // LLM client will not be used for this test; provide a minimal stub
      .llmClient({
        async call() {
          throw new Error("not used");
        },
        async *stream() {
          throw new Error("not used");
        },
      } as any);

    registry.applyAll(builder);
    const agent = builder.build();
    expect(agent.metadata["fromPluginA"]).toBe(true);
    expect(agent.metadata["fromPluginB"]).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// AgentBuilder.skill and subagents
// ---------------------------------------------------------------------------

describe("AgentBuilder with skills and subagents", () => {
  it("merges skill system prompt, tools, and hooks", async () => {
    const events: string[] = [];
    const testTool = createTool({
      name: "echo",
      description: "Echo text",
      parameters: z.object({ text: z.string() }),
      execute: ({ text }) => String(text),
    });

    const skill = new Skill({
      name: "echo-skill",
      systemPrompt: "You can echo text.",
      tools: [testTool],
      hooks: [
        {
          event: HookEvent.AGENT_RUN_BEFORE,
          handler: () => {
            events.push("skill.before");
          },
        },
      ],
    });

    const llm = {
      async call() {
        // Single-step agent: immediately respond with text, no tools.
        return {
          content: "ok",
          toolCalls: [],
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          model: "test-model",
          finishReason: "stop" as const,
        };
      },
      async *stream() {
        yield { type: "text_delta" as const, text: "ok" };
        yield { type: "done" as const, finishReason: "stop" as const };
      },
    };

    const agent = Agent.builder()
      .model("test-model")
      .systemPrompt("Base prompt.")
      .llmClient(llm as any)
      .skill(skill)
      .build();

    // System prompt should include both base prompt and skill prompt
    const runtime: any = (agent as any).runtime;
    const state = runtime.createState("hi");
    expect(state.messages[0]?.content).toContain("Base prompt.");
    expect(state.messages[0]?.content).toContain("You can echo text.");

    await agent.run("test");
    expect(events).toEqual(["skill.before"]);
  });

  it("spawns and runs a named subagent", async () => {
    const responses = [
      {
        content: "parent",
        toolCalls: [],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        model: "parent-model",
        finishReason: "stop" as const,
      },
      {
        content: "child",
        toolCalls: [],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        model: "child-model",
        finishReason: "stop" as const,
      },
    ];

    let idx = 0;
    const llm = {
      async call() {
        const res = responses[idx];
        if (!res) throw new Error("no more responses");
        idx += 1;
        return res;
      },
      async *stream() {
        const res = responses[idx];
        if (!res) throw new Error("no more responses");
        idx += 1;
        yield { type: "text_delta" as const, text: res.content };
        yield { type: "done" as const, finishReason: res.finishReason };
      },
    };

    const subConfig: SubagentConfig = {
      systemPrompt: "You are a child agent.",
      model: "child-model",
      maxIterations: 5,
    };

    const agent = Agent.builder()
      .model("parent-model")
      .systemPrompt("You are the parent.")
      .llmClient(llm as any)
      .subagent("child", subConfig)
      .build();

    const parentResult = await agent.run("parent input");
    expect(parentResult.output).toBe("parent");

    const childResult = await agent.spawnSubagent("child", "child input");
    expect(childResult.output).toBe("child");
    expect(childResult.model).toBe("child-model");
  });
});

