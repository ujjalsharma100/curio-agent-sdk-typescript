import type { Memory, MemoryEntry } from "./base.js";

/**
 * Get the importance score from entry metadata, clamped to [0, 1].
 */
export function importanceScore(entry: MemoryEntry, defaultValue = 0.5): number {
  const raw = entry.metadata.importance;
  if (typeof raw === "number") {
    return Math.max(0.0, Math.min(1.0, raw));
  }
  return defaultValue;
}

/**
 * Time-based decay score using exponential half-life.
 * Newer entries score higher.
 */
export function decayScore(
  entry: MemoryEntry,
  options?: { now?: Date; halfLifeDays?: number },
): number {
  const now = options?.now ?? new Date();
  const halfLife = options?.halfLifeDays ?? 30.0;
  const days = (now.getTime() - entry.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp((-days * Math.LN2) / halfLife);
}

/**
 * Weighted combination of base relevance, importance, and time decay.
 * Default weights: 50% base, 30% importance, 20% decay.
 */
export function combinedRelevance(
  baseRelevance: number,
  entry: MemoryEntry,
  options?: {
    importanceWeight?: number;
    decayWeight?: number;
    halfLifeDays?: number;
    now?: Date;
  },
): number {
  const iw = options?.importanceWeight ?? 0.3;
  const dw = options?.decayWeight ?? 0.2;
  const bw = 1.0 - iw - dw;

  const imp = importanceScore(entry);
  const dec = decayScore(entry, {
    now: options?.now,
    halfLifeDays: options?.halfLifeDays,
  });

  return bw * baseRelevance + iw * imp + dw * dec;
}

/**
 * Compress old memories by summarizing and replacing them.
 * Returns count of compressed entries (0 if below threshold).
 */
export async function summarizeOldMemories(
  memory: Memory,
  summarizerFn: (contents: string[]) => Promise<string>,
  options?: {
    maxEntries?: number;
    minEntriesToCompress?: number;
    namespace?: string;
  },
): Promise<number> {
  const maxEntries = options?.maxEntries ?? 100;
  const minToCompress = options?.minEntriesToCompress ?? 20;

  const currentCount = memory.count ? await memory.count() : 0;
  if (currentCount < minToCompress) return 0;

  // Search for all entries (broad query)
  const entries = await memory.search("", currentCount);
  if (entries.length <= maxEntries) return 0;

  // Take the oldest entries beyond maxEntries
  const toCompress = entries.slice(maxEntries);
  const contents = toCompress.map((e) => e.content);

  const summary = await summarizerFn(contents);

  // Delete compressed entries
  let deleted = 0;
  for (const entry of toCompress) {
    if (memory.delete) {
      const ok = await memory.delete(entry.id);
      if (ok) deleted++;
    }
  }

  // Add summary as new entry
  const meta: Record<string, unknown> = {
    type: "summary",
    compressedCount: deleted,
  };
  if (options?.namespace) meta.namespace = options.namespace;
  await memory.add(summary, meta);

  return deleted;
}
