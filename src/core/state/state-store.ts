/**
 * StateStore — unified abstraction for saving/loading agent state.
 *
 * Implementations can store state in memory, files, or databases.
 * Used for persistence and resumption of agent runs.
 */

import type { AgentState } from "./state.js";
import type { CheckpointData } from "./checkpoint.js";
import {
  checkpointFromState,
  stateFromCheckpoint,
  serializeCheckpoint,
  deserializeCheckpoint,
} from "./checkpoint.js";
import type { StateExtensionFactory } from "./state.js";

/** Abstract interface for persisting agent state across runs. */
export interface StateStore {
  /** Save agent state for the run (runId and agentId taken from state). */
  save(state: AgentState): Promise<void>;

  /** Load agent state for a run. Returns null if not found. */
  load(runId: string, options?: StateStoreLoadOptions): Promise<AgentState | null>;

  /** List run IDs, optionally filtered by agentId (most recent first). */
  list(agentId?: string): Promise<string[]>;

  /** Delete state for a run. Returns true if deleted. */
  delete(runId: string): Promise<boolean>;
}

/** Options for state store implementations that need extension factories on load. */
export interface StateStoreLoadOptions {
  /** Optional map of extension key -> factory for restoring state extensions. */
  extensionFactories?: Map<string, StateExtensionFactory>;
}

/**
 * In-memory state store for testing and development.
 * State is lost when the process exits.
 */
export class InMemoryStateStore implements StateStore {
  private readonly storage = new Map<string, { data: CheckpointData }>();

  async save(state: AgentState): Promise<void> {
    const data = checkpointFromState(state);
    this.storage.set(state.runId, { data });
  }

  async load(runId: string, options?: StateStoreLoadOptions): Promise<AgentState | null> {
    const entry = this.storage.get(runId);
    if (!entry) return null;
    return stateFromCheckpoint(entry.data, options?.extensionFactories);
  }

  async list(agentId?: string): Promise<string[]> {
    let entries = Array.from(this.storage.entries());
    if (agentId != null) {
      entries = entries.filter(([, v]) => v.data.agentId === agentId);
    }
    entries.sort(
      (a, b) =>
        new Date(b[1].data.timestamp).getTime() - new Date(a[1].data.timestamp).getTime(),
    );
    return entries.map(([runId]) => runId);
  }

  async delete(runId: string): Promise<boolean> {
    return this.storage.delete(runId);
  }
}

/**
 * File-based state store.
 * Saves state as JSON files in a directory; each run is one file (overwritten on save).
 */
export class FileStateStore implements StateStore {
  private readonly dir: string;
  private readonly extensionFactories?: Map<string, StateExtensionFactory>;

  constructor(
    directory: string,
    options?: { extensionFactories?: Map<string, StateExtensionFactory> },
  ) {
    this.dir = directory;
    this.extensionFactories = options?.extensionFactories;
  }

  private runPath(runId: string): string {
    const safe = runId.replace(/\//g, "_").replace(/\\/g, "_");
    return `${this.dir}/${safe}.json`;
  }

  async save(state: AgentState): Promise<void> {
    const data = checkpointFromState(state);
    const json = serializeCheckpoint(data);
    const path = this.runPath(state.runId);
    const fs = await import("node:fs/promises");
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = `${path}.tmp`;
    await fs.writeFile(tmp, json, "utf8");
    await fs.rename(tmp, path);
  }

  async load(runId: string, options?: StateStoreLoadOptions): Promise<AgentState | null> {
    const path = this.runPath(runId);
    const fs = await import("node:fs/promises");
    try {
      const json = await fs.readFile(path, "utf8");
      const data = deserializeCheckpoint(json);
      const factories = options?.extensionFactories ?? this.extensionFactories;
      return stateFromCheckpoint(data, factories);
    } catch {
      return null;
    }
  }

  async list(agentId?: string): Promise<string[]> {
    const fs = await import("node:fs/promises");
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const runIds: Array<{ runId: string; timestamp: number }> = [];
    for (const name of names) {
      if (!name.endsWith(".json") || name.endsWith(".json.tmp")) continue;
      const path = `${this.dir}/${name}`;
      try {
        const json = await fs.readFile(path, "utf8");
        const data = deserializeCheckpoint(json);
        if (agentId != null && data.agentId !== agentId) continue;
        runIds.push({
          runId: data.runId,
          timestamp: new Date(data.timestamp).getTime(),
        });
      } catch {
        // Skip invalid files
      }
    }
    runIds.sort((a, b) => b.timestamp - a.timestamp);
    return runIds.map((r) => r.runId);
  }

  async delete(runId: string): Promise<boolean> {
    const path = this.runPath(runId);
    const fs = await import("node:fs/promises");
    try {
      await fs.unlink(path);
      return true;
    } catch {
      return false;
    }
  }
}
