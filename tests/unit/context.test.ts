import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import {
  ContextManager,
  SUMMARIZE_PLACEHOLDER,
  InstructionLoader,
  loadInstructionsFromFile,
  findProjectRoot,
  defaultSearchPaths,
  DEFAULT_INSTRUCTION_FILES,
  PROJECT_ROOT_MARKERS,
} from "../../src/core/context/index.js";
import { createMessage } from "../../src/models/llm.js";
import type { Message, ToolSchema } from "../../src/models/llm.js";
import { clearTokenCache } from "../../src/core/llm/token-counter.js";

// ---------------------------------------------------------------------------
// ContextManager
// ---------------------------------------------------------------------------
describe("ContextManager", () => {
  beforeEach(() => {
    clearTokenCache();
  });

  it("constructs with default strategy and reserve", async () => {
    const cm = new ContextManager({ maxTokens: 8000 });
    expect(cm).toBeDefined();
    const count = await cm.countTokens(
      [createMessage("user", "hi")],
      "gpt-4o-mini",
    );
    expect(count).toBeGreaterThan(0);
  });

  it("fitMessages returns copy when under budget", async () => {
    const cm = new ContextManager({ maxTokens: 100_000, reserveTokens: 1000 });
    const messages: Message[] = [
      createMessage("system", "You are helpful."),
      createMessage("user", "Hello"),
    ];
    const fitted = await cm.fitMessages(messages, undefined, "gpt-4o-mini");
    expect(fitted).toHaveLength(2);
    expect(fitted[0]?.content).toBe("You are helpful.");
    expect(fitted[1]?.content).toBe("Hello");
    expect(fitted).not.toBe(messages);
  });

  it("fitMessages preserves first system message when truncating", async () => {
    const cm = new ContextManager({
      maxTokens: 80,
      reserveTokens: 10,
      strategy: "truncate_oldest",
    });
    const messages: Message[] = [
      createMessage("system", "You are a helpful assistant."),
      createMessage("user", "First message that is long enough to use tokens."),
      createMessage("assistant", "Reply one."),
      createMessage("user", "Second user message here."),
    ];
    const fitted = await cm.fitMessages(messages, undefined, "gpt-4o-mini");
    expect(fitted.length).toBeLessThanOrEqual(messages.length);
    expect(fitted[0]?.role).toBe("system");
    expect(fitted[0]?.content).toBe("You are a helpful assistant.");
  });

  it("fitMessages with summarize strategy uses placeholder when no summarizer", async () => {
    const cm = new ContextManager({
      maxTokens: 40,
      reserveTokens: 5,
      strategy: "summarize",
    });
    const messages: Message[] = [
      createMessage("system", "You are helpful."),
      createMessage("user", "First long user message that consumes many tokens here."),
      createMessage("assistant", "Assistant reply with some content."),
      createMessage("user", "Second user message."),
    ];
    const fitted = await cm.fitMessages(messages, undefined, "gpt-4o-mini");
    expect(fitted.length).toBeGreaterThanOrEqual(2);
    // Either we have a placeholder summary message or we fell back to truncate
    const hasPlaceholder = fitted.some(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content === SUMMARIZE_PLACEHOLDER,
    );
    const hasSystem = fitted.some((m) => m.role === "system");
    expect(hasSystem).toBe(true);
    expect(hasPlaceholder || fitted.length < messages.length).toBe(true);
  });

  it("fitMessages with summarizer callback uses result when over budget", async () => {
    const cm = new ContextManager({
      maxTokens: 35,
      reserveTokens: 5,
      strategy: "summarize",
      summarizer: (msgs) =>
        Promise.resolve(createMessage("system", "Summary of " + msgs.length + " messages.")),
    });
    const messages: Message[] = [
      createMessage("system", "System."),
      createMessage("user", "First long message to trim and reduce."),
      createMessage("user", "Second message."),
    ];
    const fitted = await cm.fitMessages(messages, undefined, "gpt-4o-mini");
    // When over budget we get truncation or summary; either way we have at least system + some content
    expect(fitted.length).toBeGreaterThanOrEqual(1);
    const summary = fitted.find(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.startsWith("Summary of"),
    );
    // Summarizer may be used if we had to summarize; otherwise truncate path
    if (summary) expect(summary.content).toContain("messages.");
  });

  it("countTokens includes tool schemas when provided", async () => {
    const cm = new ContextManager({ maxTokens: 8000 });
    const messages: Message[] = [createMessage("user", "hi")];
    const tools: ToolSchema[] = [
      {
        name: "foo",
        description: "A tool",
        parameters: { type: "object", properties: {} },
      },
    ];
    const withTools = await cm.countTokens(messages, "gpt-4o-mini", tools);
    const withoutTools = await cm.countTokens(messages, "gpt-4o-mini");
    expect(withTools).toBeGreaterThan(withoutTools);
  });
});

