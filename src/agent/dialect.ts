// Fallback parser for models that cannot emit native tool calls. Parsing only
// decides what the model asked for; the engine still adjudicates it. Malformed
// payloads are stripped and never executed.

import type { ChatToolCall } from "./types.js";

export interface ParsedInline {
  calls: ChatToolCall[];
  cleaned: string;
  broken: boolean;
}

type Resolver = (name: string) => string | undefined;

function payloadCalls(payload: unknown, resolve: Resolver, startId: number): ChatToolCall[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((item, index) => payloadCalls(item, resolve, startId + index));
  }
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const name =
    typeof record.tool === "string"
      ? record.tool
      : typeof record.name === "string"
        ? record.name
        : typeof record.action === "string"
          ? record.action
          : undefined;
  if (!name) return [];
  const args =
    record.arguments && typeof record.arguments === "object"
      ? (record.arguments as Record<string, unknown>)
      : record.parameters && typeof record.parameters === "object"
        ? (record.parameters as Record<string, unknown>)
        : record.params && typeof record.params === "object"
          ? (record.params as Record<string, unknown>)
          : {};
  return [{ id: `inline-${startId}`, name: resolve(name) ?? name, arguments: args }];
}

export function parseInlineToolCalls(
  content: string,
  resolve: Resolver = (name) => name
): ParsedInline {
  let cleaned = content;
  let broken = false;
  const calls: ChatToolCall[] = [];

  const collect = (block: string): void => {
    try {
      const parsed = JSON.parse(block) as unknown;
      calls.push(...payloadCalls(parsed, resolve, calls.length + 1));
    } catch {
      broken = true;
    }
  };

  cleaned = cleaned.replace(/```(?:json|tool)?\s*([\s\S]*?)```/gi, (match, body: string) => {
    if (/\btool\b|\bname\b|\baction\b/.test(body)) {
      collect(body.trim());
      return "";
    }
    return match;
  });

  cleaned = cleaned.replace(/<tool_call([^>]*)>([\s\S]*?)<\/tool_call>/gi, (_match, attrs: string, body: string) => {
    const attrName = /name\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (attrName) {
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(body.trim()) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        broken = true;
      }
      calls.push({
        id: `inline-${calls.length + 1}`,
        name: resolve(attrName) ?? attrName,
        arguments: args
      });
    } else {
      collect(body.trim());
    }
    return "";
  });

  cleaned = cleaned.replace(
    /<invoke\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/invoke>/gi,
    (_match, name: string, body: string) => {
      const args: Record<string, unknown> = {};
      const parameter = /<parameter\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/gi;
      let found = false;
      for (const item of body.matchAll(parameter)) {
        found = true;
        args[item[1] as string] = item[2]?.trim() ?? "";
      }
      if (!found) broken = true;
      calls.push({
        id: `inline-${calls.length + 1}`,
        name: resolve(name) ?? name,
        arguments: args
      });
      return "";
    }
  );

  return { calls, cleaned: cleaned.trim(), broken };
}
