// OpenAI-compatible chat provider with native tool calls and a single
// tools-less retry for endpoints that reject the tools field.

import type {
  ChatMessage,
  ChatProvider,
  ChatRequest,
  ChatResponse,
  ChatToolCall,
  ToolDefinition
} from "./types.js";

export interface ProviderOptions {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) }
      }))
    };
  }
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  return { role: message.role, content: message.content };
}

function toWireTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: "object", properties: {} }
    }
  };
}

function parseCalls(raw: unknown): ChatToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: ChatToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const fn = record.function as Record<string, unknown> | undefined;
    if (!fn || typeof fn.name !== "string") continue;
    let args: Record<string, unknown> = {};
    if (typeof fn.arguments === "string" && fn.arguments.trim()) {
      try {
        const parsed = JSON.parse(fn.arguments) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        // A malformed payload is not executed; the loop receives empty args.
      }
    }
    calls.push({
      id: typeof record.id === "string" ? record.id : `call-${calls.length + 1}`,
      name: fn.name,
      arguments: args
    });
  }
  return calls;
}

export class OpenAICompatibleProvider implements ChatProvider {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(options: ProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map(toWireMessage),
      temperature: request.temperature ?? 0.2,
      stream: false
    };
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(toWireTool);
    }

    const first = await this.post(body);
    if (first.ok) return this.parse(first.json);

    if ((first.status === 400 || first.status === 422) && body.tools) {
      delete body.tools;
      const retry = await this.post(body);
      if (retry.ok) return this.parse(retry.json);
      throw new Error(`LLM 请求失败（${retry.status}）：${retry.text.slice(0, 500)}`);
    }
    throw new Error(`LLM 请求失败（${first.status}）：${first.text.slice(0, 500)}`);
  }

  private async post(body: Record<string, unknown>): Promise<{
    ok: boolean;
    status: number;
    json?: unknown;
    text: string;
  }> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status, text };
    try {
      return { ok: true, status: response.status, json: JSON.parse(text), text };
    } catch {
      return { ok: false, status: response.status, text: `非 JSON 响应：${text.slice(0, 300)}` };
    }
  }

  private parse(json: unknown): ChatResponse {
    const root = json as Record<string, unknown>;
    const choices = root.choices as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    const content =
      typeof message?.content === "string"
        ? message.content
        : Array.isArray(message?.content)
          ? message.content
              .map((part) =>
                part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string"
                  ? String((part as Record<string, unknown>).text)
                  : ""
              )
              .join("")
          : "";
    return {
      content,
      toolCalls: parseCalls(message?.tool_calls)
    };
  }
}

export function providerFromEnv(overrides: Partial<ProviderOptions> = {}): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    baseUrl: overrides.baseUrl ?? process.env.RULING_BASE_URL ?? "https://api.openai.com/v1",
    apiKey: overrides.apiKey ?? process.env.RULING_API_KEY ?? undefined,
    model: overrides.model ?? process.env.RULING_MODEL ?? "gpt-4o-mini",
    timeoutMs: overrides.timeoutMs
  });
}
