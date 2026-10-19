// Proposal-layer contracts. The model produces text and tool proposals; it
// never receives an approval tool and never executes anything directly.

import type { JsonSchema, TrustMode } from "../core/types.js";

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ChatToolCall[];
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: JsonSchema;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
}

export interface ChatResponse {
  content: string;
  toolCalls: ChatToolCall[];
}

export interface ChatProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export interface ConfirmRequest {
  task: string;
  action: string;
  params: Record<string, unknown>;
  zone: string;
  reason: string;
}

export type AgentEvent =
  | { type: "text"; content: string }
  | { type: "tool"; action: string; status: string; reason: string }
  | { type: "confirm"; request: ConfirmRequest }
  | { type: "guard"; message: string }
  | { type: "done"; content: string }
  | { type: "error"; message: string };

export interface AgentSessionRef {
  id: string;
  store: { load(id: string): ChatMessage[]; save(id: string, messages: ChatMessage[]): void };
}

export interface AgentOptions {
  provider: ChatProvider;
  model: string;
  task: string;
  engine: import("../core/engine.js").RulingEngine;
  trust: TrustMode;
  role?: string;
  maxRounds?: number;
  contextK?: number;
  /** Default true: a unique high-confidence green action bypasses the LLM. */
  allowDirect?: boolean;
  onConfirm?: (request: ConfirmRequest) => Promise<boolean> | boolean;
  onEvent?: (event: AgentEvent) => void;
  session?: AgentSessionRef;
}

export interface AgentResult {
  content: string;
  rounds: number;
  toolCalls: number;
  stoppedReason: "done" | "direct" | "max-rounds" | "repeated-failure" | "error";
}
