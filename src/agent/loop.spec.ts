import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createEngineForPack } from "../packs/loader.js";
import { tempDir } from "../test-support/temp.js";
import { runAgent } from "./loop.js";
import { MockProvider, text, toolCall } from "./mock-provider.js";
import type { AgentEvent, ChatMessage } from "./types.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function opc() {
  const temp = tempDir("ruling-loop-");
  cleanups.push(temp.cleanup);
  const { engine } = createEngineForPack("opc", { workspace: { root: temp.path } });
  return { root: temp.path, engine };
}

describe("agent loop", () => {
  it("bypasses the LLM for a unique high-confidence green action", async () => {
    const { engine } = opc();
    const provider = new MockProvider([]);
    const result = await runAgent({
      provider,
      model: "mock",
      task: "查看工作区",
      engine,
      trust: "agent"
    });
    expect(result.stoppedReason).toBe("direct");
    expect(provider.requests).toHaveLength(0);
  });

  it("returns suggestions for an advisory task without calling the model", async () => {
    const { engine } = opc();
    const provider = new MockProvider([]);
    const result = await runAgent({
      provider,
      model: "mock",
      task: "如何交付",
      engine,
      trust: "agent"
    });
    expect(result.mode).toBe("suggest");
    expect(result.stoppedReason).toBe("suggestion");
    expect(result.suggestions?.length).toBeGreaterThan(0);
    expect(provider.requests).toHaveLength(0);
  });

  it("stops ambiguous tasks for clarification without calling the model", async () => {
    const { engine } = opc();
    const provider = new MockProvider([]);
    const result = await runAgent({
      provider,
      model: "mock",
      task: "写文档或者构建",
      engine,
      trust: "agent"
    });
    expect(result.mode).toBe("fuzzy");
    expect(result.stoppedReason).toBe("needs-clarification");
    expect(result.ambiguities?.length).toBeGreaterThan(0);
    expect(provider.requests).toHaveLength(0);
  });

  it("re-plans after a clarification answer", async () => {
    const { root, engine } = opc();
    const provider = new MockProvider([
      toolCall("doc_write", { path: "a.md", content: "x" }),
      text("完成")
    ]);
    const result = await runAgent({
      provider,
      model: "mock",
      task: "写文档或者构建",
      engine,
      trust: "agent",
      onClarify: () => "写文档",
      onConfirm: () => true
    });
    expect(result.stoppedReason).toBe("done");
    expect(existsSync(join(root, "a.md"))).toBe(true);
  });

  it("runs NormSpec before planning when normalization is enabled", async () => {
    const { root, engine } = opc();
    const provider = new MockProvider([
      text(
        JSON.stringify({
          taskType: "edit",
          taskDescription: "写交付文档",
          anchors: ["交付"],
          fileRefs: [],
          ambiguities: [],
          confidence: 0.9
        })
      ),
      toolCall("doc_write", { path: "normalized.md", content: "x" }),
      text("完成")
    ]);
    const result = await runAgent({
      provider,
      model: "mock",
      task: "把交付弄一下",
      engine,
      trust: "agent",
      normalize: true,
      onConfirm: () => true
    });
    expect(result.normalized?.taskDescription).toBe("写交付文档");
    expect(result.stoppedReason).toBe("done");
    expect(existsSync(join(root, "normalized.md"))).toBe(true);
  });

  it("executes a tool after human approval and then finishes", async () => {
    const { root, engine } = opc();
    const provider = new MockProvider([
      toolCall("doc_write", { path: "a.md", content: "x" }),
      text("完成")
    ]);
    const events: AgentEvent[] = [];
    const result = await runAgent({
      provider,
      model: "mock",
      task: "写入文档",
      engine,
      trust: "agent",
      onConfirm: () => true,
      onEvent: (event) => events.push(event)
    });
    expect(result.stoppedReason).toBe("done");
    expect(result.toolCalls).toBe(1);
    expect(existsSync(join(root, "a.md"))).toBe(true);
    expect(events.some((event) => event.type === "confirm")).toBe(true);
  });

  it("does not execute when the human rejects", async () => {
    const { root, engine } = opc();
    const provider = new MockProvider([
      toolCall("doc_write", { path: "a.md", content: "x" }),
      text("未执行")
    ]);
    const result = await runAgent({
      provider,
      model: "mock",
      task: "写入文档",
      engine,
      trust: "agent",
      onConfirm: () => false
    });
    expect(result.stoppedReason).toBe("done");
    expect(existsSync(join(root, "a.md"))).toBe(false);
  });

  it("pulls back a zero-tool completion claim", async () => {
    const { engine } = opc();
    const provider = new MockProvider([text("已完成"), text("已完成"), text("已完成")]);
    const events: AgentEvent[] = [];
    const result = await runAgent({
      provider,
      model: "mock",
      task: "写入文档",
      engine,
      trust: "agent",
      onEvent: (event) => events.push(event)
    });
    expect(result.stoppedReason).toBe("done");
    expect(provider.requests).toHaveLength(3);
    expect(events.filter((event) => event.type === "guard")).toHaveLength(2);
  });

  it("stops at the round limit", async () => {
    const { engine } = opc();
    const provider = new MockProvider([toolCall("workspace_list"), toolCall("workspace_list")]);
    const result = await runAgent({
      provider,
      model: "mock",
      task: "写入文档",
      engine,
      trust: "agent",
      maxRounds: 2
    });
    expect(result.stoppedReason).toBe("max-rounds");
    expect(result.rounds).toBe(2);
  });

  it("short-circuits the same failing call", async () => {
    const { engine } = opc();
    const args = { path: "a.md", content: "x" };
    const provider = new MockProvider([toolCall("doc_write", args), toolCall("doc_write", args)]);
    const result = await runAgent({
      provider,
      model: "mock",
      task: "写入文档",
      engine,
      trust: "agent",
      onConfirm: () => false
    });
    expect(result.stoppedReason).toBe("repeated-failure");
  });

  it("trims session history to the context budget", async () => {
    const { engine } = opc();
    const history: ChatMessage[] = Array.from({ length: 40 }, (_, index) => ({
      role: "user" as const,
      content: `old-${index}-${"x".repeat(5000)}`
    }));
    const provider = new MockProvider([text("ok")]);
    await runAgent({
      provider,
      model: "mock",
      task: "读取文件",
      engine,
      trust: "agent",
      contextK: 1,
      session: {
        id: "budget",
        store: { load: () => history, save: () => undefined }
      }
    });
    expect(provider.requests[0]?.messages.length).toBeLessThan(10);
  });
});
