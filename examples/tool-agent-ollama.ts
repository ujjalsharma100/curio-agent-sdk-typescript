/**
 * Tool agent with Ollama — calculator + search, full run logged to a .log file.
 *
 * Run: npx tsx examples/tool-agent-ollama.ts
 * Requires: Ollama running locally. Pull a model first, e.g.: ollama pull llama3.2
 *           Set OLLAMA_HOST if your Ollama server is not at http://localhost:11434
 */
import "dotenv/config";
import { Agent, LLMClient, useRunLogger } from "curio-agent-sdk";
import { calculator, search } from "./lib/tools.js";

const OLLAMA_BASE = process.env["OLLAMA_HOST"] ?? "http://localhost:11434";

async function main(): Promise<void> {
  const builder = Agent.builder();
  const runLogger = useRunLogger(builder, { baseName: "tool-agent-ollama" });

  const agent = builder
    .agentName("tool-agent-ollama")
    .model("ollama:qwen3.5:9b")
    .llmClient(new LLMClient({ providers: { ollama: { baseUrl: OLLAMA_BASE } } }))
    .systemPrompt("Use the calculator for math and search for lookups. Be concise.")
    .tool(calculator)
    .tool(search)
    .maxIterations(8)
    .build();

  const result = await agent.run("What is 144 divided by 12?");
  console.log("--- Output ---");
  console.log(result.output);
  console.log("Tool calls:", result.toolCalls.length);

  const logPath = runLogger.getLogPath();
  if (logPath) console.log("\nFull run log:", logPath);
}

void main();
