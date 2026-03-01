/**
 * Agent loop interface — defines the step/continue contract for agent execution.
 */

import type { AgentState } from "../state/state.js";
import type { StreamEvent } from "../../models/events.js";

/** The core loop interface. Implementations define how the agent thinks and acts. */
export interface AgentLoop {
  /** Execute a single iteration of the loop, returning the updated state. */
  step(state: AgentState): Promise<AgentState>;

  /** Whether the loop should continue iterating. */
  shouldContinue(state: AgentState): boolean;

  /**
   * Optional: run one step with streaming, yielding events as they occur.
   * When present, the runtime uses this in streaming mode for real-time delegation.
   */
  streamStep?(state: AgentState): AsyncIterableIterator<StreamEvent>;
}
