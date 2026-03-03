/**
 * Integration: MCP (Model Context Protocol) bridge
 *
 * Verifies that MCP client, adapter, and bridge components work together.
 * Uses empty server configs to avoid real MCP server dependencies.
 */
import { describe, it, expect } from "vitest";
import { MCPBridge } from "../../src/mcp/bridge.js";

describe("MCP integration", () => {
  it("should create an MCPBridge instance with empty servers", () => {
    const bridge = new MCPBridge({ servers: [] });
    expect(bridge).toBeDefined();
  });

  it("should start and shut down cleanly with no servers", async () => {
    const bridge = new MCPBridge({ servers: [] });
    await bridge.startup();
    expect(bridge.initialized).toBe(true);
    await bridge.shutdown();
  });

  it("should return empty tools when no servers configured", async () => {
    const bridge = new MCPBridge({ servers: [] });
    await bridge.startup();
    const tools = await bridge.getTools();
    expect(tools).toEqual([]);
    await bridge.shutdown();
  });

  it("should return undefined for non-existent client", async () => {
    const bridge = new MCPBridge({ servers: [] });
    await bridge.startup();
    expect(bridge.getClient("nonexistent")).toBeUndefined();
    await bridge.shutdown();
  });
});
