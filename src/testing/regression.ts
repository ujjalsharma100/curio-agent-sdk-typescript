import { readFile, writeFile } from "node:fs/promises";
import { EvalSuiteResult } from "./eval.js";

export interface RegressionReport {
  baselinePassRate: number;
  candidatePassRate: number;
  metricDeltas: Record<string, number>;
  threshold: number;
  passed: boolean;
  details: string[];
}

export class RegressionDetector {
  private readonly threshold: number;

  constructor(threshold = 0.05) {
    this.threshold = threshold;
  }

  async saveBaseline(results: EvalSuiteResult, path: string): Promise<void> {
    await writeFile(path, results.toJSON(), "utf8");
  }

  async loadBaseline(path: string): Promise<EvalSuiteResult> {
    const raw = await readFile(path, "utf8");
    return EvalSuiteResult.fromJSON(raw);
  }

  async compare(options: {
    candidate: EvalSuiteResult;
    baseline?: EvalSuiteResult;
    baselinePath?: string;
  }): Promise<RegressionReport> {
    const baseline = options.baseline ?? (options.baselinePath ? await this.loadBaseline(options.baselinePath) : undefined);
    if (!baseline) {
      throw new Error("Either baseline or baselinePath must be provided.");
    }

    const metricNames = new Set<string>();
    baseline.results.forEach((result) => Object.keys(result.metrics).forEach((name) => metricNames.add(name)));
    options.candidate.results.forEach((result) =>
      Object.keys(result.metrics).forEach((name) => metricNames.add(name)),
    );

    const metricDeltas: Record<string, number> = {};
    const details: string[] = [];
    let passed = true;

    for (const metric of [...metricNames].sort()) {
      const delta = options.candidate.avgMetric(metric) - baseline.avgMetric(metric);
      metricDeltas[metric] = Number(delta.toFixed(6));
      if (delta < -this.threshold) {
        passed = false;
        details.push(
          `Regression in "${metric}": baseline=${baseline.avgMetric(metric).toFixed(4)} ` +
            `candidate=${options.candidate.avgMetric(metric).toFixed(4)} delta=${delta.toFixed(4)}`,
        );
      }
    }

    const passRateDelta = options.candidate.passRate() - baseline.passRate();
    if (passRateDelta < -this.threshold) {
      passed = false;
      details.push(
        `Regression in pass rate: baseline=${baseline.passRate().toFixed(4)} ` +
          `candidate=${options.candidate.passRate().toFixed(4)} delta=${passRateDelta.toFixed(4)}`,
      );
    }

    return {
      baselinePassRate: baseline.passRate(),
      candidatePassRate: options.candidate.passRate(),
      metricDeltas,
      threshold: this.threshold,
      passed,
      details,
    };
  }
}

