// Non-adjudicative language normalization (NormSpec). This is the only model
// use before the main reasoning pass: it structures the user's wording, makes
// no decision, never calls a tool, and fails open to the rule-based path.

import type {
  NormalizedTask,
  NormalizedTaskType
} from "../core/types.js";
import type { ChatProvider } from "./types.js";

const TASK_TYPES: NormalizedTaskType[] = [
  "query",
  "edit",
  "create",
  "delete",
  "build",
  "analyze",
  "chat"
];

const PROMPT = `你只做语言归一化，不做决策，不调用工具，不补充用户没说的信息。
把用户输入转写为 JSON：
{
  "taskType": "query|edit|create|delete|build|analyze|chat",
  "taskDescription": "保留原意、去掉口语噪声后的任务描述",
  "anchors": ["用户明确提到的对象、关键词"],
  "fileRefs": ["用户明确提到的相对文件路径"],
  "ambiguities": ["仍然不明确的地方"],
  "confidence": 0.0
}
规则：
- 只输出 JSON，不要 Markdown、解释或工具调用；
- 不要猜测文件路径，不要读取文件，不要虚构对象；
- 不确定的数组就写空数组；
- confidence 是归一化置信度，不是执行许可。`;

export interface NormalizeOptions {
  /** Verify existence only; never read file contents. */
  fileExists?: (path: string) => Promise<boolean>;
  maxFileRefs?: number;
}

function extractJson(text: string): Record<string, unknown> | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function normalizeTaskSpec(
  provider: ChatProvider,
  model: string,
  task: string,
  options: NormalizeOptions = {}
): Promise<NormalizedTask | undefined> {
  try {
    const response = await provider.chat({
      model,
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: task }
      ],
      temperature: 0
    });
    const payload = extractJson(response.content);
    if (!payload) return undefined;

    const description =
      typeof payload.taskDescription === "string" ? payload.taskDescription.trim() : "";
    if (!description) return undefined;

    const taskType = TASK_TYPES.includes(payload.taskType as NormalizedTaskType)
      ? (payload.taskType as NormalizedTaskType)
      : "chat";
    const anchors = stringArray(payload.anchors).slice(0, 20);
    let fileRefs = stringArray(payload.fileRefs).slice(0, options.maxFileRefs ?? 10);
    if (options.fileExists && fileRefs.length > 0) {
      const kept: string[] = [];
      for (const ref of fileRefs) {
        if (await options.fileExists(ref)) kept.push(ref);
      }
      fileRefs = kept;
    }
    const ambiguities = stringArray(payload.ambiguities).slice(0, 10);
    const confidence =
      typeof payload.confidence === "number"
        ? Math.max(0, Math.min(1, payload.confidence))
        : 0.5;

    return { taskType, taskDescription: description, anchors, fileRefs, ambiguities, confidence };
  } catch {
    // Normalization is allowed to fail; the rule-based path takes over.
    return undefined;
  }
}
