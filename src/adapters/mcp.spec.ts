import { existsSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { createEngineForPack } from "../packs/loader.js";
import { tempDir } from "../test-support/temp.js";
import { createMcpServer } from "./mcp.js";
import type { TrustMode } from "../core/types.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function setup(pack = "opc", trust: TrustMode = "operator", role?: string) {
  const temp = tempDir("ruling-mcp-");
  cleanups.push(temp.cleanup);
  const { engine } = createEngineForPack(pack, { workspace: { root: temp.path } });
  const server = createMcpServer(engine, {
    input: new PassThrough(),
    output: new PassThrough(),
    trust,
    role
  });
  return { root: temp.path, engine, server };
}

type RpcResult = { result?: Record<string, unknown>; error?: { code: number } };

async function call(
  server: ReturnType<typeof createMcpServer>,
  method: string,
  params?: Record<string, unknown>
): Promise<RpcResult> {
  return (await server.handle({ jsonrpc: "2.0", id: 1, method, params })) as RpcResult;
}

describe("MCP adapter", () => {
  it("initializes and lists granted tools", async () => {
    const { server } = setup();
    const init = await call(server, "initialize");
    expect(init.result?.protocolVersion).toBe("2024-11-05");

    const list = await call(server, "tools/list");
    const tools = (list.result?.tools ?? []) as Array<{ name: string }>;
    expect(tools.some((tool) => tool.name === "doc_write")).toBe(true);
    expect(tools.some((tool) => /approve/i.test(tool.name))).toBe(false);
  });

  it("executes a granted tool under operator trust", async () => {
    const { root, server } = setup();
    const result = await call(server, "tools/call", {
      name: "doc_write",
      arguments: { path: "a.md", content: "x", __task: "写说明" }
    });
    const content = (result.result?.content ?? []) as Array<{ text: string }>;
    expect(JSON.parse(content[0]?.text ?? "{}")).toMatchObject({ status: "ok" });
    expect(existsSync(join(root, "a.md"))).toBe(true);
  });

  it("returns needConfirm under agent trust and never exposes approval", async () => {
    const { server } = setup("opc", "agent");
    const result = await call(server, "tools/call", {
      name: "doc_write",
      arguments: { path: "a.md", content: "x", __task: "写说明" }
    });
    const content = (result.result?.content ?? []) as Array<{ text: string }>;
    const payload = JSON.parse(content[0]?.text ?? "{}") as { status: string; hint?: string };
    expect(payload.status).toBe("needConfirm");
    expect(payload.hint).toContain("HTTP POST /approve");
  });

  it("only lists tools granted to the configured role", async () => {
    const { server } = setup("smb", "operator", "viewer");
    const list = await call(server, "tools/list");
    const names = ((list.result?.tools ?? []) as Array<{ name: string }>).map((tool) => tool.name);
    expect(names).toContain("workspace_list");
    expect(names).not.toContain("doc_write");
  });

  it("rejects a tool call without __task instead of sharing a coarse approval key", async () => {
    const { server } = setup("opc", "agent");
    const result = await call(server, "tools/call", {
      name: "doc_write",
      arguments: { path: "a.md", content: "x" }
    });
    const content = (result.result?.content ?? []) as Array<{ text: string }>;
    expect(result.result?.isError).toBe(true);
    expect(content[0]?.text).toContain("__task");
  });
});
