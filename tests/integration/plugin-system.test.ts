/**
 * Integration: Plugin system
 *
 * Verifies that plugins can modify the builder configuration during build().
 */
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/core/agent/agent.js";
import { MockLLM } from "../../src/testing/mock-llm.js";
import type { Plugin } from "../../src/core/extensions/plugins.js";
import { PluginRegistry } from "../../src/core/extensions/plugins.js";
import { calculatorTool } from "../fixtures/tools.js";

describe("plugin system", () => {
  it("should apply a plugin that adds tools to the builder", async () => {
    const mathPlugin: Plugin = {
      name: "math-plugin",
      register(builder) {
        builder.tool(calculatorTool);
      },
    };

    const llm = new MockLLM();
    llm.addToolCallResponse("calculator", { expression: "3+3" });
    llm.addTextResponse("6.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .plugin(mathPlugin)
      .build();

    const toolNames = agent.tools.map((t) => t.name);
    expect(toolNames).toContain("calculator");

    const result = await agent.run("3+3?");
    expect(result.output).toBe("6.");
  });

  it("should apply multiple plugins in order", async () => {
    const order: string[] = [];

    const plugin1: Plugin = {
      name: "plugin-1",
      register() {
        order.push("plugin-1");
      },
    };
    const plugin2: Plugin = {
      name: "plugin-2",
      register() {
        order.push("plugin-2");
      },
    };

    const llm = new MockLLM();
    llm.addTextResponse("Done.");

    Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .plugin(plugin1)
      .plugin(plugin2)
      .build();

    expect(order).toEqual(["plugin-1", "plugin-2"]);
  });

  it("should manage plugins through PluginRegistry", () => {
    const registry = new PluginRegistry();
    const plugin: Plugin = {
      name: "test-plugin",
      register() {},
    };

    registry.register(plugin);
    expect(registry.get("test-plugin")).toBe(plugin);
    expect(registry.list()).toHaveLength(1);

    registry.unregister("test-plugin");
    expect(registry.get("test-plugin")).toBeUndefined();
    expect(registry.list()).toHaveLength(0);
  });

  it("should apply plugin that adds middleware", async () => {
    const mwCalled: string[] = [];
    const loggingPlugin: Plugin = {
      name: "logging-plugin",
      register(builder) {
        builder.addMiddleware({
          name: "plugin-mw",
          async beforeLLMCall(req) {
            mwCalled.push("plugin-mw-called");
            return req;
          },
        });
      },
    };

    const llm = new MockLLM();
    llm.addTextResponse("Ok.");

    const agent = Agent.builder()
      .model("mock-model")
      .systemPrompt("test")
      .llmClient(llm)
      .plugin(loggingPlugin)
      .build();

    await agent.run("Test.");
    expect(mwCalled).toContain("plugin-mw-called");
  });
});
