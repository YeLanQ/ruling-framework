// Context budget and completion heuristics for the proposal loop.

import type { ChatMessage } from "./types.js";

export const DEFAULT_MAX_ROUNDS = 24;
export const DEFAULT_CONTEXT_K = 128;
export const CHARS_PER_TOKEN = 1.5;
export const MAX_TOOL_RESULT = 4000;

export function looksLikeCompletion(text: string): boolean {
  return /已完成|完成了|搞定了|已处理|done|finished|complete/i.test(text);
}

export function fitMessages(messages: ChatMessage[], contextK: number): ChatMessage[] {
  const budget = contextK * 1000 * CHARS_PER_TOKEN;
  let total = 0;
  const kept: ChatMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const size = message.content.length + (message.toolCalls?.length ?? 0) * 120;
    if (message.role === "system") {
      kept.unshift(message);
      continue;
    }
    if (total + size > budget && kept.some((item) => item.role !== "system")) continue;
    total += size;
    kept.unshift(message);
  }
  return kept;
}
