import { describe, it, expect } from "vitest";
import { Component } from "../../src/base/component.js";

class TestComponent extends Component {
  startupCalled = false;
  shutdownCalled = false;

  async startup(): Promise<void> {
    this.startupCalled = true;
    this.markInitialized();
  }

  async shutdown(): Promise<void> {
    this.shutdownCalled = true;
    this.markShutdown();
  }
}

describe("Component", () => {
  it("starts uninitialized", () => {
    const c = new TestComponent();
    expect(c.initialized).toBe(false);
  });

  it("becomes initialized after startup", async () => {
    const c = new TestComponent();
    await c.startup();
    expect(c.initialized).toBe(true);
    expect(c.startupCalled).toBe(true);
  });

  it("becomes uninitialized after shutdown", async () => {
    const c = new TestComponent();
    await c.startup();
    await c.shutdown();
    expect(c.initialized).toBe(false);
    expect(c.shutdownCalled).toBe(true);
  });

  it("healthCheck returns initialized state", async () => {
    const c = new TestComponent();
    expect(await c.healthCheck()).toBe(false);
    await c.startup();
    expect(await c.healthCheck()).toBe(true);
    await c.shutdown();
    expect(await c.healthCheck()).toBe(false);
  });
});
