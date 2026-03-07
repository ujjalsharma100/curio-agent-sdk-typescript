/**
 * Shared tools for examples — calculator and search (demo only).
 */
import { createTool } from "curio-agent-sdk";
import { z } from "zod";

/** Simple calculator; use a safe expression subset. */
export const calculator = createTool({
  name: "calculator",
  description: "Evaluate simple arithmetic expressions (e.g. 12 * 7, 100 / 4).",
  parameters: z.object({
    expression: z.string().describe("Arithmetic expression like '81 / 9' or '2 + 3 * 4'"),
  }),
  execute: async ({ expression }) => {
    const sanitized = expression.replace(/\s/g, "");
    if (!/^[\d+\-*/().]+$/.test(sanitized)) {
      return `Error: only numbers and + - * / ( ) allowed, got: ${expression}`;
    }
    try {
      const value = Function(`"use strict"; return (${sanitized})`)();
      return String(value);
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});

/** Fake search for demo. */
export const search = createTool({
  name: "search",
  description: "Search for information (demo: returns a placeholder).",
  parameters: z.object({
    query: z.string().describe("Search query"),
  }),
  execute: async ({ query }) => {
    return `[Demo] Search results for "${query}": (use a real search API in production)`;
  },
});
