import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentRunResult } from "../models/agent.js";

export class SnapshotMismatchError extends Error {
  readonly snapshotName: string;
  readonly expected: Record<string, unknown>;
  readonly actual: Record<string, unknown>;

  constructor(
    snapshotName: string,
    expected: Record<string, unknown>,
    actual: Record<string, unknown>,
  ) {
    super(`Snapshot mismatch for "${snapshotName}".`);
    this.snapshotName = snapshotName;
    this.expected = expected;
    this.actual = actual;
  }
}

export interface SnapshotTesterOptions {
  snapshotDir?: string;
  update?: boolean;
  ignoreKeys?: string[];
}

export class SnapshotTester {
  private readonly snapshotDir: string;
  private readonly update: boolean;
  private readonly ignoreKeys: Set<string>;

  constructor(options: SnapshotTesterOptions = {}) {
    this.snapshotDir = options.snapshotDir ?? "tests/snapshots";
    this.update = options.update ?? false;
    this.ignoreKeys = new Set(options.ignoreKeys ?? ["runId", "duration"]);
  }

  async assertSnapshot(
    name: string,
    result: AgentRunResult | Record<string, unknown> | string,
    options: { update?: boolean } = {},
  ): Promise<void> {
    const path = this.snapshotPath(name);
    const actual = this.filterKeys(this.normalize(result));
    const shouldUpdate = options.update ?? this.update;

    await mkdir(dirname(path), { recursive: true });

    if (shouldUpdate || !(await exists(path))) {
      await writeFile(path, JSON.stringify(actual, null, 2), "utf8");
      return;
    }

    const expected = this.filterKeys(JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      throw new SnapshotMismatchError(name, expected, actual);
    }
  }

  private snapshotPath(name: string): string {
    const safe = name.replaceAll("/", "_").replaceAll("\\", "_");
    return join(this.snapshotDir, `${safe}.json`);
  }

  private normalize(result: AgentRunResult | Record<string, unknown> | string): Record<string, unknown> {
    if (typeof result === "string") {
      return { output: result };
    }
    if (isAgentRunResult(result)) {
      return {
        output: result.output,
        messages: result.messages,
        toolCalls: result.toolCalls,
        usage: result.usage,
        iterations: result.iterations,
        runId: result.runId,
        duration: result.duration,
        model: result.model,
        metadata: result.metadata,
      };
    }
    return result;
  }

  private filterKeys(input: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (this.ignoreKeys.has(key)) continue;
      out[key] = value;
    }
    return out;
  }
}

function isAgentRunResult(value: unknown): value is AgentRunResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "output" in value &&
    "messages" in value &&
    "usage" in value
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

