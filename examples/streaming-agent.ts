import { Agent, LLMClient } from "curio-agent-sdk";

async function main(): Promise<void> {
  const agent = Agent.builder()
    .agentName("streaming-agent")
    .model("openai:gpt-4o-mini")
    .llmClient(new LLMClient())
    .systemPrompt("Answer clearly and briefly.")
    .build();

  for await (const event of agent.astream("List three practical TypeScript tips.")) {
    switch (event.type) {
      case "text_delta":
        process.stdout.write(event.text);
        break;
      case "tool_call_start":
        process.stdout.write(`\n[tool start] ${event.toolName}\n`);
        break;
      case "tool_call_end":
        process.stdout.write(`\n[tool end] ${event.toolName}\n`);
        break;
      case "error":
        console.error("\nStream error:", event.error.message);
        break;
      case "done":
        process.stdout.write(`\n\nDone in ${event.result.duration}ms\n`);
        break;
      default:
        break;
    }
  }
}

void main();
