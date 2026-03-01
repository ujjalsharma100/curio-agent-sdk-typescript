import { generateShortId } from "../utils/hash.js";

/**
 * A single memory entry stored in any memory backend.
 */
export class MemoryEntry {
  readonly id: string;
  content: string;
  metadata: Record<string, unknown>;
  relevance: number;
  readonly createdAt: Date;
  updatedAt: Date;

  constructor(params?: {
    id?: string;
    content?: string;
    metadata?: Record<string, unknown>;
    relevance?: number;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    this.id = params?.id ?? generateShortId();
    this.content = params?.content ?? "";
    this.metadata = params?.metadata ?? {};
    this.relevance = params?.relevance ?? 0.0;
    this.createdAt = params?.createdAt ?? new Date();
    this.updatedAt = params?.updatedAt ?? new Date();
  }

  toDict(): Record<string, unknown> {
    return {
      id: this.id,
      content: this.content,
      metadata: { ...this.metadata },
      relevance: this.relevance,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  static fromDict(data: Record<string, unknown>): MemoryEntry {
    return new MemoryEntry({
      id: data.id as string | undefined,
      content: data.content as string | undefined,
      metadata: (data.metadata as Record<string, unknown>) ?? {},
      relevance: (data.relevance as number) ?? 0.0,
      createdAt: data.createdAt ? new Date(data.createdAt as string) : undefined,
      updatedAt: data.updatedAt ? new Date(data.updatedAt as string) : undefined,
    });
  }
}

/**
 * Abstract interface for all memory backends.
 */
export interface Memory {
  /**
   * Store content in memory.
   * @returns The ID of the stored entry.
   */
  add(content: string, metadata?: Record<string, unknown>): Promise<string>;

  /**
   * Search memory by relevance to query.
   */
  search(query: string, limit?: number): Promise<MemoryEntry[]>;

  /**
   * Get formatted context string for injection into prompts.
   */
  getContext(query: string, maxTokens?: number): Promise<string>;

  /**
   * Retrieve a specific entry by ID.
   */
  get?(entryId: string): Promise<MemoryEntry | undefined>;

  /**
   * Delete an entry by ID.
   */
  delete?(entryId: string): Promise<boolean>;

  /**
   * Clear all entries.
   */
  clear?(): Promise<void>;

  /**
   * Count total entries.
   */
  count?(): Promise<number>;
}
