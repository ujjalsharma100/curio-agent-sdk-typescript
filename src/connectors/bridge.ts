import { Component } from "../base/component.js";
import type { Connector, ConnectorRequestContext } from "./base.js";

export interface ConnectorBridgeOptions {
  connectors?: Connector[];
}

/**
 * Component that manages the lifecycle of a connector set.
 */
export class ConnectorBridge extends Component implements Iterable<Connector> {
  private readonly connectors = new Map<string, Connector>();

  constructor(options: ConnectorBridgeOptions = {}) {
    super();
    for (const connector of options.connectors ?? []) {
      this.register(connector);
    }
  }

  register(connector: Connector): void {
    this.connectors.set(connector.name, connector);
  }

  unregister(name: string): boolean {
    return this.connectors.delete(name);
  }

  get(name: string): Connector | undefined {
    return this.connectors.get(name);
  }

  has(name: string): boolean {
    return this.connectors.has(name);
  }

  list(): Connector[] {
    return [...this.connectors.values()];
  }

  [Symbol.iterator](): Iterator<Connector> {
    return this.connectors.values();
  }

  async startup(): Promise<void> {
    if (this.initialized) {
      return;
    }

    for (const connector of this.connectors.values()) {
      await connector.connect();
    }

    this.markInitialized();
  }

  async shutdown(): Promise<void> {
    const connectors = [...this.connectors.values()].reverse();
    for (const connector of connectors) {
      await connector.disconnect();
    }
    this.markShutdown();
  }

  async request<TRequest = unknown, TResponse = unknown>(
    connectorName: string,
    request: TRequest,
    context?: ConnectorRequestContext,
  ): Promise<TResponse> {
    const connector = this.connectors.get(connectorName);
    if (!connector) {
      throw new Error(`Connector "${connectorName}" not registered`);
    }

    const result = await connector.request(request, context);
    return result as TResponse;
  }

  async healthCheck(): Promise<boolean> {
    for (const connector of this.connectors.values()) {
      if (!connector.connected) {
        return false;
      }
      if (connector.healthCheck) {
        const ok = await connector.healthCheck();
        if (!ok) {
          return false;
        }
      }
    }
    return true;
  }
}
