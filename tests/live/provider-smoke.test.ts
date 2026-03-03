/**
 * Live provider smoke tests.
 *
 * These tests make REAL API calls to LLM providers and should ONLY be run:
 * - When RUN_LIVE_TESTS=true environment variable is set
 * - When the relevant provider API keys are configured
 * - Outside of CI required checks (optional scheduled/manual runs)
 *
 * Expected environment variables:
 * - RUN_LIVE_TESTS=true          — gate to run these tests
 * - OPENAI_API_KEY               — for OpenAI tests
 * - ANTHROPIC_API_KEY            — for Anthropic tests
 *
 * WARNING: These tests incur real API costs. Keep them minimal (single prompt).
 */
import { describe, it, expect } from "vitest";

const LIVE = process.env.RUN_LIVE_TESTS === "true";

describe.skipIf(!LIVE)("live provider smoke tests", () => {
  it.skipIf(!process.env.OPENAI_API_KEY)("OpenAI: single prompt", async () => {
    // Dynamic import to avoid loading optional deps in normal test runs
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Reply with just the word 'pong'." }],
      max_tokens: 10,
    });

    const text = response.choices[0]?.message?.content ?? "";
    expect(text.toLowerCase()).toContain("pong");
  });

  it.skipIf(!process.env.ANTHROPIC_API_KEY)("Anthropic: single prompt", async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 10,
      messages: [{ role: "user", content: "Reply with just the word 'pong'." }],
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "";
    expect(text.toLowerCase()).toContain("pong");
  });
});
