/**
 * Error hierarchy for the Curio Agent SDK.
 *
 * Mirrors the Python SDK's exception hierarchy. All SDK errors extend CurioError.
 * Consumers can catch CurioError to handle all SDK-specific errors, or catch
 * specific subclasses for fine-grained handling.
 */

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

/** Root error class for all Curio Agent SDK errors. */
export class CurioError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = this.constructor.name;
  }
}

// ---------------------------------------------------------------------------
// LLM errors
// ---------------------------------------------------------------------------

/** Base class for all LLM-related errors. */
export class LLMError extends CurioError {
  /** The provider that produced the error (e.g., "openai", "anthropic"). */
  readonly provider?: string;
  /** The model that was requested. */
  readonly model?: string;

  constructor(
    message: string,
    options?: ErrorOptions & { provider?: string; model?: string },
  ) {
    super(message, options);
    this.provider = options?.provider;
    this.model = options?.model;
  }
}

/** Rate limit exceeded. Contains retry-after hint if available. */
export class LLMRateLimitError extends LLMError {
  /** Seconds to wait before retrying, if the provider indicated one. */
  readonly retryAfter?: number;

  constructor(
    message: string,
    options?: ErrorOptions & { provider?: string; model?: string; retryAfter?: number },
  ) {
    super(message, options);
    this.retryAfter = options?.retryAfter;
  }
}

/** Authentication failure (invalid or missing API key). */
export class LLMAuthenticationError extends LLMError {}

/** Provider-side error (5xx, network issues, etc.). */
export class LLMProviderError extends LLMError {
  /** HTTP status code if available. */
  readonly statusCode?: number;

  constructor(
    message: string,
    options?: ErrorOptions & { provider?: string; model?: string; statusCode?: number },
  ) {
    super(message, options);
    this.statusCode = options?.statusCode;
  }
}

/** LLM call timed out. */
export class LLMTimeoutError extends LLMError {
  /** The timeout value that was exceeded (ms). */
  readonly timeoutMs?: number;

  constructor(
    message: string,
    options?: ErrorOptions & { provider?: string; model?: string; timeoutMs?: number },
  ) {
    super(message, options);
    this.timeoutMs = options?.timeoutMs;
  }
}

/** No models available after exhausting all tiers and fallbacks. */
export class NoAvailableModelError extends LLMError {}

/** The configured cost budget has been exceeded. */
export class CostBudgetExceeded extends LLMError {
  /** The budget limit that was exceeded (USD). */
  readonly budget?: number;
  /** The actual cost incurred so far (USD). */
  readonly actual?: number;

  constructor(
    message: string,
    options?: ErrorOptions & { provider?: string; model?: string; budget?: number; actual?: number },
  ) {
    super(message, options);
    this.budget = options?.budget;
    this.actual = options?.actual;
  }
}

// ---------------------------------------------------------------------------
// Tool errors
// ---------------------------------------------------------------------------

/** Base class for all tool-related errors. */
export class ToolError extends CurioError {
  /** The name of the tool that errored. */
  readonly toolName?: string;

  constructor(message: string, options?: ErrorOptions & { toolName?: string }) {
    super(message, options);
    this.toolName = options?.toolName;
  }
}

/** Tool not found in the registry. */
export class ToolNotFoundError extends ToolError {}

/** Tool execution failed. */
export class ToolExecutionError extends ToolError {
  /** The arguments that were passed to the tool. */
  readonly toolArgs?: Record<string, unknown>;

  constructor(
    message: string,
    options?: ErrorOptions & { toolName?: string; toolArgs?: Record<string, unknown> },
  ) {
    super(message, options);
    this.toolArgs = options?.toolArgs;
  }
}

/** Tool execution timed out. */
export class ToolTimeoutError extends ToolError {
  /** The timeout value that was exceeded (ms). */
  readonly timeoutMs?: number;

  constructor(
    message: string,
    options?: ErrorOptions & { toolName?: string; timeoutMs?: number },
  ) {
    super(message, options);
    this.timeoutMs = options?.timeoutMs;
  }
}

/** Tool argument validation failed. */
export class ToolValidationError extends ToolError {
  /** The validation errors. */
  readonly validationErrors?: string[];

  constructor(
    message: string,
    options?: ErrorOptions & { toolName?: string; validationErrors?: string[] },
  ) {
    super(message, options);
    this.validationErrors = options?.validationErrors;
  }
}

// ---------------------------------------------------------------------------
// State errors
// ---------------------------------------------------------------------------

/** Error loading or saving agent state. */
export class StateError extends CurioError {}

/** Session not found. */
export class SessionNotFoundError extends CurioError {
  readonly sessionId?: string;

  constructor(message: string, options?: ErrorOptions & { sessionId?: string }) {
    super(message, options);
    this.sessionId = options?.sessionId;
  }
}

// ---------------------------------------------------------------------------
// Configuration errors
// ---------------------------------------------------------------------------

/** Invalid configuration. */
export class ConfigurationError extends CurioError {}

/** Missing required credential. */
export class CredentialError extends CurioError {}
