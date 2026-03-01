/**
 * Token counter — estimates token counts for messages and tools.
 *
 * Uses `gpt-tokenizer` for accurate OpenAI model counting.
 * Falls back to character-based estimation for other providers.
 * Results are cached for performance.
 */

import type { Message, ToolSchema } from "../../models/llm.js";
import { getMessageText } from "../../models/llm.js";

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const tokenCache = new Map<string, number>();
const MAX_CACHE_SIZE = 1000;

function getCached(key: string): number | undefined {
  return tokenCache.get(key);
}

function setCache(key: string, count: number): void {
  if (tokenCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entries (FIFO)
    const firstKey = tokenCache.keys().next().value;
    if (firstKey !== undefined) tokenCache.delete(firstKey);
  }
  tokenCache.set(key, count);
}

// ---------------------------------------------------------------------------
// Estimation
// ---------------------------------------------------------------------------

/** Characters per token ratio for estimation. */
const CHARS_PER_TOKEN = 4;
/** Overhead tokens per message (role, formatting). */
const MESSAGE_OVERHEAD = 4;
/** Overhead tokens per tool schema. */
const TOOL_OVERHEAD = 20;

/** Estimate tokens from a string using character ratio. */
function estimateFromString(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let gptTokenizer: { encode: (text: string) => number[] } | null | undefined;

async function loadTokenizer(): Promise<{ encode: (text: string) => number[] } | null> {
  if (gptTokenizer !== undefined) return gptTokenizer;
  try {
    const mod = await import("gpt-tokenizer");
    gptTokenizer = mod;
    return gptTokenizer;
  } catch {
    gptTokenizer = null;
    return null;
  }
}

/**
 * Count tokens for a text string.
 * Uses accurate tokenizer for OpenAI models, estimation for others.
 */
export async function countStringTokens(text: string, model?: string): Promise<number> {
  const cacheKey = `str:${model ?? ""}:${text.slice(0, 200)}:${text.length}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;

  const isOpenAI = !model || model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3");
  let count: number;

  if (isOpenAI) {
    const tokenizer = await loadTokenizer();
    if (tokenizer) {
      count = tokenizer.encode(text).length;
    } else {
      count = estimateFromString(text);
    }
  } else {
    count = estimateFromString(text);
  }

  setCache(cacheKey, count);
  return count;
}

/**
 * Count tokens for a list of messages.
 * Accounts for message formatting overhead.
 */
export async function countMessageTokens(
  messages: Message[],
  model?: string,
  tools?: ToolSchema[],
): Promise<number> {
  let total = 0;

  for (const msg of messages) {
    const text = getMessageText(msg);
    total += await countStringTokens(text, model);
    total += MESSAGE_OVERHEAD; // Role, delimiters
  }

  // Tool schemas
  if (tools) {
    for (const tool of tools) {
      const schemaStr = JSON.stringify(tool);
      total += await countStringTokens(schemaStr, model);
      total += TOOL_OVERHEAD; // Tool formatting overhead
    }
  }

  // Base overhead (priming)
  total += 3;

  return total;
}

/** Clear the token counting cache. */
export function clearTokenCache(): void {
  tokenCache.clear();
}
