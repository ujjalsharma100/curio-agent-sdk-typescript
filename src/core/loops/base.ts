/**
 * Agent loop interface — defines the step/continue contract for agent execution.
 */

import type { AgentState } from "../state/state.js";

/** The core loop interface. Implementations define how the agent thinks and acts. */
export interface AgentLoop {
  /** Execute a single iteration of the loop, returning the updated state. */
  step(state: AgentState): Promise<AgentState>;

  /** Whether the loop should continue iterating. */
  shouldContinue(state: AgentState): boolean;
}
