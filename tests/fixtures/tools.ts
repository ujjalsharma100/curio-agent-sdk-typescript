/**
 * Reusable fake tools for integration and E2E tests.
 */
import { z } from "zod";
import { createTool } from "../../src/core/tools/tool.js";

/** A simple calculator tool. */
export const calculatorTool = createTool({
  name: "calculator",
  description: "Evaluate a math expression",
  parameters: z.object({
    expression: z.string().describe("Math expression to evaluate"),
  }),
  execute: async ({ expression }) => {
    try {
      // Safe subset: only digits, operators, parens, spaces, decimal points
      if (!/^[\d\s+\-*/().]+$/.test(expression)) {
        return `Error: invalid expression "${expression}"`;
      }
      const result = Function(`"use strict"; return (${expression})`)();
      return String(result);
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});

/** A simple search/lookup tool. */
export const searchTool = createTool({
  name: "search",
  description: "Search for information",
  parameters: z.object({
    query: z.string().describe("Search query"),
  }),
  execute: async ({ query }) => {
    return `Search results for "${query}": Found 3 relevant results.`;
  },
});

/** A text formatter tool. */
export const formatterTool = createTool({
  name: "formatter",
  description: "Format text in a specified style",
  parameters: z.object({
    text: z.string(),
    style: z.enum(["uppercase", "lowercase", "title"]),
  }),
  execute: async ({ text, style }) => {
    switch (style) {
      case "uppercase":
        return text.toUpperCase();
      case "lowercase":
        return text.toLowerCase();
      case "title":
        return text.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  },
});

/** An echo tool (returns its input). */
export const echoTool = createTool({
  name: "echo",
  description: "Echo the input text back",
  parameters: z.object({
    text: z.string(),
  }),
  execute: async ({ text }) => text,
});

/** A file-read fake that returns static content. */
export function fakeFileReadTool(fileContents: Record<string, string> = {}) {
  return createTool({
    name: "read_file",
    description: "Read a file from disk",
    parameters: z.object({
      path: z.string().describe("File path to read"),
    }),
    execute: async ({ path }) => {
      const content = fileContents[path];
      if (content === undefined) return `Error: File not found: ${path}`;
      return content;
    },
  });
}

/** A file-write fake that records writes. */
export function fakeFileWriteTool(written: Map<string, string> = new Map()) {
  return createTool({
    name: "write_file",
    description: "Write content to a file",
    parameters: z.object({
      path: z.string().describe("File path"),
      content: z.string().describe("Content to write"),
    }),
    execute: async ({ path, content }) => {
      written.set(path, content);
      return `Written ${content.length} bytes to ${path}`;
    },
  });
}

/** A code execution fake. */
export const codeExecuteTool = createTool({
  name: "execute_code",
  description: "Execute a code snippet",
  parameters: z.object({
    language: z.string(),
    code: z.string(),
  }),
  execute: async ({ language, code }) => {
    return `[${language}] Executed ${code.length} chars of code. Output: OK`;
  },
});

/** A tool that always fails. */
export const failingTool = createTool({
  name: "failing_tool",
  description: "A tool that always throws an error",
  parameters: z.object({
    input: z.string().optional(),
  }),
  execute: async () => {
    throw new Error("Tool execution failed intentionally");
  },
});

/** A slow tool that delays for a given number of ms. */
export function slowTool(delayMs = 100) {
  return createTool({
    name: "slow_tool",
    description: "A tool that takes time to complete",
    parameters: z.object({
      input: z.string().optional(),
    }),
    execute: async ({ input }) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return `Completed after ${delayMs}ms: ${input ?? "no input"}`;
    },
  });
}
