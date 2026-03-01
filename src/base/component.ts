/**
 * Base component class for all SDK components that have a lifecycle.
 *
 * Components that manage resources (connections, file handles, child processes)
 * should extend this class and implement startup/shutdown for proper lifecycle management.
 */
export abstract class Component {
  private _initialized = false;

  /** Whether this component has been initialized via startup(). */
  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Initialize the component. Called once before first use.
   * Implementations should open connections, load state, etc.
   */
  abstract startup(): Promise<void>;

  /**
   * Shut down the component. Called once when no longer needed.
   * Implementations should close connections, flush buffers, save state, etc.
   */
  abstract shutdown(): Promise<void>;

  /**
   * Check if the component is healthy and operational.
   * Override for components that can degrade (e.g., database connections).
   * @returns true if healthy, false otherwise
   */
  async healthCheck(): Promise<boolean> {
    return this._initialized;
  }

  /** @internal Mark the component as initialized. Call from startup() implementations. */
  protected markInitialized(): void {
    this._initialized = true;
  }

  /** @internal Mark the component as shut down. Call from shutdown() implementations. */
  protected markShutdown(): void {
    this._initialized = false;
  }
}
