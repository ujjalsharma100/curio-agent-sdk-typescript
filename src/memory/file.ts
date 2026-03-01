import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { Component } from "../base/component.js";
import type { Memory } from "./base.js";
import { MemoryEntry } from "./base.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("file-memory");

/**
 * Disk-persisted memory. Stores each entry as a JSON file.
 * Directory layout:
 *   baseDir/
 *     _index.json
 *     namespace/
 *       _index.json
 *       entry_1.json
 */
export class FileMemory extends Component implements Memory {
  private readonly _baseDir: string;
  private readonly _namespace?: string;
  private _entriesIndex = new Map<string, string>(); // entryId -> relative path

  constructor(options?: { memoryDir?: string; namespace?: string }) {
    super();
    this._baseDir = options?.memoryDir ?? path.join(os.homedir(), ".agent", "memory");
    this._namespace = options?.namespace;
  }

  /** The effective directory (baseDir or baseDir/namespace). */
  private get _dir(): string {
    return this._namespace ? path.join(this._baseDir, this._namespace) : this._baseDir;
  }

  private get _indexPath(): string {
    return path.join(this._dir, "_index.json");
  }

  // ---------------------------------------------------------------------------
  // Component lifecycle
  // ---------------------------------------------------------------------------

  async startup(): Promise<void> {
    await fs.mkdir(this._dir, { recursive: true });
    await this._loadIndex();
    this.markInitialized();
    logger.debug(`FileMemory started at ${this._dir}`);
  }

  async shutdown(): Promise<void> {
    await this._saveIndex();
    this.markShutdown();
  }

  async healthCheck(): Promise<boolean> {
    try {
      await fs.access(this._dir);
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Memory interface
  // ---------------------------------------------------------------------------

  async add(content: string, metadata?: Record<string, unknown>): Promise<string> {
    const entry = new MemoryEntry({ content, metadata });
    const filename = `${entry.id}.json`;
    const filePath = path.join(this._dir, filename);

    await fs.writeFile(
      filePath,
      JSON.stringify({ id: entry.id, content: entry.content, metadata: entry.metadata }),
      "utf-8",
    );

    this._entriesIndex.set(entry.id, filename);
    await this._saveIndex();
    return entry.id;
  }

  async search(query: string, limit = 5): Promise<MemoryEntry[]> {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const entries = await this._readAllEntries();
    if (entries.length === 0) return [];

    const scored = entries.map((entry) => {
      const contentLower = entry.content.toLowerCase();
      const hits = queryTerms.filter((t) => contentLower.includes(t)).length;
      const relevance = queryTerms.length > 0 ? hits / queryTerms.length : 0;
      return { entry: new MemoryEntry({ ...entry, relevance }), relevance };
    });

    scored.sort((a, b) => b.relevance - a.relevance);
    return scored
      .filter((s) => s.relevance > 0)
      .slice(0, limit)
      .map((s) => s.entry);
  }

  async getContext(query: string, maxTokens = 2000): Promise<string> {
    const results = await this.search(query, 20);
    if (results.length === 0) {
      // If no search hits, include all files that fit
      const all = await this._readAllEntries();
      if (all.length === 0) return "";
      const lines: string[] = ["[File Memory]"];
      let charBudget = maxTokens * 4;
      for (const entry of all) {
        const line = `- ${entry.content}`;
        if (charBudget - line.length < 0) break;
        charBudget -= line.length;
        lines.push(line);
      }
      return lines.join("\n");
    }

    const lines: string[] = ["[File Memory]"];
    let charBudget = maxTokens * 4;
    for (const entry of results) {
      const line = `- ${entry.content}`;
      if (charBudget - line.length < 0) break;
      charBudget -= line.length;
      lines.push(line);
    }
    return lines.join("\n");
  }

  async get(entryId: string): Promise<MemoryEntry | undefined> {
    const filename = this._entriesIndex.get(entryId);
    if (!filename) return undefined;
    try {
      const raw = await fs.readFile(path.join(this._dir, filename), "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      return MemoryEntry.fromDict(data);
    } catch {
      return undefined;
    }
  }

  async delete(entryId: string): Promise<boolean> {
    const filename = this._entriesIndex.get(entryId);
    if (!filename) return false;
    try {
      await fs.unlink(path.join(this._dir, filename));
    } catch {
      // file may already be gone
    }
    this._entriesIndex.delete(entryId);
    await this._saveIndex();
    return true;
  }

  async clear(): Promise<void> {
    for (const filename of this._entriesIndex.values()) {
      try {
        await fs.unlink(path.join(this._dir, filename));
      } catch {
        // ignore
      }
    }
    this._entriesIndex.clear();
    await this._saveIndex();
  }

  async count(): Promise<number> {
    return this._entriesIndex.size;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async _loadIndex(): Promise<void> {
    try {
      const raw = await fs.readFile(this._indexPath, "utf-8");
      const data = JSON.parse(raw) as Record<string, string>;
      this._entriesIndex = new Map(Object.entries(data));
      logger.debug(`Loaded index with ${this._entriesIndex.size} entries`);
    } catch {
      this._entriesIndex = new Map();
    }
  }

  private async _saveIndex(): Promise<void> {
    const obj: Record<string, string> = {};
    for (const [k, v] of this._entriesIndex) obj[k] = v;
    await fs.writeFile(this._indexPath, JSON.stringify(obj), "utf-8");
  }

  private async _readAllEntries(): Promise<MemoryEntry[]> {
    const entries: MemoryEntry[] = [];
    let files: string[];
    try {
      files = await fs.readdir(this._dir);
    } catch {
      return [];
    }

    for (const file of files) {
      if (!file.endsWith(".json") || file.startsWith("_")) continue;
      try {
        const raw = await fs.readFile(path.join(this._dir, file), "utf-8");
        const data = JSON.parse(raw) as Record<string, unknown>;
        entries.push(MemoryEntry.fromDict(data));
      } catch {
        // skip corrupt files
      }
    }
    return entries;
  }
}
