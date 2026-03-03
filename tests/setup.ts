/**
 * Global test setup for Vitest.
 *
 * This file is registered in vitest.config.ts and runs once before the
 * entire test suite. Use it for global setup/teardown like silencing
 * noisy loggers or seeding global state.
 */

// Silence pino loggers during tests to keep output clean.
// Tests that need logging can override this locally.
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
