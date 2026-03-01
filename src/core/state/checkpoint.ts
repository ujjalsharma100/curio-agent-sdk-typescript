/**
 * Checkpointing and recovery for agent state.
 *
 * Serializes AgentState to JSON for persistence and resumption after
 * crashes or interruptions. Version-tagged for migration support.
 */

import type { Message, ToolSchema, TokenUsage, ContentPart, ToolCall } from "../../models/llm.js";
import type { AgentMetrics, ToolCallRecord } from "../../models/agent.js";
import { AgentState } from "./state.js";
import type { StateExtensionFactory } from "./state.js";

/** Current checkpoint format version for migration. */
export const CHECKPOINT_VERSION = 1;

/** JSON-serializable snapshot of agent state. */
export interface CheckpointData {
  version: number;
  runId: string;
  agentId?: string;
  iteration: number;
  timestamp: string; // ISO 8601
  messages: SerializedMessage[];
  toolSchemas: ToolSchema[];
  metadata: Record<string, unknown>;
  usage: TokenUsage;
  metrics: AgentMetrics;
  toolCallRecords: ToolCallRecord[];
  extensions: Record<string, Record<string, unknown>>;
  completed: boolean;
  output: string;
  model: string;
  maxIterations: number;
  transitionHistory: [string, number][]; // [phase, monotonic timestamp]
}

/** Serialized form of a Message for JSON storage. */
export interface SerializedMessage {
  role: Message["role"];
  content: string | SerializedContentPart[];
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  toolCallId?: string;
  name?: string;
}

interface SerializedContentPart {
  type: "text" | "image_url";
  text?: string;
  imageUrl?: { url: string; detail?: "auto" | "low" | "high" };
}

function serializeContentPart(part: ContentPart): SerializedContentPart {
  if (part.type === "text") {
    return { type: "text", text: part.text };
  }
  return { type: "image_url", imageUrl: part.imageUrl };
}

function deserializeContentPart(data: SerializedContentPart): ContentPart {
  if (data.type === "text") {
    return { type: "text", text: data.text ?? "" };
  }
  return {
    type: "image_url",
    imageUrl: data.imageUrl ?? { url: "" },
  };
}

/** Serialize a Message to a JSON-compatible object. */
export function serializeMessage(msg: Message): SerializedMessage {
  const out: SerializedMessage = {
    role: msg.role,
    content:
      typeof msg.content === "string"
        ? msg.content
        : msg.content.map(serializeContentPart),
    toolCallId: msg.toolCallId,
    name: msg.name,
  };
  if (msg.toolCalls?.length) {
    out.toolCalls = msg.toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
    }));
  }
  return out;
}

/** Deserialize a Message from a checkpoint dict. */
export function deserializeMessage(data: SerializedMessage): Message {
  const content =
    typeof data.content === "string"
      ? data.content
      : data.content.map(deserializeContentPart);
  const message: Message = {
    role: data.role,
    content,
    toolCallId: data.toolCallId,
    name: data.name,
  };
  if (data.toolCalls?.length) {
    message.toolCalls = data.toolCalls.map(
      (tc): ToolCall => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      }),
    );
  }
  return message;
}

/** Build checkpoint data from an AgentState (uses state's toCheckpoint + version + timestamp). */
export function checkpointFromState(state: AgentState): CheckpointData {
  const extData = state.getExtensionsForCheckpoint();
  const transitionHistory = state.getTransitionHistory();
  return {
    version: CHECKPOINT_VERSION,
    runId: state.runId,
    agentId: state.agentId,
    iteration: state.iteration,
    timestamp: new Date().toISOString(),
    messages: state.messages.map(serializeMessage),
    toolSchemas: state.toolSchemas,
    metadata: Object.fromEntries(state.metadata),
    usage: state.usage,
    metrics: state.metrics,
    toolCallRecords: state.toolCallRecords,
    extensions: extData,
    completed: state.completed,
    output: state.output,
    model: state.model,
    maxIterations: state.maxIterations,
    transitionHistory,
  };
}

/** Restore an AgentState from checkpoint data. */
export function stateFromCheckpoint(
  data: CheckpointData,
  extensionFactories?: Map<string, StateExtensionFactory>,
): AgentState {
  const messages = data.messages.map(deserializeMessage);
  const state = new AgentState({
    messages,
    toolSchemas: data.toolSchemas,
    maxIterations: data.maxIterations,
    runId: data.runId,
    agentId: data.agentId,
    model: data.model,
  });

  state.iteration = data.iteration;
  state.usage = data.usage;
  state.metrics = data.metrics;
  state.toolCallRecords = data.toolCallRecords ?? [];
  state.completed = data.completed;
  state.output = data.output ?? "";

  if (data.metadata) {
    for (const [k, v] of Object.entries(data.metadata)) {
      state.metadata.set(k, v);
    }
  }

  if (data.extensions && extensionFactories) {
    state.setExtensionsFromCheckpoint(data.extensions, extensionFactories);
  }

  if (data.transitionHistory?.length) {
    state.setTransitionHistory(data.transitionHistory);
  }

  return state;
}

/** Serialize checkpoint data to a JSON string. */
export function serializeCheckpoint(data: CheckpointData): string {
  return JSON.stringify(data);
}

/** Deserialize checkpoint data from a JSON string. */
export function deserializeCheckpoint(json: string): CheckpointData {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const th = (raw.transitionHistory as unknown[]) ?? [];
  const transitionHistory: [string, number][] = th
    .filter(
      (item): item is [string, number] =>
        Array.isArray(item) && item.length >= 2 && typeof item[1] === "number",
    )
    .map(([p, t]) => [String(p), Number(t)]);
  return {
    version: Number(raw.version) ?? CHECKPOINT_VERSION,
    runId: String(raw.runId),
    agentId: raw.agentId != null ? String(raw.agentId) : undefined,
    iteration: Number(raw.iteration) ?? 0,
    timestamp: String(raw.timestamp ?? new Date().toISOString()),
    messages: Array.isArray(raw.messages) ? raw.messages as SerializedMessage[] : [],
    toolSchemas: Array.isArray(raw.toolSchemas) ? raw.toolSchemas as ToolSchema[] : [],
    metadata:
      raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
        ? (raw.metadata as Record<string, unknown>)
        : {},
    usage: (raw.usage as TokenUsage) ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    metrics: (raw.metrics as AgentMetrics) ?? {
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      llmCalls: 0,
      toolCalls: 0,
      estimatedCost: 0,
      llmLatency: 0,
      toolLatency: 0,
    },
    toolCallRecords: Array.isArray(raw.toolCallRecords)
      ? (raw.toolCallRecords as ToolCallRecord[])
      : [],
    extensions:
      raw.extensions &&
      typeof raw.extensions === "object" &&
      !Array.isArray(raw.extensions)
        ? (raw.extensions as Record<string, Record<string, unknown>>)
        : {},
    completed: Boolean(raw.completed),
    output: String(raw.output ?? ""),
    model: String(raw.model ?? ""),
    maxIterations: Number(raw.maxIterations) ?? 50,
    transitionHistory,
  };
}
