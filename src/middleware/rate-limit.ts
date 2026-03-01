/**
 * Client-side rate limiter middleware using a token bucket algorithm.
 *
 * Throttles LLM calls to stay within a configurable rate.
 */

import type { LLMRequest } from "../models/llm.js";
import type { Middleware } from "./base.js";

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export interface RateLimitMiddlewareOptions {
  /** Tokens added per second (calls per second). Default 10. */
  rate?: number;
  /** Maximum tokens in each bucket (burst size). Default 10. */
  burst?: number;
  /** Maintain a separate bucket per agent_id (from request.metadata.agent_id). */
  perAgent?: boolean;
  /** Maintain a separate bucket per user_id (from request.metadata.user_id). */
  perUser?: boolean;
  /** Maintain a separate bucket per request.tier (or metadata tier). */
  perTier?: boolean;
}

/**
 * Client-side token bucket rate limiter. Each LLM call consumes 1 token.
 */
export class RateLimitMiddleware implements Middleware {
  readonly name = "RateLimitMiddleware";
  private readonly rate: number;
  private readonly burst: number;
  private readonly perAgent: boolean;
  private readonly perUser: boolean;
  private readonly perTier: boolean;
  private readonly buckets = new Map<string, TokenBucket>();
  private lock = Promise.resolve<void>(undefined);

  constructor(options: RateLimitMiddlewareOptions = {}) {
    this.rate = options.rate ?? 10;
    this.burst = options.burst ?? 10;
    this.perAgent = options.perAgent ?? false;
    this.perUser = options.perUser ?? false;
    this.perTier = options.perTier ?? false;
  }

  private bucketKey(request: LLMRequest): string {
    const parts: string[] = ["global"];
    const meta = request.metadata ?? {};
    if (this.perAgent) {
      parts.push(`agent:${String(meta.agent_id ?? meta.agentId ?? "unknown-agent")}`);
    }
    if (this.perUser) {
      parts.push(`user:${String(meta.user_id ?? meta.userId ?? "anonymous")}`);
    }
    if (this.perTier) {
      parts.push(`tier:${String((request as { tier?: string }).tier ?? meta.tier ?? "default")}`);
    }
    return parts.join("|");
  }

  private refill(bucket: TokenBucket): void {
    const now = performance.now() / 1000;
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(this.burst, bucket.tokens + elapsed * this.rate);
    bucket.lastRefill = now;
  }

  async beforeLLMCall(request: LLMRequest): Promise<LLMRequest> {
    const key = this.bucketKey(request);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        tokens: this.burst,
        lastRefill: performance.now() / 1000,
      };
      this.buckets.set(key, bucket);
    }

    const prevLock = this.lock;
    let resolveLock!: () => void;
    this.lock = new Promise<void>((r) => {
      resolveLock = r;
    });

    await prevLock;

    this.refill(bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      resolveLock();
      return request;
    }

    const waitTime = (1 - bucket.tokens) / this.rate;
    resolveLock();
    await new Promise((r) => setTimeout(r, waitTime * 1000));

    let resolveLock2!: () => void;
    const nextLock = this.lock;
    this.lock = new Promise<void>((r) => {
      resolveLock2 = r;
    });
    await nextLock;

    bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        tokens: this.burst,
        lastRefill: performance.now() / 1000,
      };
      this.buckets.set(key, bucket);
    }
    this.refill(bucket);
    bucket.tokens = Math.max(0, bucket.tokens - 1);
    resolveLock2();
    return request;
  }
}
