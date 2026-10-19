// The proposal loop. Guard rails keep weak models from spinning, but every
// tool call still passes through RulingEngine.execute; the loop never grants
// itself permission. Fuzzy tasks stop for clarification; advisory tasks return
// suggestions without executing anything.

import {
  DEFAULT_CONTEXT_K,
  DEFAULT_MAX_ROUNDS,
  MAX_TOOL_RESULT,
  fitMessages,
  looksLikeCompletion
} from "./context.js";
import { parseInlineToolCalls } from "./dialect.js";
import { normalizeTaskSpec } from "./nl-normalize.js";
import { buildSystemPrompt } from "./prompt.js";
import { toToolName } from "./tool-names.js";
import type {
  AgentEvent,
  AgentOptions,
  AgentResult,
  ChatMessage,
  ChatToolCall,
  ToolDefinition
} from "./types.js";

export async function runAgent(options: AgentOptions): Promise<AgentResult> {
  const { engine, task } = options;
  const emit = (event: AgentEvent): void => options.onEvent?.(event);
  const role = options.role ?? engine.surface.defaultRole;
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const contextK = options.contextK ?? DEFAULT_CONTEXT_K;

  const normalized = options.normalize
    ? await normalizeTaskSpec(options.provider, options.model, task, {
        fileExists: (path) => engine.workspace.exists(path)
      })
    : undefined;
  let prepared = engine.prepare(normalized?.taskDescription ?? task, normalized);

  const resultBase = (
    content: string,
    stoppedReason: AgentResult["stoppedReason"],
    toolCalls = 0,
    rounds = 0
  ): AgentResult => ({
    content,
    rounds,
    toolCalls,
    mode: prepared.mode,
    ...(prepared.suggestions.length > 0 ? { suggestions: prepared.suggestions } : {}),
    ...(prepared.ambiguities.length > 0 ? { ambiguities: prepared.ambiguities } : {}),
    ...(normalized ? { normalized } : {}),
    stoppedReason
  });

  const runDirect = async (): Promise<AgentResult | undefined> => {
    if (options.allowDirect === false || !prepared.direct) return undefined;
    const direct = prepared.direct;
    const outcome = await engine.execute({
      task,
      action: direct.action,
      params: direct.params ?? {},
      trust: options.trust,
      actor: { role },
      source: "assistant"
    });
    if (outcome.status !== "ok") return undefined;
    const content = `已直接执行 ${direct.action}：${direct.reason}`;
    emit({ type: "text", content });
    emit({ type: "done", content });
    return resultBase(content, "direct", 1, 0);
  };

  const direct = await runDirect();
  if (direct) return direct;

  const suggestionText = (): string => {
    const head =
      prepared.mode === "fuzzy"
        ? `任务存在歧义：${prepared.ambiguities.join("；") || "请补充对象、动作或目标"}。`
        : "当前任务更适合先给建议：";
    const list =
      prepared.suggestions.length > 0
        ? `\n建议：\n- ${prepared.suggestions.join("\n- ")}`
        : "";
    return `${head}${list}`;
  };

  if (prepared.mode === "suggest") {
    emit({ type: "suggest", suggestions: prepared.suggestions });
    const content = suggestionText();
    emit({ type: "done", content });
    return resultBase(content, "suggestion");
  }

  if (prepared.mode === "fuzzy") {
    const question = prepared.ambiguities.join("；") || "请补充对象、动作或目标";
    emit({ type: "clarify", question, suggestions: prepared.suggestions });
    let answer: string | undefined;
    if (options.onClarify) {
      try {
        answer = await options.onClarify({ task, question, suggestions: prepared.suggestions });
      } catch {
        answer = undefined;
      }
    }
    if (!answer?.trim()) {
      const content = suggestionText();
      emit({ type: "done", content });
      return resultBase(content, "needs-clarification");
    }

    prepared = engine.prepare(answer.trim(), normalized);
    const afterDirect = await runDirect();
    if (afterDirect) return afterDirect;
    if (prepared.mode === "suggest" || prepared.mode === "fuzzy") {
      const content = suggestionText();
      emit({ type: "done", content });
      return resultBase(
        content,
        prepared.mode === "suggest" ? "suggestion" : "needs-clarification"
      );
    }
  }

  const grants = engine.surface.grants[role] ?? [];
  const specs = engine.catalog().specs().filter(
    (spec) => grants.includes("*") || grants.includes(spec.group) || grants.includes(spec.id)
  );
  const nameToAction = new Map<string, string>();
  const tools: ToolDefinition[] = [];
  for (const spec of specs) {
    const name = toToolName(spec.id);
    if (nameToAction.has(name)) {
      throw new Error(`工具名冲突：${spec.id} 与 ${nameToAction.get(name)}`);
    }
    nameToAction.set(name, spec.id);
    tools.push({
      name,
      description: `${spec.title} — ${spec.description}（区域：${spec.zone}）`,
      inputSchema: spec.inputSchema
    });
  }

  const system = buildSystemPrompt({
    packName: engine.surface.name,
    task,
    prepared,
    tools,
    trust: options.trust,
    role
  });
  const history = options.session?.store.load(options.session.id) ?? [];
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...history.filter((message) => message.role !== "system"),
    { role: "user", content: task }
  ];

  let rounds = 0;
  let toolCallsMade = 0;
  let emptyRescues = 0;
  let fakeDoneRescues = 0;
  let lastContent = "";
  const failures = new Map<string, number>();

  const finish = (
    content: string,
    stoppedReason: AgentResult["stoppedReason"]
  ): AgentResult => {
    if (options.session) {
      const toSave = messages.filter((message) => message.role !== "system");
      options.session.store.save(options.session.id, toSave);
    }
    emit({ type: "done", content });
    return resultBase(content, stoppedReason, toolCallsMade, rounds);
  };

  const resolveName = (name: string): string | undefined => nameToAction.get(name);

  while (rounds < maxRounds) {
    rounds += 1;
    let response;
    try {
      response = await options.provider.chat({
        model: options.model,
        messages: fitMessages(messages, contextK),
        tools,
        temperature: 0.2
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({ type: "error", message });
      return finish(`模型调用失败：${message}`, "error");
    }

    let content = response.content ?? "";
    let calls: ChatToolCall[] = response.toolCalls;
    if (calls.length === 0 && content.trim()) {
      const parsed = parseInlineToolCalls(content, resolveName);
      if (parsed.calls.length > 0) {
        calls = parsed.calls;
        content = parsed.cleaned;
      }
    }
    if (content.trim()) {
      lastContent = content.trim();
      emit({ type: "text", content: lastContent });
    }

    if (calls.length === 0) {
      if (!content.trim()) {
        emptyRescues += 1;
        if (emptyRescues <= 2) {
          messages.push({ role: "user", content: "[guard] 空回复。请继续；需要动作就调用工具。" });
          emit({ type: "guard", message: "空回复，已拉起继续" });
          continue;
        }
        return finish("（模型连续空回复）", "error");
      }
      if (fakeDoneRescues < 2 && toolCallsMade === 0 && looksLikeCompletion(content)) {
        fakeDoneRescues += 1;
        messages.push({ role: "assistant", content });
        messages.push({
          role: "user",
          content: "[guard] 你还没有执行任何工具，不能宣布完成。请调用工具，或明确说明无法执行。"
        });
        emit({ type: "guard", message: "零工具完成守卫，已拉回重执行" });
        continue;
      }
      messages.push({ role: "assistant", content });
      return finish(content.trim(), "done");
    }

    messages.push({ role: "assistant", content, toolCalls: calls });
    for (const call of calls) {
      const action = nameToAction.get(call.name) ?? call.name;
      const request = {
        task,
        action,
        params: call.arguments,
        trust: options.trust,
        actor: { role },
        source: "assistant" as const
      };
      let outcome = await engine.execute(request);
      if (outcome.status === "needConfirm") {
        emit({
          type: "confirm",
          request: {
            task,
            action,
            params: call.arguments,
            zone: outcome.zone,
            reason: outcome.reason
          }
        });
        let approved = false;
        if (options.onConfirm) {
          try {
            approved = await options.onConfirm({
              task,
              action,
              params: call.arguments,
              zone: outcome.zone,
              reason: outcome.reason
            });
          } catch {
            approved = false;
          }
        }
        if (approved) {
          engine.approve(task, role);
          outcome = await engine.execute(request);
        }
      }
      toolCallsMade += 1;
      const payload = JSON.stringify({
        status: outcome.status,
        decision: outcome.decision,
        reason: outcome.reason,
        result: outcome.result,
        files: outcome.files
      });
      messages.push({ role: "tool", toolCallId: call.id, content: payload.slice(0, MAX_TOOL_RESULT) });
      emit({ type: "tool", action, status: outcome.status, reason: outcome.reason });

      if (outcome.status !== "ok") {
        const key = `${action}:${JSON.stringify(call.arguments)}`;
        const count = (failures.get(key) ?? 0) + 1;
        failures.set(key, count);
        if (count >= 2) {
          return finish(`同一调用连续失败：${action} — ${outcome.reason}`, "repeated-failure");
        }
      }
    }
  }

  return finish(lastContent || "（达到最大轮次）", "max-rounds");
}
