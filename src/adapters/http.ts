// Local HTTP adapter. It binds loopback only. The optional token header is a
// convenience for local scripts, not an authentication boundary.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { RulingEngine } from "../core/engine.js";
import type { ExecuteRequest } from "../core/types.js";

const MAX_BODY_BYTES = 1024 * 1024;

export interface HttpOptions {
  token?: string;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text)
  });
  response.end(text);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const raw: unknown = chunk;
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(new TextEncoder().encode(String(raw)));
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("请求体超过 1MB 上限");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function catalog(engine: RulingEngine): unknown {
  return {
    pack: { id: engine.surface.id, name: engine.surface.name },
    defaultRole: engine.surface.defaultRole,
    roles: Object.keys(engine.surface.grants),
    grants: engine.surface.grants,
    actions: engine.surface.catalog.specs(),
    stats: engine.stats()
  };
}

export function createHttpServer(engine: RulingEngine, options: HttpOptions = {}): Server {
  return createServer((request, response) => {
    void handleRequest(engine, options, request, response);
  });
}

async function handleRequest(
  engine: RulingEngine,
  options: HttpOptions,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  try {
    if (options.token) {
        const token = request.headers["x-ruling-token"];
        if (token !== options.token) {
          send(response, 401, { error: "token mismatch" });
          return;
        }
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") {
        send(response, 200, { ok: true, pack: engine.surface.id });
        return;
      }
      if (request.method === "GET" && url.pathname === "/catalog") {
        send(response, 200, catalog(engine));
        return;
      }
      if (request.method === "GET" && url.pathname === "/stats") {
        send(response, 200, engine.stats());
        return;
      }
      if (request.method === "GET" && url.pathname === "/audit") {
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? 50)));
        send(response, 200, { entries: engine.audit.entries().slice(-limit) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/approve") {
        const body = JSON.parse(await readBody(request)) as { task?: string; role?: string };
        if (!body.task) {
          send(response, 400, { error: "task is required" });
          return;
        }
        engine.approve(body.task, body.role);
        send(response, 200, { approved: true, task: body.task, role: body.role ?? engine.surface.defaultRole });
        return;
      }
      if (request.method === "POST" && url.pathname === "/execute") {
        const body = JSON.parse(await readBody(request)) as Partial<ExecuteRequest>;
        if (!body.task || !body.action) {
          send(response, 400, { error: "task and action are required" });
          return;
        }
        const outcome = await engine.execute({
          task: body.task,
          action: body.action,
          params: body.params,
          trust: body.trust ?? "operator",
          actor: body.actor,
          source: "http"
        });
        send(response, outcome.status === "ok" ? 200 : 409, outcome);
        return;
      }
      send(response, 404, { error: "not found" });
    } catch (error) {
      send(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
}

export async function startHttpServer(
  engine: RulingEngine,
  options: HttpOptions & { port?: number } = {}
): Promise<{ server: Server; url: string }> {
  const server = createHttpServer(engine, options);
  const port = options.port ?? 39100;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve();
    });
  });
  const address = server.address();
  const actual = typeof address === "object" && address ? address.port : port;
  return { server, url: `http://127.0.0.1:${actual}` };
}
