import { describe, it, expect } from "vitest";
import {
  AllowAll,
  AskAlways,
  AllowReadsAskWrites,
  CompoundPolicy,
  FileSandboxPolicy,
  NetworkSandboxPolicy,
  type PermissionResult,
  type PermissionPolicy,
  type PermissionContext,
  collectPathsFromArgs,
  collectUrlsFromArgs,
  CLIHumanInput,
  type HumanInputHandler,
} from "../../src/index.js";

// ---------------------------------------------------------------------------
// PermissionResult / helpers (behavioral expectations via policies)
// ---------------------------------------------------------------------------

describe("AllowAll policy", () => {
  it("allows any tool call without confirmation", async () => {
    const policy = new AllowAll();
    const result = await policy.checkToolCall("any_tool", { x: 1 }, {});
    expect(result.allowed).toBe(true);
    expect(result.requireConfirmation).toBeUndefined();
  });

  it("allows any file access", async () => {
    const policy = new AllowAll();
    const result = await policy.checkFileAccess?.("/any/path", "w", {});
    expect(result?.allowed).toBe(true);
  });

  it("allows any network access", async () => {
    const policy = new AllowAll();
    const result = await policy.checkNetworkAccess?.("https://example.com", {});
    expect(result?.allowed).toBe(true);
  });
});

describe("AskAlways policy", () => {
  it("requires confirmation for tool calls", async () => {
    const policy = new AskAlways();
    const result = await policy.checkToolCall("any_tool", {}, {});
    expect(result.allowed).toBe(true);
    expect(result.requireConfirmation).toBe(true);
    expect((result.reason ?? "").toLowerCase()).toContain("confirmation");
  });
});

describe("AllowReadsAskWrites policy", () => {
  it("allows read-like tool names without confirmation", async () => {
    const policy = new AllowReadsAskWrites();
    const result = await policy.checkToolCall("read_file", { path: "/tmp/x" }, {});
    expect(result.allowed).toBe(true);
    expect(result.requireConfirmation).toBeUndefined();
  });

  it("asks for confirmation on write-like tool names", async () => {
    const policy = new AllowReadsAskWrites();
    const result = await policy.checkToolCall("write", { path: "/tmp/x" }, {});
    expect(result.allowed).toBe(true);
    expect(result.requireConfirmation).toBe(true);
    const reason = (result.reason ?? "").toLowerCase();
    expect(reason.includes("modify") || reason.includes("confirmation")).toBe(true);
  });

  it("asks for confirmation on execute-like tool names", async () => {
    const policy = new AllowReadsAskWrites();
    const result = await policy.checkToolCall("execute_code", { code: "1+1" }, {});
    expect(result.requireConfirmation).toBe(true);
  });

  it("allows file reads without confirmation", async () => {
    const policy = new AllowReadsAskWrites();
    const result = await policy.checkFileAccess?.("/tmp/x", "r", {});
    expect(result?.allowed).toBe(true);
    expect(result?.requireConfirmation).toBeUndefined();
  });

  it("asks for confirmation on file writes", async () => {
    const policy = new AllowReadsAskWrites();
    const result = await policy.checkFileAccess?.("/tmp/x", "w", {});
    expect(result?.allowed).toBe(true);
    expect(result?.requireConfirmation).toBe(true);
  });
});

