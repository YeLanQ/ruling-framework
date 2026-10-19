import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { OpenAICompatibleProvider } from "./provider.js";

let server: Server | undefined;
afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
});

async function start(
  handler: (body: Record<string, unknown>, count: number) => { status: number; body: unknown }
): Promise<string> {
  let count = 0;
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    count += 1;
    const result = handler(body, count);
    response.writeHead(result.status, { "content-type": "application/json" });
    response.end(JSON.stringify(result.body));
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return `http://127.0.0.1:${port}/v1`;
}

describe("OpenAICompatibleProvider", () => {
  it("parses content and native tool calls", async () => {
    const baseUrl = await start(() => ({
      status: 200,
      body: {
        choices: [
          {
            message: {
              content: "hello",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: { name: "doc_write", arguments: '{"path":"a.md"}' }
                }
              ]
            }
          }
        ]
      }
    }));
    const provider = new OpenAICompatibleProvider({ baseUrl });
    const response = await provider.chat({
      model: "test",
      messages: [{ role: "user", content: "hi" }]
    });
    expect(response.content).toBe("hello");
    expect(response.toolCalls[0]).toMatchObject({ name: "doc_write", arguments: { path: "a.md" } });
  });

  it("retries once without tools on 400", async () => {
    const bodies: Record<string, unknown>[] = [];
    const baseUrl = await start((body) => {
      bodies.push(body);
      if (body.tools) return { status: 400, body: { error: "tools not supported" } };
      return { status: 200, body: { choices: [{ message: { content: "ok" } }] } };
    });
    const provider = new OpenAICompatibleProvider({ baseUrl });
    const response = await provider.chat({
      model: "test",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "doc_write", description: "write" }]
    });
    expect(response.content).toBe("ok");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.tools).toBeDefined();
    expect(bodies[1]?.tools).toBeUndefined();
  });

  it("reports a clear error for a non-retryable failure", async () => {
    const baseUrl = await start(() => ({ status: 500, body: { error: "boom" } }));
    const provider = new OpenAICompatibleProvider({ baseUrl });
    await expect(
      provider.chat({ model: "test", messages: [{ role: "user", content: "hi" }] })
    ).rejects.toThrow("LLM 请求失败（500）");
  });
});
