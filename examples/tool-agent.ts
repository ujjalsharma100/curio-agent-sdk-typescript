/**
 * Tool agent — single run with calculator (and optional search).
 * Logs full execution to a timestamped .log file in the current directory.
 *
 * Run: npx tsx examples/tool-agent.ts
 * Requires: OPENAI_API_KEY or ANTHROPIC_API_KEY or GROQ_API_KEY (model sets provider).
 */
import "dotenv/config";
import { Agent, LLMClient, useRunLogger } from "curio-agent-sdk";
import { calculator, search } from "./lib/tools.js";

async function main(): Promise<void> {
  const builder = Agent.builder();
  const runLogger = useRunLogger(builder, { baseName: "tool-agent" });

  const agent = builder
    .agentName("tool-agent")
    .model("openai:gpt-4o-mini")
    .llmClient(new LLMClient())
    .systemPrompt("Use tools whenever math or search is needed. Be concise.")
    .tool(calculator)
    .tool(search)
    .maxIterations(8)
    .build();

  const result = await agent.run("What is 81 divided by 9? Then search for 'curio agent'.");
  console.log("--- Output ---");
  console.log(result.output);
  console.log("Tool calls:", result.toolCalls.length);

  const logPath = runLogger.getLogPath();
  if (logPath) {
    console.log("\nFull run log written to:", logPath);
  }
}

void main();
