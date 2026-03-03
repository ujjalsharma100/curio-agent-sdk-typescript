/**
 * Integration: LLM tiered routing
 *
 * Verifies that the TieredRouter selects and falls back between model tiers.
 */
import { describe, it, expect } from "vitest";
import { TieredRouter } from "../../src/core/llm/router.js";
import type { LLMProvider } from "../../src/core/llm/providers/base.js";

/** Minimal mock provider for routing tests. */
function mockProvider(name: string, models: string[]): [string, LLMProvider] {
  return [
    name,
    {
      name,
      supportedModels: models,
      supportsModel(m: string) {
        return models.includes(m);
      },
      async call() {
        throw new Error("Not implemented");
      },
      async *stream() {
        throw new Error("Not implemented");
      },
    } as unknown as LLMProvider,
  ];
}

describe("LLM routing", () => {
  it("should create a router with tier configuration", () => {
    const router = new TieredRouter({
      tier1: { models: ["openai:gpt-4o-mini"] },
      tier2: { models: ["openai:gpt-4o"] },
      tier3: { models: ["anthropic:claude-opus-4"] },
    });
    expect(router).toBeDefined();
    expect(router.hasTiers).toBe(true);
  });

  it("should resolve a direct model string", () => {
    const router = new TieredRouter({
      tier2: { models: ["openai:gpt-4o"] },
    });
    const providers = new Map([mockProvider("openai", ["gpt-4o"])]);

    const resolved = router.resolve("openai:gpt-4o", providers);
    expect(resolved.provider).toBe("openai");
    expect(resolved.modelId).toBe("gpt-4o");
  });

  it("should resolve a tier reference", () => {
    const router = new TieredRouter({
      tier1: { models: ["openai:gpt-4o-mini"] },
    });
    const providers = new Map([mockProvider("openai", ["gpt-4o-mini"])]);

    const resolved = router.resolve("tier1", providers);
    expect(resolved.provider).toBe("openai");
    expect(resolved.modelId).toBe("gpt-4o-mini");
    expect(resolved.tier).toBe(1);
  });

  it("should throw when no provider available for model", () => {
    const router = new TieredRouter({});
    const providers = new Map<string, LLMProvider>();

    expect(() => router.resolve("openai:gpt-4o", providers)).toThrow();
  });

  it("should get fallback model from lower tier", () => {
    const router = new TieredRouter({
      tier1: { models: ["openai:gpt-4o-mini"] },
      tier2: { models: ["openai:gpt-4o"] },
      degradationStrategy: "fallback_to_lower_tier",
    });
    const providers = new Map([
      mockProvider("openai", ["gpt-4o-mini", "gpt-4o"]),
    ]);

    const fallback = router.getFallback("openai:gpt-4o", 2, providers);
    expect(fallback).toBeDefined();
    expect(fallback!.tier).toBe(1);
  });

  it("should return undefined fallback with raise_error strategy", () => {
    const router = new TieredRouter({
      tier1: { models: ["openai:gpt-4o-mini"] },
      degradationStrategy: "raise_error",
    });
    const providers = new Map([mockProvider("openai", ["gpt-4o-mini"])]);

    const fallback = router.getFallback("openai:gpt-4o-mini", 1, providers);
    expect(fallback).toBeUndefined();
  });

  it("should report configured tiers", () => {
    const router = new TieredRouter({
      tier1: { models: ["a:a"] },
      tier2: { models: ["b:b", "c:c"] },
    });

    const tiers = router.getTiers();
    expect(tiers.size).toBe(2);
    expect(tiers.get(1)).toEqual(["a:a"]);
    expect(tiers.get(2)).toEqual(["b:b", "c:c"]);
  });
});
