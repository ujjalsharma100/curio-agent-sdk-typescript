import { Component } from "../base/component.js";

/**
 * Connector request metadata.
 */
export interface ConnectorRequestContext {
  runId?: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Generic connector contract.
 *
 * Connectors are lifecycle-aware integration adapters (HTTP APIs, databases,
 * queues, third-party services) that can be started/stopped with the agent.
 */
export interface Connector<TRequest = unknown, TResponse = unknown> {
  readonly name: string;
  readonly connected: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  request(request: TRequest, context?: ConnectorRequestContext): Promise<TResponse>;
  healthCheck?(): Promise<boolean>;
}

export interface BaseConnectorOptions {
  name: string;
}

/**
 * Base class for lifecycle-managed connectors.
 */
export abstract class BaseConnector<TRequest = unknown, TResponse = unknown>
  extends Component
  implements Connector<TRequest, TResponse>
{
  readonly name: string;

  protected constructor(options: BaseConnectorOptions) {
    super();
    this.name = options.name;
  }

  get connected(): boolean {
    return this.initialized;
  }

  async startup(): Promise<void> {
    await this.connect();
  }

  async shutdown(): Promise<void> {
    await this.disconnect();
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract request(request: TRequest, context?: ConnectorRequestContext): Promise<TResponse>;
}
