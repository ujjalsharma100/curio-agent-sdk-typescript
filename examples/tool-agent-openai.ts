/**
 * Tool agent with OpenAI — calculator + search, full run logged to a .log file.
 *
 * Run: npx tsx examples/tool-agent-openai.ts
 * Requires: OPENAI_API_KEY
 */
import "dotenv/config";
import { Agent, LLMClient, useRunLogger } from "curio-agent-sdk";
import { calculator, search } from "./lib/tools.js";

async function main(): Promise<void> {
  const builder = Agent.builder();
  const runLogger = useRunLogger(builder, { baseName: "tool-agent-openai" });

  const agent = builder
    .agentName("tool-agent-openai")
    .model("openai:gpt-4.1-mini")
    .llmClient(new LLMClient())
    .systemPrompt("Use the calculator for math and search for lookups. Be concise.")
    .tool(calculator)
    .tool(search)
    .maxIterations(8)
    .build();

  const result = await agent.run("What is (15 * 4) + (100 / 5)?");
  console.log("--- Output ---");
  console.log(result.output);
  console.log("Tool calls:", result.toolCalls.length);

  const logPath = runLogger.getLogPath();
  if (logPath) console.log("\nFull run log:", logPath);
}

void main();
