/**
 * SDK-internal logger. Wraps pino for structured logging.
 * Consumers can override with their own logger via configuration.
 */

import pino from "pino";

/** The SDK logger instance. Defaults to silent; enabled via CURIO_LOG_LEVEL env var. */
export const logger = pino({
  name: "curio-agent-sdk",
  level: process.env["CURIO_LOG_LEVEL"] ?? "silent",
  transport:
    process.env["CURIO_LOG_PRETTY"] === "1"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

/** Create a child logger with a specific component label. */
export function createLogger(component: string) {
  return logger.child({ component });
}
