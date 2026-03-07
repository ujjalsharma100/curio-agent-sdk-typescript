/**
 * Tool agent with Anthropic — calculator + search, full run logged to a .log file.
 *
 * Run: npx tsx examples/tool-agent-anthropic.ts
 * Requires: ANTHROPIC_API_KEY
 */
import "dotenv/config";
import { Agent, LLMClient, useRunLogger } from "curio-agent-sdk";
import { calculator, search } from "./lib/tools.js";

async function main(): Promise<void> {
  const builder = Agent.builder();
  const runLogger = useRunLogger(builder, { baseName: "tool-agent-anthropic" });

  const agent = builder
    .agentName("tool-agent-anthropic")
    .model("anthropic:claude-3-haiku-20240307")
    .llmClient(new LLMClient())
    .systemPrompt("Use the calculator for math and search for lookups. Be concise.")
    .tool(calculator)
    .tool(search)
    .maxIterations(8)
    .build();

  const result = await agent.run("What is 72 times 3?");
  console.log("--- Output ---");
  console.log(result.output);
  console.log("Tool calls:", result.toolCalls.length);

  const logPath = runLogger.getLogPath();
  if (logPath) console.log("\nFull run log:", logPath);
}

void main();
