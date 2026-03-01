/**
 * Tiered router — selects models across tiers for cost/quality tradeoffs.
 *
 * Tier 1: Fast, cheap (groq, gpt-4o-mini) — for subagents, simple tasks
 * Tier 2: Balanced (gpt-4o, claude-sonnet) — default
 * Tier 3: High-quality (claude-opus, o1) — complex reasoning
 *
 * Supports automatic failover between tiers and auto-discovery from env vars.
 */

import type { LLMProvider } from "./providers/base.js";
import { parseModelString } from "./providers/base.js";
import { NoAvailableModelError } from "../../models/errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DegradationStrategy = "fallback_to_lower_tier" | "reset_and_retry" | "raise_error";

export interface TierConfig {
  /** Models in this tier, in priority order. Format: "provider:model" */
  models: string[];
}

export interface RouterConfig {
  tier1?: TierConfig;
  tier2?: TierConfig;
  tier3?: TierConfig;
  degradationStrategy?: DegradationStrategy;
}

interface ResolvedModel {
  provider: string;
  modelId: string;
  tier: number;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export class TieredRouter {
  private readonly tiers: Map<number, string[]>;
  private readonly degradationStrategy: DegradationStrategy;

  constructor(config: RouterConfig = {}) {
    this.degradationStrategy = config.degradationStrategy ?? "fallback_to_lower_tier";
    this.tiers = new Map();

    // Load from config or environment
    const tier1 = config.tier1?.models ?? this.parseEnvTier("TIER1_MODELS");
    const tier2 = config.tier2?.models ?? this.parseEnvTier("TIER2_MODELS");
    const tier3 = config.tier3?.models ?? this.parseEnvTier("TIER3_MODELS");

    if (tier1.length > 0) this.tiers.set(1, tier1);
    if (tier2.length > 0) this.tiers.set(2, tier2);
    if (tier3.length > 0) this.tiers.set(3, tier3);
  }

  /**
   * Resolve a model string to a provider + model ID.
   * If the model is a tier reference (e.g., "tier1", "tier2"), picks the first available model in that tier.
   * If it's a direct model string (e.g., "anthropic:claude-sonnet-4-6"), returns it directly.
   */
  resolve(model: string, providers: Map<string, LLMProvider>): ResolvedModel {
    // Check if it's a tier reference
    const tierMatch = model.match(/^tier(\d)$/i);
    if (tierMatch) {
      const tierNum = parseInt(tierMatch[1]!, 10);
      return this.resolveFromTier(tierNum, providers);
    }

    // Direct model string
    const { provider, modelId } = parseModelString(model);

    if (provider) {
      // Explicit provider
      if (!providers.has(provider)) {
        throw new NoAvailableModelError(`Provider "${provider}" not available`, { provider, model: modelId });
      }
      return { provider, modelId, tier: this.findTier(model) };
    }

    // No provider prefix — try to find a provider that supports this model
    for (const [name, prov] of providers) {
      if (prov.supportsModel(modelId)) {
        return { provider: name, modelId, tier: this.findTier(model) };
      }
    }

    throw new NoAvailableModelError(`No provider found for model "${model}"`, { model });
  }

  /**
   * Get a fallback model when the primary model fails.
   * Returns undefined if no fallback is available.
   */
  getFallback(
    failedModel: string,
    failedTier: number,
    providers: Map<string, LLMProvider>,
  ): ResolvedModel | undefined {
    if (this.degradationStrategy === "raise_error") return undefined;

    // Try other models in the same tier first
    const tierModels = this.tiers.get(failedTier) ?? [];
    for (const model of tierModels) {
      if (model === failedModel) continue;
      try {
        return this.resolveModel(model, providers, failedTier);
      } catch {
        continue;
      }
    }

    // Fallback to lower tier
    if (this.degradationStrategy === "fallback_to_lower_tier") {
      for (let tier = failedTier - 1; tier >= 1; tier--) {
        try {
          return this.resolveFromTier(tier, providers);
        } catch {
          continue;
        }
      }
    }

    return undefined;
  }

  /** Get all configured tiers. */
  getTiers(): Map<number, string[]> {
    return new Map(this.tiers);
  }

  /** Check if any tiers are configured. */
  get hasTiers(): boolean {
    return this.tiers.size > 0;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private resolveFromTier(tier: number, providers: Map<string, LLMProvider>): ResolvedModel {
    const models = this.tiers.get(tier);
    if (!models || models.length === 0) {
      throw new NoAvailableModelError(`No models configured for tier ${tier}`);
    }

    for (const model of models) {
      try {
        return this.resolveModel(model, providers, tier);
      } catch {
        continue;
      }
    }

    throw new NoAvailableModelError(`No available providers for any tier ${tier} model`);
  }

  private resolveModel(model: string, providers: Map<string, LLMProvider>, tier: number): ResolvedModel {
    const { provider, modelId } = parseModelString(model);

    if (provider) {
      const prov = providers.get(provider);
      if (!prov) throw new NoAvailableModelError(`Provider "${provider}" not available`);
      return { provider, modelId, tier };
    }

    for (const [name, prov] of providers) {
      if (prov.supportsModel(modelId)) {
        return { provider: name, modelId, tier };
      }
    }

    throw new NoAvailableModelError(`No provider for model "${model}"`);
  }

  private findTier(model: string): number {
    for (const [tier, models] of this.tiers) {
      if (models.includes(model)) return tier;
    }
    return 2; // Default to tier 2
  }

  private parseEnvTier(envVar: string): string[] {
    const value = process.env[envVar];
    if (!value) return [];
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }
}