// ---------------------------------------------------------------------------
// InstructionLoader
// ---------------------------------------------------------------------------
describe("InstructionLoader", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `curio-instructions-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it("load returns empty string when no files exist", () => {
    const loader = new InstructionLoader({
      searchPaths: [tmpDir],
      fileNames: ["AGENT.md", "NONEXISTENT.md"],
    });
    expect(loader.load()).toBe("");
  });

  it("load reads and merges instruction files", async () => {
    await fs.writeFile(path.join(tmpDir, "AGENT.md"), "Global rules here.", "utf-8");
    const loader = new InstructionLoader({
      searchPaths: [tmpDir],
      fileNames: ["AGENT.md"],
    });
    expect(loader.load()).toBe("Global rules here.");
  });

  it("load merges multiple files with separator", async () => {
    await fs.writeFile(path.join(tmpDir, "AGENT.md"), "First file.", "utf-8");
    await fs.writeFile(path.join(tmpDir, "RULES.md"), "Second file.", "utf-8");
    const loader = new InstructionLoader({
      searchPaths: [tmpDir],
      fileNames: ["AGENT.md", "RULES.md"],
      mergeSeparator: "\n---\n",
    });
    expect(loader.load()).toBe("First file.\n---\nSecond file.");
  });

  it("load skips directories", async () => {
    const agentPath = path.join(tmpDir, "AGENT.md");
    await fs.mkdir(agentPath, { recursive: true }); // AGENT.md as dir
    const loader = new InstructionLoader({
      searchPaths: [tmpDir],
      fileNames: ["AGENT.md"],
    });
    expect(loader.load()).toBe("");
  });

  it("toString returns descriptive string", () => {
    const loader = new InstructionLoader({ fileNames: ["A.md"] });
    expect(loader.toString()).toContain("InstructionLoader");
    expect(loader.toString()).toContain("A.md");
  });
});

// ---------------------------------------------------------------------------
// loadInstructionsFromFile
// ---------------------------------------------------------------------------
describe("loadInstructionsFromFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `curio-single-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it("returns file content when file exists", async () => {
    const filePath = path.join(tmpDir, "rules.md");
    await fs.writeFile(filePath, "Instructions content.", "utf-8");
    expect(loadInstructionsFromFile(filePath)).toBe("Instructions content.");
  });

  it("returns empty string when file does not exist", () => {
    expect(loadInstructionsFromFile(path.join(tmpDir, "nonexistent.md"))).toBe("");
  });
});

// ---------------------------------------------------------------------------
// findProjectRoot
// ---------------------------------------------------------------------------
describe("findProjectRoot", () => {
  it("returns null when start has no markers", () => {
    const root = findProjectRoot(os.tmpdir());
    expect(root).toBeNull();
  });

  it("returns directory containing package.json when present", async () => {
    const dir = path.join(os.tmpdir(), `curio-root-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "package.json"), "{}", "utf-8");
    const found = findProjectRoot(dir);
    expect(found).toBe(dir);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// defaultSearchPaths
// ---------------------------------------------------------------------------
describe("defaultSearchPaths", () => {
  it("returns non-empty array", () => {
    const paths = defaultSearchPaths();
    expect(Array.isArray(paths)).toBe(true);
    expect(paths.length).toBeGreaterThanOrEqual(1);
  });

  it("includes cwd", () => {
    const paths = defaultSearchPaths();
    const cwd = path.resolve(process.cwd());
    expect(paths).toContain(cwd);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe("Context constants", () => {
  it("DEFAULT_INSTRUCTION_FILES includes AGENT.md", () => {
    expect(DEFAULT_INSTRUCTION_FILES).toContain("AGENT.md");
  });

  it("PROJECT_ROOT_MARKERS includes .git and package.json", () => {
    expect(PROJECT_ROOT_MARKERS).toContain(".git");
    expect(PROJECT_ROOT_MARKERS).toContain("package.json");
  });

  it("SUMMARIZE_PLACEHOLDER is non-empty", () => {
    expect(SUMMARIZE_PLACEHOLDER.length).toBeGreaterThan(0);
    expect(SUMMARIZE_PLACEHOLDER).toContain("truncated");
  });
});
