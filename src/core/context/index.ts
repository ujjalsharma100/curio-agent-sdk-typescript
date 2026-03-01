/**
 * Context and instructions — token budget management and hierarchical instruction loading.
 */

export { ContextManager, SUMMARIZE_PLACEHOLDER } from "./context.js";
export type { ContextManagerOptions, ContextStrategy } from "./context.js";

export {
  InstructionLoader,
  loadInstructionsFromFile,
  findProjectRoot,
  defaultSearchPaths,
  DEFAULT_INSTRUCTION_FILES,
  PROJECT_ROOT_MARKERS,
} from "./instructions.js";
export type { InstructionLoaderOptions } from "./instructions.js";