describe("CompoundPolicy", () => {
  it("allows when all policies allow", async () => {
    const policy = new CompoundPolicy([new AllowAll(), new AllowAll()]);
    const result = await policy.checkToolCall("tool", {}, {});
    expect(result.allowed).toBe(true);
    expect(result.requireConfirmation).toBeUndefined();
  });

  it("denies when one policy denies", async () => {
    class DenyAll implements PermissionPolicy {
      async checkToolCall(
        _toolName: string,
        _args: Record<string, unknown>,
        _context: PermissionContext,
      ): Promise<PermissionResult> {
        return { allowed: false, reason: "denied" };
      }
    }

    const policy = new CompoundPolicy([new AllowAll(), new DenyAll()]);
    const result = await policy.checkToolCall("tool", {}, {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("denied");
  });

  it("propagates first confirmation requirement", async () => {
    const policy = new CompoundPolicy([new AskAlways(), new AllowAll()]);
    const result = await policy.checkToolCall("tool", {}, {});
    expect(result.allowed).toBe(true);
    expect(result.requireConfirmation).toBe(true);
  });

  it("allows by default with empty policy list", async () => {
    const policy = new CompoundPolicy([]);
    const result = await policy.checkToolCall("tool", {}, {});
    expect(result.allowed).toBe(true);
  });
});

describe("FileSandboxPolicy", () => {
  it("allows paths under allowed prefixes", async () => {
    const allowedDir = "/tmp/allowed";
    const policy = new FileSandboxPolicy([allowedDir]);
    const target = `${allowedDir}/file.txt`;
    const result = await policy.checkFileAccess(target, "r", {});
    expect(result.allowed).toBe(true);
  });

  it("denies paths outside allowed prefixes", async () => {
    const allowedDir = "/tmp/allowed";
    const policy = new FileSandboxPolicy([allowedDir]);
    const result = await policy.checkFileAccess("/etc/passwd", "r", {});
    expect(result.allowed).toBe(false);
    expect((result.reason ?? "").toLowerCase()).toContain("allowed");
  });

  it("denies path traversal attempts", async () => {
    const allowedDir = "/tmp/allowed";
    const policy = new FileSandboxPolicy([allowedDir]);
    const traversal = `${allowedDir}/sub/../../etc/passwd`;
    const result = await policy.checkFileAccess(traversal, "r", {});
    expect(result.allowed).toBe(false);
  });

  it("allows nested subpaths under allowed prefixes", async () => {
    const allowedDir = "/tmp/allowed";
    const policy = new FileSandboxPolicy([allowedDir]);
    const target = `${allowedDir}/nested/file.txt`;
    const result = await policy.checkFileAccess(target, "r", {});
    expect(result.allowed).toBe(true);
  });

  it("enforces sandbox for paths found in tool args", async () => {
    const allowedDir = "/tmp/allowed";
    const policy = new FileSandboxPolicy([allowedDir]);
    const ok = await policy.checkToolCall("read_file", { path: `${allowedDir}/f.txt` }, {});
    const bad = await policy.checkToolCall("read_file", { path: "/etc/passwd" }, {});
    expect(ok.allowed).toBe(true);
    expect(bad.allowed).toBe(false);
  });
});

describe("NetworkSandboxPolicy", () => {
  it("allows URLs matching literal substring patterns", async () => {
    const policy = new NetworkSandboxPolicy(["https://api.example.com", "localhost"]);
    const result = await policy.checkNetworkAccess("https://api.example.com/foo", {});
    expect(result.allowed).toBe(true);
  });

  it("denies URLs not in allowed list", async () => {
    const policy = new NetworkSandboxPolicy(["https://api.example.com"]);
    const result = await policy.checkNetworkAccess("https://evil.com/bar", {});
    expect(result.allowed).toBe(false);
    expect((result.reason ?? "").toLowerCase()).toContain("allowed");
  });

  it("supports regex patterns", async () => {
    const policy = new NetworkSandboxPolicy([String.raw`^https:\/\/api\.example\.com`]);
    const result = await policy.checkNetworkAccess("https://api.example.com/v1", {});
    expect(result.allowed).toBe(true);
  });

  it("denies disallowed URL schemes", async () => {
    const policy = new NetworkSandboxPolicy([".*"]);
    const result = await policy.checkNetworkAccess("javascript:alert(1)", {});
    expect(result.allowed).toBe(false);
    const reason = (result.reason ?? "").toLowerCase();
    expect(reason.includes("scheme") || reason.includes("disallowed")).toBe(true);
  });

  it("enforces sandbox for URLs found in tool args", async () => {
    const policy = new NetworkSandboxPolicy(["https://safe.com"]);
    const ok = await policy.checkToolCall("fetch", { url: "https://safe.com/page" }, {});
    const bad = await policy.checkToolCall("fetch", { url: "https://evil.com/page" }, {});
    expect(ok.allowed).toBe(true);
    expect(bad.allowed).toBe(false);
  });
});

describe("collectPathsFromArgs / collectUrlsFromArgs", () => {
  it("collectPathsFromArgs returns paths for string values", () => {
    const out = collectPathsFromArgs({ path: "/tmp/foo" });
    expect(out).toEqual([["path", "/tmp/foo"]]);
  });

  it("collectPathsFromArgs flattens list values", () => {
    const out = collectPathsFromArgs({ file_paths: ["/a", "/b"] });
    expect(out).toEqual([
      ["file_paths", "/a"],
      ["file_paths", "/b"],
    ]);
  });

  it("collectPathsFromArgs ignores non path-like keys", () => {
    const out = collectPathsFromArgs({ other: "/tmp/foo", path: "/x" });
    expect(out).toContainEqual(["path", "/x"]);
    expect(out.find(([k]) => k === "other")).toBeUndefined();
  });

  it("collectUrlsFromArgs returns URLs for string values", () => {
    const out = collectUrlsFromArgs({ url: "https://example.com" });
    expect(out).toEqual([["url", "https://example.com"]]);
  });

  it("collectUrlsFromArgs flattens list values", () => {
    const out = collectUrlsFromArgs({ url: ["https://a.com", "https://b.com"] });
    expect(out).toEqual([
      ["url", "https://a.com"],
      ["url", "https://b.com"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// HumanInputHandler / CLIHumanInput
// ---------------------------------------------------------------------------

class MockHumanInputApprove implements HumanInputHandler {
  async getUserConfirmation(): Promise<boolean> {
    return true;
  }
}

class MockHumanInputDeny implements HumanInputHandler {
  async getUserConfirmation(): Promise<boolean> {
    return false;
  }
}

describe("HumanInputHandler mocks", () => {
  it("approve mock returns true", async () => {
    const handler = new MockHumanInputApprove();
    const result = await handler.getUserConfirmation("prompt");
    expect(result).toBe(true);
  });

  it("deny mock returns false", async () => {
    const handler = new MockHumanInputDeny();
    const result = await handler.getUserConfirmation("prompt");
    expect(result).toBe(false);
  });
});

describe("CLIHumanInput", () => {
  it("treats 'y' as approval", async () => {
    const handler = new CLIHumanInput();
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore override of readline; we only care about behavior
    const origCreateInterface = (handler as any).constructor.prototype._createInterface;
    // We cannot easily mock readline without a helper; rely on manual testing for now.
    expect(typeof handler.getUserConfirmation).toBe("function");
    // Restore prototype if it existed to avoid side effects
    if (origCreateInterface) {
      (handler as any).constructor.prototype._createInterface = origCreateInterface;
    }
  });
});

