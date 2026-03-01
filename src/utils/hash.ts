/**
 * Hashing utilities for deduplication, caching, and ID generation.
 */

import { createHash, randomUUID } from "crypto";

/** Generate a SHA-256 hex digest of the input string. */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Generate a deterministic hash for an object (JSON-serialized, sorted keys). */
export function hashObject(obj: unknown): string {
  return sha256(JSON.stringify(obj, Object.keys(obj as object).sort()));
}

/** Generate a new UUID v4. */
export function generateId(): string {
  return randomUUID();
}

/** Generate a short ID (first 12 chars of a UUID, no dashes). */
export function generateShortId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}
