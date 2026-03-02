/**
 * Human-in-the-loop input handlers.
 *
 * Provides an interface and a CLI implementation for getting human
 * confirmation before executing sensitive actions.
 */

import readline from "node:readline";
import process from "node:process";

/** Handler for interactive human input (e.g., confirmations). */
export interface HumanInputHandler {
  /**
   * Ask the human to confirm an action.
   *
   * Implementations are free to ignore or use the provided context;
   * it typically includes run/agent IDs, tool name, arguments, etc.
   */
  getUserConfirmation(
    prompt: string,
    context?: Record<string, unknown>,
  ): Promise<boolean>;
}

/**
 * Terminal-based human input handler using stdin/stdout.
 *
 * Prompts the user for yes/no confirmation. Treats "y" and "yes"
 * (case-insensitive) as approval; everything else is a denial.
 */
export class CLIHumanInput implements HumanInputHandler {
  async getUserConfirmation(
    prompt: string,
    _context?: Record<string, unknown>,
  ): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      const answer = await new Promise<string>((resolve) => {
        rl.question(`${prompt} [y/N]: `, (value) => resolve(value));
      });
      const normalized = answer.trim().toLowerCase();
      return normalized === "y" || normalized === "yes";
    } finally {
      rl.close();
    }
  }
}

