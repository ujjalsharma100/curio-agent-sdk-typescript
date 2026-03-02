import { z } from "zod";
import { createTool, type Tool } from "../core/tools/tool.js";

/**
 * Options for the computer_use tool.
 *
 * This is intentionally conservative: in many environments GUI automation
 * is not available or desirable. For now this tool acts as a placeholder
 * that surfaces a clear, structured error message.
 */
export interface ComputerUseToolOptions {
  /**
   * When true, the tool is considered enabled, but the current implementation
   * still only returns a structured error explaining that real GUI automation
   * is not available in this SDK build.
   *
   * This flag exists to keep the API compatible with potential future
   * implementations that integrate with robotjs/nut.js or platform-specific
   * automation backends.
   */
  enabled?: boolean;
}

const ComputerUseArgsSchema = z.object({
  instruction: z
    .string()
    .describe(
      "High-level natural language description of the GUI action to perform (for logging and UX only).",
    ),
});

type ComputerUseArgs = z.infer<typeof ComputerUseArgsSchema>;

export function createComputerUseTool(options: ComputerUseToolOptions = {}): Tool {
  const enabled = options.enabled ?? false;

  return createTool<ComputerUseArgs>({
    name: "computer_use",
    description:
      "Placeholder GUI automation tool. Keeps the API surface compatible with the Python SDK but does not perform real GUI actions.",
    parameters: ComputerUseArgsSchema,
    async execute(args) {
      return JSON.stringify({
        success: false,
        enabled,
        message:
          "computer_use is not implemented in this TypeScript SDK build. Describe the requested GUI action to the user instead or use an external automation service.",
        requestedInstruction: args.instruction,
      });
    },
  });
}

export const computerUseTool: Tool = createComputerUseTool();

