// A deterministic stand-in for `ruling ask --mock`. It reads the brain-first
// candidate list from the system prompt and proposes the top action once.
// Useful for smoke tests without an API key; it is not a model.

import type { ChatProvider, ChatRequest, ChatResponse } from "./types.js";
import { toToolName } from "./tool-names.js";

const DEFAULT_PARAMS: Record<string, Record<string, unknown>> = {
  "workspace.read": { path: "README.md" },
  "doc.read": { path: "README.md" },
  "design.read": { id: "demo" },
  "design.create": { id: "demo", name: "Demo" }
};

export class HeuristicProvider implements ChatProvider {
  private step = 0;

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.step += 1;
    if (this.step > 1) {
      return { content: "（启发式 Provider：已发起一次提议。）", toolCalls: [] };
    }
    const system = request.messages.find((message) => message.role === "system")?.content ?? "";
    const match = /候选动作：([A-Za-z0-9_.-]+)\(/.exec(system);
    if (!match?.[1]) {
      return { content: "没有匹配到候选动作。", toolCalls: [] };
    }
    const action = match[1];
    return {
      content: "",
      toolCalls: [
        {
          id: "heuristic-1",
          name: toToolName(action),
          arguments: DEFAULT_PARAMS[action] ?? {}
        }
      ]
    };
  }
}
