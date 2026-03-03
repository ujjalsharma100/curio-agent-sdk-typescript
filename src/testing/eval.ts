import { readFile } from "node:fs/promises";
import type { Agent } from "../core/agent/agent.js";
import type { AgentRunResult } from "../models/agent.js";

export interface EvalCase {
  input: string;
  expectedOutput?: string;
  expectedToolCalls?: string[];
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface EvalResult {
  case: EvalCase;
  output: string;
  toolCalls: string[];
  metrics: Record<string, number>;
  passed: boolean;
  error?: string;
  tokens: number;
  latencyMs: number;
}

export class EvalSuiteResult {
  readonly results: EvalResult[];
  readonly metadata: Record<string, unknown>;

  constructor(results: EvalResult[], metadata: Record<string, unknown> = {}) {
    this.results = results;
    this.metadata = metadata;
  }

  passRate(): number {
    if (this.results.length === 0) return 0;
    return this.results.filter((result) => result.passed).length / this.results.length;
  }

  avgMetric(name: string): number {
    const values = this.results
      .map((result) => result.metrics[name])
      .filter((value): value is number => typeof value === "number");
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  toJSON(): string {
    return JSON.stringify(
      {
        results: this.results,
        metadata: this.metadata,
        passRate: this.passRate(),
      },
      null,
      2,
    );
  }

  static fromJSON(raw: string): EvalSuiteResult {
    const parsed = JSON.parse(raw) as { results?: EvalResult[]; metadata?: Record<string, unknown> };
    return new EvalSuiteResult(parsed.results ?? [], parsed.metadata ?? {});
  }
}

export class EvalDataset {
  readonly cases: EvalCase[];

  constructor(cases: EvalCase[]) {
    this.cases = cases;
  }

  filterByTag(tag: string): EvalDataset {
    return new EvalDataset(this.cases.filter((c) => c.tags?.includes(tag)));
  }

  static async fromJson(path: string): Promise<EvalDataset> {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as EvalCase[] | { cases?: EvalCase[]; data?: EvalCase[] };
    if (Array.isArray(parsed)) return new EvalDataset(parsed);
    return new EvalDataset(parsed.cases ?? parsed.data ?? []);
  }

  static async fromJsonl(path: string): Promise<EvalDataset> {
    const raw = await readFile(path, "utf8");
    const cases = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EvalCase);
    return new EvalDataset(cases);
  }
}

export type EvalMetric = (testCase: EvalCase, output: string, toolCalls: string[]) => number;

export function exactMatch(testCase: EvalCase, output: string): number {
  return output.trim() === (testCase.expectedOutput ?? "").trim() ? 1 : 0;
}

export function containsMatch(testCase: EvalCase, output: string): number {
  if (!testCase.expectedOutput) return 1;
  return output.includes(testCase.expectedOutput) ? 1 : 0;
}

export function toolCallMatch(testCase: EvalCase, _output: string, toolCalls: string[]): number {
  const expected = testCase.expectedToolCalls ?? [];
  if (expected.length === 0) return 1;
  const matches = expected.filter((name) => toolCalls.includes(name)).length;
  return matches / expected.length;
}

export function tokenEfficiency(testCase: EvalCase, output: string): number {
  return testCase.input.length === 0 ? 0 : output.length / testCase.input.length;
}

export class AgentEvalSuite {
  private readonly metrics: EvalMetric[];
  private readonly passThreshold: number;

  constructor(options: { metrics?: EvalMetric[]; passThreshold?: number } = {}) {
    this.metrics = options.metrics ?? [containsMatch];
    this.passThreshold = options.passThreshold ?? 0.5;
  }

  async run(
    agent: Agent,
    dataset: EvalDataset,
    runOptions?: Parameters<Agent["run"]>[1],
  ): Promise<EvalSuiteResult> {
    const results: EvalResult[] = [];

    for (const testCase of dataset.cases) {
      const start = Date.now();
      try {
        const runResult = await agent.run(testCase.input, runOptions);
        const evalResult = this.evalOne(testCase, runResult, Date.now() - start);
        results.push(evalResult);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          case: testCase,
          output: "",
          toolCalls: [],
          metrics: {},
          passed: false,
          error: message,
          tokens: 0,
          latencyMs: Date.now() - start,
        });
      }
    }

    return new EvalSuiteResult(results);
  }

  async runAB(
    agentA: Agent,
    agentB: Agent,
    dataset: EvalDataset,
    runOptions?: Parameters<Agent["run"]>[1],
  ): Promise<{ a: EvalSuiteResult; b: EvalSuiteResult }> {
    const [a, b] = await Promise.all([
      this.run(agentA, dataset, runOptions),
      this.run(agentB, dataset, runOptions),
    ]);
    return { a, b };
  }

  private evalOne(testCase: EvalCase, runResult: AgentRunResult, latencyMs: number): EvalResult {
    const output = runResult.output ?? "";
    const toolCalls = runResult.toolCalls.map((call) => call.toolName);
    const metrics: Record<string, number> = {};

    for (const metric of this.metrics) {
      metrics[metric.name] = metric(testCase, output, toolCalls);
    }

    const avg =
      Object.values(metrics).length > 0
        ? Object.values(metrics).reduce((sum, value) => sum + value, 0) / Object.values(metrics).length
        : 0;

    return {
      case: testCase,
      output,
      toolCalls,
      metrics,
      passed: avg >= this.passThreshold,
      tokens: runResult.usage.totalTokens,
      latencyMs,
    };
  }
}

