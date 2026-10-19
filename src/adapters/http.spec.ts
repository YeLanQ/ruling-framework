import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createEngineForPack } from "../packs/loader.js";
import { tempDir } from "../test-support/temp.js";
import { startHttpServer } from "./http.js";

const cleanups: Array<() => void> = [];
const servers: Server[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  }
  while (cleanups.length > 0) cleanups.pop()?.();
});

async function setup(token?: string) {
  const temp = tempDir("ruling-http-");
  cleanups.push(temp.cleanup);
  const { engine } = createEngineForPack("opc", { workspace: { root: temp.path } });
  const { server, url } = await startHttpServer(engine, { port: 0, token });
  servers.push(server);
  return { root: temp.path, engine, url };
}

async function get(url: string, token?: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    headers: token ? { "x-ruling-token": token } : {}
  });
  return { status: response.status, body: await response.json() };
}

async function post(url: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

describe("HTTP adapter", () => {
  it("binds loopback and serves health/catalog/stats", async () => {
    const { url } = await setup();
    expect(url).toContain("127.0.0.1");
    const health = await get(`${url}/health`);
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, pack: "opc" });

    const catalog = await get(`${url}/catalog`);
    expect(catalog.status).toBe(200);
    const actions = (catalog.body as { actions: unknown[] }).actions;
    expect(actions.length).toBeGreaterThan(10);

    const stats = await get(`${url}/stats`);
    expect(stats.status).toBe(200);
  });

  it("executes an operator write without per-action approval", async () => {
    const { root, url } = await setup();
    const result = await post(`${url}/execute`, {
      task: "写说明",
      action: "doc.write",
      params: { path: "a.md", content: "x" },
      trust: "operator"
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: "ok", decision: "autoExecute" });
    expect(await get(`${url}/audit`)).toMatchObject({ status: 200 });
    expect(root).toContain("ruling-http-");
  });

  it("returns needConfirm for an agent write, then executes after /approve", async () => {
    const { url } = await setup();
    const body = {
      task: "写说明",
      action: "doc.write",
      params: { path: "a.md", content: "x" },
      trust: "agent"
    };
    const first = await post(`${url}/execute`, body);
    expect(first.status).toBe(409);
    expect(first.body).toMatchObject({ status: "needConfirm" });

    const approval = await post(`${url}/approve`, { task: "写说明", role: "owner" });
    expect(approval.status).toBe(200);

    const second = await post(`${url}/execute`, body);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ status: "ok" });
  });

  it("rejects an invalid trust mode instead of silently downgrading", async () => {
    const { url } = await setup();
    const result = await post(`${url}/execute`, {
      task: "查看",
      action: "workspace.list",
      trust: "bogus"
    });
    expect(result.status).toBe(400);
  });

  it("checks the optional local token header", async () => {
    const { url } = await setup("secret");
    expect((await get(`${url}/health`)).status).toBe(401);
    expect((await get(`${url}/health`, "secret")).status).toBe(200);
  });
});
