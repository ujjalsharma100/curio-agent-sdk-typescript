/**
 * Integration: Connector system
 *
 * Verifies connector lifecycle and request/response handling.
 */
import { describe, it, expect } from "vitest";
import { BaseConnector, type ConnectorRequestContext } from "../../src/connectors/base.js";

/** In-memory mock connector for testing. */
class MockConnector extends BaseConnector<string, string> {
  private _connected = false;
  requestCount = 0;

  constructor() {
    super({ name: "mock-connector" });
  }

  async connect(): Promise<void> {
    this._connected = true;
    this.markInitialized();
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    this.markShutdown();
  }

  async request(input: string, _ctx?: ConnectorRequestContext): Promise<string> {
    if (!this._connected) throw new Error("Not connected");
    this.requestCount++;
    return `response:${input}`;
  }

  async healthCheck(): Promise<boolean> {
    return this._connected;
  }
}

describe("connector integration", () => {
  it("should connect, handle requests, and disconnect", async () => {
    const conn = new MockConnector();
    expect(conn.connected).toBe(false);

    await conn.connect();
    expect(conn.connected).toBe(true);

    const result = await conn.request("hello");
    expect(result).toBe("response:hello");
    expect(conn.requestCount).toBe(1);

    await conn.disconnect();
    expect(conn.connected).toBe(false);
  });

  it("should throw when requesting while disconnected", async () => {
    const conn = new MockConnector();
    await expect(conn.request("fail")).rejects.toThrow("Not connected");
  });

  it("should report health status", async () => {
    const conn = new MockConnector();
    expect(await conn.healthCheck()).toBe(false);

    await conn.connect();
    expect(await conn.healthCheck()).toBe(true);

    await conn.disconnect();
    expect(await conn.healthCheck()).toBe(false);
  });

  it("should use startup/shutdown lifecycle methods", async () => {
    const conn = new MockConnector();
    await conn.startup();
    expect(conn.connected).toBe(true);

    const result = await conn.request("test");
    expect(result).toBe("response:test");

    await conn.shutdown();
    expect(conn.connected).toBe(false);
  });
});
