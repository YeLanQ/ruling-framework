// Deterministic provider used by demos and tests. It proves the framework's
// behavior without an API key or network access.

import type { ChatProvider, ChatRequest, ChatResponse, ChatToolCall } from "./types.js";

export interface MockTurn {
  content?: string;
  toolCalls?: Array<{ name: string; arguments?: Record<string, unknown> }>;
}

export class MockProvider implements ChatProvider {
  private index = 0;
  readonly requests: ChatRequest[] = [];

  constructor(private readonly turns: MockTurn[]) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);
    const turn = this.turns[this.index];
    this.index += 1;
    if (!turn) {
      return { content: "(mock provider exhausted)", toolCalls: [] };
    }
    const toolCalls: ChatToolCall[] = (turn.toolCalls ?? []).map((call, index) => ({
      id: `mock-${this.index}-${index}`,
      name: call.name,
      arguments: call.arguments ?? {}
    }));
    return { content: turn.content ?? "", toolCalls };
  }
}

export function toolCall(name: string, args: Record<string, unknown> = {}): MockTurn {
  return { toolCalls: [{ name, arguments: args }] };
}

export function text(content: string): MockTurn {
  return { content };
}
