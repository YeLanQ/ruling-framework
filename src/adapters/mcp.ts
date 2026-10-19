// Minimal MCP server over stdio (JSON-RPC 2.0). It exposes only the granted
// action surface. It deliberately does not expose an approval tool: approval
// is a human act and must come from the CLI or HTTP, never from the model.

import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import type { RulingEngine } from "../core/engine.js";
import type { TrustMode } from "../core/types.js";
import { toToolName } from "../agent/tool-names.js";

export interface McpOptions {
  input: Readable;
  output: Writable;
  trust?: TrustMode;
  role?: string;
}

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const PROTOCOL_VERSION = "2024-11-05";

export class McpServer {
  private readonly trust: TrustMode;
  private readonly role: string;

  constructor(
    private readonly engine: RulingEngine,
    private readonly options: McpOptions
  ) {
    this.trust = options.trust ?? "operator";
    this.role = options.role ?? engine.surface.defaultRole;
  }

  start(): Promise<void> {
    const lines = createInterface({ input: this.options.input });
    let pending: Promise<void> = Promise.resolve();
    lines.on("line", (line) => {
      if (!line.trim()) return;
      pending = pending.then(() => this.handleLine(line));
    });
    return new Promise<void>((resolve) => {
      lines.on("close", () => {
        void pending.then(() => {
          resolve();
        });
      });
    });
  }

  async handleLine(line: string): Promise<void> {
    let request: RpcRequest;
    try {
      request = JSON.parse(line) as RpcRequest;
    } catch {
      this.write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      return;
    }
    const response = await this.handle(request);
    if (response !== undefined) this.write(response);
  }

  async handle(request: RpcRequest): Promise<unknown> {
    const id = request.id ?? null;
    try {
      switch (request.method) {
        case "initialize":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: { name: "ruling-framework", version: "0.1.0" }
            }
          };
        case "notifications/initialized":
          return undefined;
        case "ping":
          return { jsonrpc: "2.0", id, result: {} };
        case "tools/list":
          return { jsonrpc: "2.0", id, result: { tools: this.tools() } };
        case "tools/call":
          return { jsonrpc: "2.0", id, result: await this.callTool(request.params) };
        default:
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `method not found: ${request.method}` }
          };
      }
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  private grantedSpecs() {
    const grants = this.engine.surface.grants[this.role] ?? [];
    return this.engine.surface.catalog
      .specs()
      .filter(
        (spec) => grants.includes("*") || grants.includes(spec.group) || grants.includes(spec.id)
      );
  }

  private tools(): Array<{ name: string; description: string; inputSchema?: unknown }> {
    return this.grantedSpecs().map((spec) => ({
      name: toToolName(spec.id),
      description: `${spec.title} — ${spec.description}（区域：${spec.zone}）`,
      inputSchema: spec.inputSchema ?? { type: "object", properties: {} }
    }));
  }

  private async callTool(params: Record<string, unknown> | undefined): Promise<unknown> {
    const name = typeof params?.name === "string" ? params.name : "";
    const spec = this.grantedSpecs().find((candidate) => toToolName(candidate.id) === name);
    if (!spec) {
      return {
        content: [{ type: "text", text: `未知工具：${name}` }],
        isError: true
      };
    }
    const args =
      params?.arguments && typeof params.arguments === "object"
        ? { ...(params.arguments as Record<string, unknown>) }
        : {};
    const task = typeof args.__task === "string" ? args.__task.trim() : "";
    delete args.__task;
    if (!task) {
      return {
        content: [
          {
            type: "text",
            text: "缺少 __task：MCP 调用必须携带 __task 作为审批键，不能省略。"
          }
        ],
        isError: true
      };
    }

    const outcome = await this.engine.execute({
      task,
      action: spec.id,
      params: args,
      trust: this.trust,
      actor: { role: this.role },
      source: "mcp"
    });
    const hint =
      outcome.status === "needConfirm"
        ? "需要人工批准。MCP 不暴露 approve 工具；请对同一运行进程使用 HTTP POST /approve，或在 CLI 中使用 --yes。"
        : undefined;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ...outcome, ...(hint ? { hint } : {}) }, null, 2)
        }
      ],
      isError: outcome.status !== "ok"
    };
  }

  private write(payload: unknown): void {
    this.options.output.write(`${JSON.stringify(payload)}\n`);
  }
}

export function createMcpServer(engine: RulingEngine, options: McpOptions): McpServer {
  return new McpServer(engine, options);
}
