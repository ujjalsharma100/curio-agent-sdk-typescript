/**
 * Middleware for the Curio Agent SDK.
 *
 * Middleware intercepts LLM and tool calls for logging, cost tracking,
 * rate limiting, tracing, guardrails, and observability.
 *
 * @example
 * ```ts
 * import {
 *   LoggingMiddleware,
 *   CostTracker,
 *   GuardrailsMiddleware,
 *   MiddlewarePipeline,
 * } from "curio-agent-sdk/middleware";
 *
 * const agent = Agent.builder()
 *   .model("openai:gpt-4o")
 *   .middleware([
 *     new LoggingMiddleware({ level: "info" }),
 *     new CostTracker({ budget: 1.0 }),
 *     new GuardrailsMiddleware({ blockPatterns: ["(?i)password"] }),
 *   ])
 *   .llmClient(client)
 *   .build();
 * ```
 */

export type { Middleware } from "./base.js";
export { MiddlewarePipeline } from "./base.js";
export { LoggingMiddleware } from "./logging.js";
export type { LoggingMiddlewareOptions } from "./logging.js";
export { CostTracker, DEFAULT_PRICING } from "./cost-tracker.js";
export type { CostTrackerOptions } from "./cost-tracker.js";
export { RateLimitMiddleware } from "./rate-limit.js";
export type { RateLimitMiddlewareOptions } from "./rate-limit.js";
export { TracingMiddleware } from "./tracing.js";
export type { TracingMiddlewareOptions } from "./tracing.js";
export { GuardrailsMiddleware, GuardrailsError } from "./guardrails.js";
export type { GuardrailsMiddlewareOptions } from "./guardrails.js";
export { PrometheusExporter } from "./prometheus.js";
export type { PrometheusExporterOptions } from "./prometheus.js";
export {
  TracingConsumer,
  LoggingConsumer,
  PersistenceConsumer,
  getTraceContext,
} from "./consumers.js";
export type {
  TracingConsumerOptions,
  LoggingConsumerOptions,
} from "./consumers.js";
