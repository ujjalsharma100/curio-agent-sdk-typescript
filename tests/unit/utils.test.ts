import { describe, it, expect } from "vitest";
import {
  sleep,
  withTimeout,
  withRetry,
  deferred,
  DedupCache,
  generateId,
  generateShortId,
} from "../../src/utils/index.js";
import { sha256, hashObject } from "../../src/utils/hash.js";

describe("sleep", () => {
  it("should wait approximately the specified time", async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(200);
  });
});

describe("withTimeout", () => {
  it("should resolve if within timeout", async () => {
    const result = await withTimeout(Promise.resolve(42), 1000);
    expect(result).toBe(42);
  });

  it("should reject if timeout exceeded", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 5000));
    await expect(withTimeout(slow, 50, "too slow")).rejects.toThrow("too slow");
  });
});

describe("withRetry", () => {
  it("should succeed on first try", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return "ok";
    }, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("should retry on failure", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw new Error("fail");
      return "ok";
    }, { maxRetries: 5, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("should respect shouldRetry", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new Error("fatal");
      }, {
        maxRetries: 5,
        baseDelayMs: 10,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow("fatal");
    expect(calls).toBe(1);
  });
});

describe("deferred", () => {
  it("should resolve externally", async () => {
    const d = deferred<number>();
    setTimeout(() => d.resolve(42), 10);
    expect(await d.promise).toBe(42);
  });

  it("should reject externally", async () => {
    const d = deferred<number>();
    setTimeout(() => d.reject(new Error("nope")), 10);
    await expect(d.promise).rejects.toThrow("nope");
  });
});

describe("DedupCache", () => {
  it("should cache and retrieve values", () => {
    const cache = new DedupCache<string>(5000);
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
  });

  it("should return undefined for missing keys", () => {
    const cache = new DedupCache<string>();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("should expire entries", async () => {
    const cache = new DedupCache<string>(50);
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
    await sleep(100);
    expect(cache.get("key1")).toBeUndefined();
  });

  it("should clear all entries", () => {
    const cache = new DedupCache<string>();
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });
});

describe("hash utilities", () => {
  it("sha256 produces consistent hashes", () => {
    const h1 = sha256("hello");
    const h2 = sha256("hello");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("sha256 produces different hashes for different input", () => {
    expect(sha256("hello")).not.toBe(sha256("world"));
  });

  it("hashObject produces deterministic hash regardless of key order", () => {
    const h1 = hashObject({ b: 2, a: 1 });
    const h2 = hashObject({ a: 1, b: 2 });
    expect(h1).toBe(h2);
  });
});

describe("ID generation", () => {
  it("generateId returns a UUID", () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("generateShortId returns 12 chars", () => {
    const id = generateShortId();
    expect(id).toHaveLength(12);
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});
