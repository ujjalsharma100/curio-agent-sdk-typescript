/**
 * Cost tracking middleware with budget enforcement.
 *
 * Tracks cumulative cost of LLM calls and raises CostBudgetExceeded
 * when a configured budget is reached. Supports per-model breakdown and threshold alerts.
 */

import type { LLMRequest, LLMResponse } from "../models/llm.js";
import type { Middleware } from "./base.js";
import { CostBudgetExceeded } from "../models/errors.js";

/** Cost per 1M tokens (USD) for common models. */
export const DEFAULT_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10.0, output: 30.0 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "claude-opus-4": { input: 15.0, output: 75.0 },
  "claude-sonnet-4": { input: 3.0, output: 15.0 },
  "claude-haiku-4": { input: 0.8, output: 4.0 },
  "claude-3-5-sonnet": { input: 3.0, output: 15.0 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "openai/gpt-oss-20b": { input: 0.075, output: 0.3 },
  "meta-llama/llama-4-scout-17b-16e-instruct": { input: 0.11, output: 0.34 },
  "moonshotai/kimi-k2-instruct-0905": { input: 1.0, output: 3.0 },
  "qwen/qwen3-32b": { input: 0.29, output: 0.59 },
};

export interface CostTrackerOptions {
  /** Maximum allowed cost in USD. undefined = unlimited. */
  budget?: number;
  /** Custom pricing overrides: model pattern -> { input, output } per 1M tokens. */
  pricing?: Record<string, { input: number; output: number }>;
  /** Budget fraction thresholds that trigger alerts (e.g. [0.5, 0.8, 0.95]). */
  alertThresholds?: number[];
  /** Callback when a threshold is crossed: (threshold, currentCost, budget). */
  onThreshold?: (threshold: number, currentCost: number, budget: number) => void;
}

interface ModelEntry {
  cost: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

/**
 * Tracks LLM call costs and enforces a budget limit.
 * Raises CostBudgetExceeded before an LLM call if the accumulated cost already exceeds the budget.
 */
export class CostTracker implements Middleware {
  readonly name = "CostTracker";
  private readonly budget: number | undefined;
  private readonly pricing: Record<string, { input: number; output: number }>;
  private readonly alertThresholds: number[];
  private readonly onThreshold?: (t: number, c: number, b: number) => void;

  totalCost = 0;
  totalInputTokens = 0;
  totalOutputTokens = 0;
  callCount = 0;
  readonly perModel = new Map<string, ModelEntry>();
  private crossedThresholds = new Set<number>();

  constructor(options: CostTrackerOptions = {}) {
    this.budget = options.budget;
    this.pricing = { ...DEFAULT_PRICING, ...options.pricing };
    this.alertThresholds = [...(options.alertThresholds ?? [])].sort((a, b) => a - b);
    this.onThreshold = options.onThreshold;
  }

  private getPricing(model: string): { input: number; output: number } {
    if (this.pricing[model]) return this.pricing[model];
    for (const [pattern, price] of Object.entries(this.pricing)) {
      if (pattern.includes(model) || model.includes(pattern)) return price;
    }
    return { input: 1.0, output: 3.0 };
  }

  private calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const p = this.getPricing(model);
    const inputCost = (inputTokens / 1_000_000) * p.input;
    const outputCost = (outputTokens / 1_000_000) * p.output;
    return inputCost + outputCost;
  }

  private checkThresholds(): void {
    if (this.budget == null || this.budget <= 0) return;
    const fraction = this.totalCost / this.budget;
    for (const t of this.alertThresholds) {
      if (this.crossedThresholds.has(t)) continue;
      if (fraction >= t) {
        this.crossedThresholds.add(t);
        if (this.onThreshold) {
          try {
            this.onThreshold(t, this.totalCost, this.budget);
          } catch {
            // ignore
          }
        }
      }
    }
  }

  async beforeLLMCall(request: LLMRequest): Promise<LLMRequest> {
    if (this.budget != null && this.totalCost >= this.budget) {
      throw new CostBudgetExceeded("Cost budget exceeded", {
        budget: this.budget,
        actual: this.totalCost,
      });
    }
    return request;
  }

  async afterLLMCall(_request: LLMRequest, response: LLMResponse): Promise<LLMResponse> {
    const inputTokens = response.usage.promptTokens;
    const outputTokens = response.usage.completionTokens;
    const model = response.model;
    const cost = this.calculateCost(model, inputTokens, outputTokens);

    this.totalCost += cost;
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
    this.callCount += 1;

    let entry = this.perModel.get(model);
    if (!entry) {
      entry = { cost: 0, inputTokens: 0, outputTokens: 0, calls: 0 };
      this.perModel.set(model, entry);
    }
    entry.cost += cost;
    entry.inputTokens += inputTokens;
    entry.outputTokens += outputTokens;
    entry.calls += 1;

    this.checkThresholds();
    return response;
  }

  getModelBreakdown(): Record<string, ModelEntry> {
    const out: Record<string, ModelEntry> = {};
    for (const [k, v] of this.perModel) {
      out[k] = { ...v };
    }
    return out;
  }

  getSummary(): {
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    callCount: number;
    budget: number | undefined;
    budgetRemaining: number | undefined;
    perModel: Record<string, ModelEntry>;
  } {
    return {
      totalCost: Math.round(this.totalCost * 1e6) / 1e6,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      callCount: this.callCount,
      budget: this.budget,
      budgetRemaining:
        this.budget != null
          ? Math.round((this.budget - this.totalCost) * 1e6) / 1e6
          : undefined,
      perModel: this.getModelBreakdown(),
    };
  }

  reset(): void {
    this.totalCost = 0;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.callCount = 0;
    this.perModel.clear();
    this.crossedThresholds.clear();
  }
}
