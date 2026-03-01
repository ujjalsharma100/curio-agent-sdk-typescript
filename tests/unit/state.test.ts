import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentState,
  CHECKPOINT_VERSION,
  checkpointFromState,
  stateFromCheckpoint,
  serializeCheckpoint,
  deserializeCheckpoint,
  serializeMessage,
  deserializeMessage,
  type CheckpointData,
  type StateExtension,
  type StateExtensionFactory,
  InMemoryStateStore,
  FileStateStore,
  InMemorySessionStore,
  FileSessionStore,
  SessionManager,
  touchSession,
  createMessage,
} from "../../src/index.js";

// ---------------------------------------------------------------------------
// State extension for tests
// ---------------------------------------------------------------------------

const TEST_EXT_KEY = "testExt";

class TestExtension implements StateExtension {
  constructor(public value: string) {}
  toDict(): Record<string, unknown> {
    return { value: this.value };
  }
}

const testExtensionFactory: StateExtensionFactory = (data) =>
  new TestExtension(String(data.value ?? ""));

// ---------------------------------------------------------------------------
// Checkpoint: message serialization
// ---------------------------------------------------------------------------

describe("checkpoint message serialization", () => {
  it("roundtrips a simple text message", () => {
    const msg = createMessage("user", "Hello");
    const serialized = serializeMessage(msg);
    expect(serialized.role).toBe("user");
    expect(serialized.content).toBe("Hello");
    const back = deserializeMessage(serialized);
    expect(back.role).toBe("user");
    expect(back.content).toBe("Hello");
  });

  it("roundtrips a message with tool calls", () => {
    const msg = createMessage("assistant", "Calling tool", {
      toolCalls: [{ id: "tc1", name: "foo", arguments: { x: 1 } }],
    });
    const serialized = serializeMessage(msg);
    expect(serialized.toolCalls).toHaveLength(1);
    expect(serialized.toolCalls![0].name).toBe("foo");
    const back = deserializeMessage(serialized);
    expect(back.toolCalls).toHaveLength(1);
    expect(back.toolCalls![0].name).toBe("foo");
    expect(back.toolCalls![0].arguments).toEqual({ x: 1 });
  });
});

// ---------------------------------------------------------------------------
// Checkpoint: state snapshot
// ---------------------------------------------------------------------------

