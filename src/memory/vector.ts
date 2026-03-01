import { Component } from "../base/component.js";
import type { Memory } from "./base.js";
import { MemoryEntry } from "./base.js";
import { createLogger } from "../utils/logger.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const logger = createLogger("vector-memory");

export type EmbeddingFn = (texts: string[]) => Promise<number[][]>;

/**
 * Semantic memory using embeddings and cosine similarity.
 * Supports optional disk persistence and custom embedding functions.
 */
export class VectorMemory extends Component implements Memory {
  private readonly embeddingFn: EmbeddingFn;
  private readonly embeddingModel: string;
  private readonly persistPath?: string;

  private _entries: MemoryEntry[] = [];
  private _vectors: number[][] = [];
  private _index = new Map<string, number>();

  constructor(options?: {
    embeddingFn?: EmbeddingFn;
    embeddingModel?: string;
    persistPath?: string;
  }) {
    super();
    this.embeddingModel = options?.embeddingModel ?? "text-embedding-3-small";
    this.embeddingFn = options?.embeddingFn ?? this._defaultEmbeddingFn.bind(this);
    this.persistPath = options?.persistPath;
  }

  // ---------------------------------------------------------------------------
  // Component lifecycle
  // ---------------------------------------------------------------------------

  async startup(): Promise<void> {
    if (this.persistPath) {
      await this._loadFromDisk();
    }
    this.markInitialized();
  }

  async shutdown(): Promise<void> {
    if (this.persistPath) {
      await this._saveToDisk();
    }
    this.markShutdown();
  }

  // ---------------------------------------------------------------------------
  // Memory interface
  // ---------------------------------------------------------------------------

  async add(content: string, metadata?: Record<string, unknown>): Promise<string> {
    const entry = new MemoryEntry({ content, metadata });
    const [vector] = await this.embeddingFn([content]);
    if (!vector) throw new Error("Embedding function returned empty result");

    this._index.set(entry.id, this._entries.length);
    this._entries.push(entry);
    this._vectors.push(vector);
    return entry.id;
  }

  async addBatch(items: Array<{ content: string; metadata?: Record<string, unknown> }>): Promise<string[]> {
    const entries = items.map((item) => new MemoryEntry({ content: item.content, metadata: item.metadata }));
    const texts = entries.map((e) => e.content);
    const vectors = await this.embeddingFn(texts);

    const ids: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const vector = vectors[i]!;
      this._index.set(entry.id, this._entries.length);
      this._entries.push(entry);
      this._vectors.push(vector);
      ids.push(entry.id);
    }
    return ids;
  }

  async search(query: string, limit = 5): Promise<MemoryEntry[]> {
    if (this._entries.length === 0) return [];

    const [queryVec] = await this.embeddingFn([query]);
    if (!queryVec) return [];

    const scored = this._entries.map((entry, idx) => {
      const similarity = cosineSimilarity(queryVec, this._vectors[idx]!);
      return { entry, similarity };
    });

    scored.sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, limit).map(({ entry, similarity }) => {
      return new MemoryEntry({
        ...entry,
        metadata: { ...entry.metadata },
        relevance: similarity,
      });
    });
  }

  async getContext(query: string, maxTokens = 2000): Promise<string> {
    const results = await this.search(query, 20);
    if (results.length === 0) return "";

    const lines: string[] = ["[Relevant Memories]"];
    let charBudget = maxTokens * 4;
    for (const entry of results) {
      const line = `- ${entry.content} (relevance: ${entry.relevance.toFixed(2)})`;
      if (charBudget - line.length < 0) break;
      charBudget -= line.length;
      lines.push(line);
    }
    return lines.join("\n");
  }

  async get(entryId: string): Promise<MemoryEntry | undefined> {
    const idx = this._index.get(entryId);
    return idx !== undefined ? this._entries[idx] : undefined;
  }

  async delete(entryId: string): Promise<boolean> {
    const idx = this._index.get(entryId);
    if (idx === undefined) return false;

    this._entries.splice(idx, 1);
    this._vectors.splice(idx, 1);
    this._rebuildIndex();
    return true;
  }

  async clear(): Promise<void> {
    this._entries = [];
    this._vectors = [];
    this._index.clear();
  }

  async count(): Promise<number> {
    return this._entries.length;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private _rebuildIndex(): void {
    this._index.clear();
    for (let i = 0; i < this._entries.length; i++) {
      this._index.set(this._entries[i]!.id, i);
    }
  }

  private async _defaultEmbeddingFn(texts: string[]): Promise<number[][]> {
    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI();
      const resp = await client.embeddings.create({
        model: this.embeddingModel,
        input: texts,
      });
      return resp.data.map((d: { embedding: number[] }) => d.embedding);
    } catch {
      logger.warn("OpenAI SDK not available, falling back to simple hash embedding");
      return texts.map((t) => simpleHashEmbedding(t));
    }
  }

  private async _loadFromDisk(): Promise<void> {
    if (!this.persistPath) return;
    try {
      const raw = await fs.readFile(this.persistPath, "utf-8");
      const data = JSON.parse(raw) as {
        entries: Array<Record<string, unknown>>;
        vectors: number[][];
      };
      this._entries = data.entries.map((e) => MemoryEntry.fromDict(e));
      this._vectors = data.vectors;
      this._rebuildIndex();
      logger.debug(`Loaded ${this._entries.length} entries from ${this.persistPath}`);
    } catch {
      logger.debug(`No existing data at ${this.persistPath}, starting fresh`);
    }
  }

  private async _saveToDisk(): Promise<void> {
    if (!this.persistPath) return;
    const dir = path.dirname(this.persistPath);
    await fs.mkdir(dir, { recursive: true });
    const data = {
      entries: this._entries.map((e) => e.toDict()),
      vectors: this._vectors,
    };
    await fs.writeFile(this.persistPath, JSON.stringify(data), "utf-8");
    logger.debug(`Saved ${this._entries.length} entries to ${this.persistPath}`);
  }
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Simple deterministic hash-based embedding as fallback (not semantic). */
function simpleHashEmbedding(text: string, dims = 128): number[] {
  const vec = new Array<number>(dims).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % dims]! += text.charCodeAt(i) / 256;
  }
  // Normalize
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dims; i++) vec[i] = vec[i]! / norm;
  }
  return vec;
}
