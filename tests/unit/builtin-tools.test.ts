import { describe, it, expect, vi, afterEach } from "vitest";
import {
  webFetchTool,
  httpRequestTool,
  fileReadTool,
  fileWriteTool,
  codeExecuteTool,
  shellExecuteTool,
  browserTool,
  computerUseTool,
} from "../../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(result: string): any {
  return JSON.parse(result);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// web_fetch
// ---------------------------------------------------------------------------

describe("web_fetch tool", () => {
  it("converts simple HTML to markdown-like text", async () => {
    const html = "<h1>Title</h1><p>Hello <strong>world</strong>.</p>";

    const headers = new Headers();
    headers.set("content-type", "text/html; charset=utf-8");

    const response = new Response(html, { status: 200, headers });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(response as any);

    const raw = await webFetchTool.execute({ url: "https://example.com" });
    const data = parseResult(raw);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(data.url).toBe("https://example.com");
    expect(data.status).toBe(200);
    expect(data.contentType).toContain("text/html");
    expect(typeof data.markdown).toBe("string");
    expect(data.markdown).toContain("# Title");
    expect(data.markdown).toContain("Hello **world**.");
  });
});

// ---------------------------------------------------------------------------
// http_request
// ---------------------------------------------------------------------------

describe("http_request tool", () => {
  it("performs a JSON GET request and parses body", async () => {
    const jsonBody = { ok: true, message: "hi" };
    const headers = new Headers();
    headers.set("content-type", "application/json");
    const response = new Response(JSON.stringify(jsonBody), { status: 201, headers });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(response as any);

    const raw = await httpRequestTool.execute({ url: "https://api.example.com/hi" });
    const data = parseResult(raw);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(data.status).toBe(201);
    expect(data.json).toEqual(jsonBody);
    expect(typeof data.bodyText).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// file_read / file_write
// ---------------------------------------------------------------------------

describe("file_read and file_write tools", () => {
  it("writes and reads back a small text file", async () => {
    const tmpPath = "./tmp-builtin-tools-test.txt";
    const content = "hello world";

    const writeRaw = await fileWriteTool.execute({
      path: tmpPath,
      content,
      overwrite: true,
    });
    const writeData = parseResult(writeRaw);
    expect(writeData.error).toBeUndefined();
    expect(writeData.bytesWritten).toBe(content.length);

    const readRaw = await fileReadTool.execute({ path: tmpPath });
    const readData = parseResult(readRaw);
    expect(readData.error).toBeUndefined();
    expect(readData.content).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// code_execute
// ---------------------------------------------------------------------------

describe("code_execute tool", () => {
  it("runs a simple JavaScript snippet", async () => {
    const raw = await codeExecuteTool.execute({
      language: "javascript",
      code: "console.log('hi from code');",
      timeoutMs: 5_000,
    });
    const data = parseResult(raw);
    expect(data.language).toBe("javascript");
    expect(data.exitCode).toBe(0);
    expect(typeof data.stdout).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// shell_execute
// ---------------------------------------------------------------------------

describe("shell_execute tool", () => {
  it("executes a simple command", async () => {
    const raw = await shellExecuteTool.execute({
      command: "node",
      args: ["-e", "process.stdout.write('ok')"],
      timeoutMs: 5_000,
    });
    const data = parseResult(raw);
    expect(data.exitCode).toBe(0);
    expect(data.stdout).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// computer_use
// ---------------------------------------------------------------------------

describe("computer_use tool", () => {
  it("returns a structured placeholder error", async () => {
    const instruction = "Click the Run button in the IDE.";
    const raw = await computerUseTool.execute({ instruction });
    const data = parseResult(raw);
    expect(data.success).toBe(false);
    expect(data.requestedInstruction).toBe(instruction);
    expect(typeof data.message).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// browser_navigate
// ---------------------------------------------------------------------------

describe("browser_navigate tool", () => {
  it("returns an error when Playwright is not installed", async () => {
    const raw = await browserTool.execute({ url: "https://example.com" });
    const data = parseResult(raw);
    expect(data.url).toBe("https://example.com");
    expect(typeof data.error).toBe("string");
    // We don't assert on the exact message, only that an error string is present.
    expect(data.error.length).toBeGreaterThan(0);
  });
});

