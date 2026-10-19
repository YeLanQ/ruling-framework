// System prompt for the proposal layer. It states the governing rule plainly:
// the model proposes, the deterministic engine adjudicates and executes.

import type { PreparedContext } from "../core/types.js";
import type { ToolDefinition } from "./types.js";

export interface PromptInput {
  packName: string;
  task: string;
  prepared: PreparedContext;
  tools: ToolDefinition[];
  trust: string;
  role: string;
}

export function buildSystemPrompt(input: PromptInput): string {
  const { packName, task, prepared, tools, trust, role } = input;
  const lines: string[] = [];
  lines.push(`你是 ${packName} 行业的「提议层」，不是裁决层，也不是执行层。`);
  lines.push("规则：");
  lines.push("- 你只能提出要调用哪个动作、传什么参数；能否执行由后端裁定。");
  lines.push("- 你没有批准权。needConfirm 表示必须等人类批准；deny 表示禁止，不能绕过。");
  lines.push("- 未在工具清单中的动作不存在，不要编造。");
  lines.push("- 写操作前先读；不要声称完成，除非工具结果确认成功。");
  lines.push(`当前信任模式：${trust}；当前角色：${role}。`);
  lines.push("");
  lines.push(`用户任务：${task}`);
  lines.push("");
  lines.push("大脑前置结果（确定性，不来自模型）：");
  lines.push(`- 分段：${prepared.segments.map((segment) => `「${segment}」`).join(" / ") || "（无）"}`);
  if (prepared.candidates.length > 0) {
    lines.push(
      `- 候选动作：${prepared.candidates
        .slice(0, 6)
        .map((candidate) => `${candidate.action.id}(${candidate.action.zone}, score=${candidate.score})`)
        .join("；")}`
    );
  }
  if (prepared.knowledge.length > 0) {
    lines.push("- 命中知识（只给索引，细节按需读取）：");
    for (const hit of prepared.knowledge) {
      lines.push(`  - [${hit.id}] ${hit.title} — ${hit.summary}`);
    }
  }
  lines.push("");
  lines.push("可用工具：");
  for (const tool of tools) {
    lines.push(`- ${tool.name}: ${tool.description}`);
  }
  lines.push("");
  lines.push("回合协议：需要动作就调用工具；工具返回后根据结果继续或收尾。");
  lines.push("如果模型不具备原生工具调用能力，可输出 JSON 块：");
  lines.push('```json\n{"tool":"action.id","arguments":{"key":"value"}}\n```');
  return lines.join("\n");
}