describe("checkpointFromState / stateFromCheckpoint", () => {
  it("produces version-tagged checkpoint data", () => {
    const state = new AgentState({
      messages: [createMessage("user", "Hi")],
      toolSchemas: [],
      runId: "run-1",
      agentId: "agent-1",
    });
    state.addMessage(createMessage("assistant", "Hello"));
    const data = checkpointFromState(state);
    expect(data.version).toBe(CHECKPOINT_VERSION);
    expect(data.runId).toBe("run-1");
    expect(data.agentId).toBe("agent-1");
    expect(data.messages).toHaveLength(2);
    expect(data.transitionHistory).toEqual([]);
  });

  it("restores state from checkpoint data", () => {
    const state = new AgentState({
      messages: [createMessage("user", "Hi"), createMessage("assistant", "Hello")],
      toolSchemas: [{ name: "t", description: "d", parameters: {} }],
      runId: "run-2",
      agentId: "agent-2",
      model: "test-model",
    });
    state.iteration = 2;
    state.recordTransition("phase-a");
    state.recordTransition("phase-b");
    state.setExtension(TEST_EXT_KEY, new TestExtension("hello"));
    const data = checkpointFromState(state);
    const factories = new Map<string, StateExtensionFactory>([[TEST_EXT_KEY, testExtensionFactory]]);
    const restored = stateFromCheckpoint(data, factories);
    expect(restored.runId).toBe("run-2");
    expect(restored.messages).toHaveLength(2);
    expect(restored.toolSchemas).toHaveLength(1);
    expect(restored.iteration).toBe(2);
    expect(restored.getTransitionHistory()).toHaveLength(2);
    expect(restored.currentPhase).toBe("phase-b");
    const ext = restored.getExtension<TestExtension>(TEST_EXT_KEY);
    expect(ext).toBeDefined();
    expect(ext!.value).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// Checkpoint: JSON serialize/deserialize
// ---------------------------------------------------------------------------

describe("serializeCheckpoint / deserializeCheckpoint", () => {
  it("roundtrips checkpoint data as JSON", () => {
    const data: CheckpointData = {
      version: CHECKPOINT_VERSION,
      runId: "r1",
      agentId: "a1",
      iteration: 1,
      timestamp: new Date().toISOString(),
      messages: [{ role: "user", content: "Hi" }],
      toolSchemas: [],
      metadata: {},
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      metrics: {
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        llmCalls: 0,
        toolCalls: 0,
        estimatedCost: 0,
        llmLatency: 0,
        toolLatency: 0,
      },
      toolCallRecords: [],
      extensions: {},
      completed: false,
      output: "",
      model: "",
      maxIterations: 50,
      transitionHistory: [["phase1", 100]],
    };
    const json = serializeCheckpoint(data);
    expect(typeof json).toBe("string");
    const parsed = deserializeCheckpoint(json);
    expect(parsed.runId).toBe("r1");
    expect(parsed.transitionHistory).toHaveLength(1);
    expect(parsed.transitionHistory[0]).toEqual(["phase1", 100]);
  });
});

// ---------------------------------------------------------------------------
// AgentState: transition history
// ---------------------------------------------------------------------------

describe("AgentState transition history", () => {
  it("recordTransition and getTransitionHistory", () => {
    const state = new AgentState({ runId: "r" });
    expect(state.getTransitionHistory()).toEqual([]);
    state.recordTransition("a");
    state.recordTransition("b");
    const hist = state.getTransitionHistory();
    expect(hist).toHaveLength(2);
    expect(hist[0][0]).toBe("a");
    expect(hist[1][0]).toBe("b");
    expect(state.currentPhase).toBe("b");
  });

  it("setTransitionHistory restores and sets currentPhase", () => {
    const state = new AgentState({ runId: "r" });
    state.setTransitionHistory([
      ["x", 1],
      ["y", 2],
    ]);
    expect(state.getTransitionHistory()).toHaveLength(2);
    expect(state.currentPhase).toBe("y");
  });
});

// ---------------------------------------------------------------------------
// InMemoryStateStore
// ---------------------------------------------------------------------------

describe("InMemoryStateStore", () => {
  it("save and load roundtrip", async () => {
    const store = new InMemoryStateStore();
    const state = new AgentState({
      messages: [createMessage("user", "Hi")],
      toolSchemas: [],
      runId: "run-s1",
      agentId: "agent-s1",
    });
    state.addMessage(createMessage("assistant", "Hello"));
    await store.save(state);
    const loaded = await store.load("run-s1");
    expect(loaded).not.toBeNull();
    expect(loaded!.runId).toBe("run-s1");
    expect(loaded!.messages).toHaveLength(2);
  });

  it("load returns null for missing runId", async () => {
    const store = new InMemoryStateStore();
    const loaded = await store.load("nonexistent");
    expect(loaded).toBeNull();
  });

  it("list returns run IDs most recent first", async () => {
    const store = new InMemoryStateStore();
    const s1 = new AgentState({ runId: "r1", agentId: "a1" });
    const s2 = new AgentState({ runId: "r2", agentId: "a1" });
    await store.save(s1);
    await store.save(s2);
    const list = await store.list();
    expect(list).toContain("r1");
    expect(list).toContain("r2");
    const listA = await store.list("a1");
    expect(listA).toContain("r1");
    expect(listA).toContain("r2");
  });

  it("delete removes state", async () => {
    const store = new InMemoryStateStore();
    const state = new AgentState({ runId: "run-del", agentId: "a1" });
    await store.save(state);
    const deleted = await store.delete("run-del");
    expect(deleted).toBe(true);
    expect(await store.load("run-del")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FileStateStore
// ---------------------------------------------------------------------------

describe("FileStateStore", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "curio-state-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("save and load roundtrip", async () => {
    const store = new FileStateStore(tmpDir);
    const state = new AgentState({
      messages: [createMessage("user", "File test")],
      toolSchemas: [],
      runId: "run-f1",
      agentId: "agent-f1",
    });
    await store.save(state);
    const loaded = await store.load("run-f1");
    expect(loaded).not.toBeNull();
    expect(loaded!.runId).toBe("run-f1");
    expect(loaded!.messages).toHaveLength(1);
  });

  it("list filters by agentId", async () => {
    const store = new FileStateStore(tmpDir);
    await store.save(new AgentState({ runId: "f1", agentId: "a1" }));
    await store.save(new AgentState({ runId: "f2", agentId: "a2" }));
    const listA1 = await store.list("a1");
    expect(listA1).toContain("f1");
    expect(listA1).not.toContain("f2");
  });
});

// ---------------------------------------------------------------------------
// InMemorySessionStore & SessionManager
// ---------------------------------------------------------------------------

describe("InMemorySessionStore", () => {
  it("create returns session with id and agentId", async () => {
    const store = new InMemorySessionStore();
    const session = await store.create("agent-1", { key: "value" });
    expect(session.id).toBeDefined();
    expect(session.agentId).toBe("agent-1");
    expect(session.metadata).toEqual({ key: "value" });
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.updatedAt).toBeInstanceOf(Date);
  });

  it("get returns null for unknown session", async () => {
    const store = new InMemorySessionStore();
    expect(await store.get("unknown")).toBeNull();
  });

  it("addMessage and getMessages roundtrip", async () => {
    const store = new InMemorySessionStore();
    const session = await store.create("agent-1");
    await store.addMessage(session.id, createMessage("user", "Hi"));
    await store.addMessage(session.id, createMessage("assistant", "Hello"));
    const messages = await store.getMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("Hi");
    expect(messages[1].content).toBe("Hello");
  });

  it("list returns sessions for agentId", async () => {
    const store = new InMemorySessionStore();
    const s1 = await store.create("agent-1");
    const s2 = await store.create("agent-1");
    const list = await store.list("agent-1");
    expect(list.length).toBe(2);
    expect(list.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
  });

  it("delete removes session and messages", async () => {
    const store = new InMemorySessionStore();
    const session = await store.create("agent-1");
    await store.addMessage(session.id, createMessage("user", "Hi"));
    const deleted = await store.delete(session.id);
    expect(deleted).toBe(true);
    expect(await store.get(session.id)).toBeNull();
    expect(await store.getMessages(session.id)).toEqual([]);
  });
});

describe("SessionManager", () => {
  it("create, get, listSessions, delete", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);
    const session = await manager.create("agent-1");
    const got = await manager.get(session.id);
    expect(got.id).toBe(session.id);
    const list = await manager.listSessions("agent-1");
    expect(list.some((s) => s.id === session.id)).toBe(true);
    await manager.delete(session.id);
    await expect(manager.get(session.id)).rejects.toThrow(/not found/);
  });

  it("addMessage and getMessages", async () => {
    const manager = new SessionManager(new InMemorySessionStore());
    const session = await manager.create("agent-1");
    await manager.addMessage(session.id, createMessage("user", "Hello"));
    const messages = await manager.getMessages(session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Hello");
  });
});

describe("touchSession", () => {
  it("updates updatedAt", () => {
    const session = {
      id: "s1",
      agentId: "a1",
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(1000),
    };
    touchSession(session);
    expect(session.updatedAt.getTime()).toBeGreaterThanOrEqual(1000);
  });
});

// ---------------------------------------------------------------------------
// FileSessionStore
// ---------------------------------------------------------------------------

describe("FileSessionStore", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "curio-session-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("create and get roundtrip", async () => {
    const store = new FileSessionStore(tmpDir);
    const session = await store.create("agent-1", { meta: true });
    const got = await store.get(session.id);
    expect(got).not.toBeNull();
    expect(got!.agentId).toBe("agent-1");
    expect(got!.metadata).toEqual({ meta: true });
  });

  it("addMessage and getMessages", async () => {
    const store = new FileSessionStore(tmpDir);
    const session = await store.create("agent-1");
    await store.addMessage(session.id, createMessage("user", "File session msg"));
    const messages = await store.getMessages(session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("File session msg");
  });
});
