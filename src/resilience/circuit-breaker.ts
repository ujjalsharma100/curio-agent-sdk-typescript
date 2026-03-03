export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  recoveryTimeoutMs?: number;
  halfOpenMaxCalls?: number;
  successThreshold?: number;
  onStateChange?: (previous: CircuitState, next: CircuitState) => void;
  shouldCountFailure?: (error: unknown) => boolean;
}

/**
 * Basic circuit breaker implementation:
 * - closed: all calls pass through
 * - open: calls fail fast until recovery timeout elapsed
 * - half_open: limited probe calls to determine if dependency recovered
 */
export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private readonly halfOpenMaxCalls: number;
  private readonly successThreshold: number;
  private readonly onStateChange?: (previous: CircuitState, next: CircuitState) => void;
  private readonly shouldCountFailure: (error: unknown) => boolean;

  private _state: CircuitState = "closed";
  private openedAt = 0;
  private failures = 0;
  private successes = 0;
  private halfOpenCalls = 0;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 5);
    this.recoveryTimeoutMs = Math.max(1, options.recoveryTimeoutMs ?? 30_000);
    this.halfOpenMaxCalls = Math.max(1, options.halfOpenMaxCalls ?? 1);
    this.successThreshold = Math.max(1, options.successThreshold ?? 1);
    this.onStateChange = options.onStateChange;
    this.shouldCountFailure = options.shouldCountFailure ?? (() => true);
  }

  get state(): CircuitState {
    this.maybeEnterHalfOpen();
    return this._state;
  }

  get metrics(): {
    state: CircuitState;
    failures: number;
    successes: number;
    openedAt?: number;
    halfOpenCalls: number;
  } {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      openedAt: this._state === "open" ? this.openedAt : undefined,
      halfOpenCalls: this.halfOpenCalls,
    };
  }

  canExecute(): boolean {
    this.maybeEnterHalfOpen();
    if (this._state === "open") {
      return false;
    }
    if (this._state === "half_open" && this.halfOpenCalls >= this.halfOpenMaxCalls) {
      return false;
    }
    return true;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new Error("Circuit breaker is open");
    }

    if (this._state === "half_open") {
      this.halfOpenCalls += 1;
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  recordSuccess(): void {
    if (this._state === "half_open") {
      this.successes += 1;
      if (this.successes >= this.successThreshold) {
        this.transitionTo("closed");
        this.failures = 0;
        this.successes = 0;
        this.halfOpenCalls = 0;
      }
      return;
    }

    this.failures = 0;
    this.successes = 0;
  }

  recordFailure(error: unknown): void {
    if (!this.shouldCountFailure(error)) {
      return;
    }

    if (this._state === "half_open") {
      this.transitionTo("open");
      this.openedAt = Date.now();
      this.failures = this.failureThreshold;
      this.successes = 0;
      this.halfOpenCalls = 0;
      return;
    }

    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.transitionTo("open");
      this.openedAt = Date.now();
      this.successes = 0;
      this.halfOpenCalls = 0;
    }
  }

  reset(): void {
    this.transitionTo("closed");
    this.openedAt = 0;
    this.failures = 0;
    this.successes = 0;
    this.halfOpenCalls = 0;
  }

  forceOpen(): void {
    this.transitionTo("open");
    this.openedAt = Date.now();
    this.successes = 0;
    this.halfOpenCalls = 0;
  }

  private maybeEnterHalfOpen(): void {
    if (this._state !== "open") {
      return;
    }
    if (Date.now() - this.openedAt >= this.recoveryTimeoutMs) {
      this.transitionTo("half_open");
      this.successes = 0;
      this.halfOpenCalls = 0;
    }
  }

  private transitionTo(next: CircuitState): void {
    const previous = this._state;
    if (previous === next) {
      return;
    }
    this._state = next;
    this.onStateChange?.(previous, next);
  }
}
