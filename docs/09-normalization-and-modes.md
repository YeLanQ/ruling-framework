# 09 · 前置归一化与任务分层

## 1. 为什么需要这一层

用户输入通常是口语、含糊、多意图的：

- “把交付弄一下”；
- “写文档或者构建”；
- “这东西怎么交付”；
- “先看看，然后再说”。

如果直接把这类文本交给模型主循环，会出现两种坏结果：

- 模型猜一个动作就执行；
- 模型反复调用工具，或者宣布完成但没有执行。

设计上采用的做法是：在模型主推理之前，先做一次**非裁决性的语言归一化**，再由确定性大脑把任务分成直达、助手、模糊、建议四类。本框架实现了这一层。

## 2. NormSpec 前置归一化

实现：`src/agent/nl-normalize.ts`

```ts
interface NormalizedTask {
  taskType: "query" | "edit" | "create" | "delete" | "build" | "analyze" | "chat";
  taskDescription: string;
  anchors: string[];
  fileRefs: string[];
  ambiguities: string[];
  confidence: number;
}
```

规则：

- **只做语言归一化**：把口语转写为结构化任务描述；
- **不做决策**：不选择动作、不判断区域、不申请权限；
- **不调用工具**：归一化请求不携带工具；
- **文件引用只验证存在性**，不读取内容；
- **失败回落**：超时、坏 JSON、空描述、供应商错误一律返回 `undefined`，规则链路照常运行；
- **可选**：`AgentOptions.normalize` 默认 `false`；CLI 在真实模型下默认开启，`--mock` 与 `--no-normalize` 关闭。

归一化结果只影响“大脑看到什么任务描述”，不改变任何执行许可。

## 3. 任务分层

实现：`src/core/planner.ts`

每个语义单元被归为四类之一：

| 模式 | 判定 | 行为 |
| --- | --- | --- |
| `direct` | 唯一高置信度绿灯动作、无需参数、明显领先 | 不经过 LLM 直接执行 |
| `assist` | 有明确候选动作，但需要参数、写操作或多步骤 | 交给 Agent 提议，仍过门控 |
| `fuzzy` | 候选接近、表述含“或者/还是/随便/处理一下”等 | 停止执行，先澄清 |
| `suggest` | 问句/咨询、没有匹配动作 | 只给建议，不执行 |

整体模式取并集：

```text
任一单元 fuzzy          → fuzzy
全部单元 suggest        → suggest
只有一个单元且为 direct → direct
其余有可执行单元        → assist
```

多步骤任务（例如“列出文件然后写文档”）即使包含一个 direct 单元，整体也是 `assist`，避免把一个计划误当成单命令直达。

## 4. 判定的确定性规则

- 问句/咨询：`怎么 / 如何 / 能不能 / 可以吗 / 是否 / 建议 / 推荐 / 有哪些 / what / how` → `suggest`；
- 模糊词：`或者 / 还是 / 可能 / 大概 / 随便 / 处理一下 / 弄一下 / 搞一下 / 都行` → `fuzzy`；
- 候选接近：前两名分差 ≤ 1 → `fuzzy`；
- 绿灯、无必填参数、分数 ≥ 2、明显领先 → `direct`；
- 其余有候选 → `assist`；
- 没有候选 → `suggest`。

这些规则不含模型判断，可单元测试、可回归。

## 5. Agent 循环中的行为

### 5.1 direct

`runAgent` 直接调用 `engine.execute`，不构造工具列表、不请求模型。

### 5.2 assist

正常提议循环：模型只看到候选动作与工具清单；每个工具调用仍经过 `RulingEngine.execute` 与三区门控。

### 5.3 fuzzy

- 发出 `clarify` 事件，附歧义原因与候选动作建议；
- 如果宿主提供 `onClarify`，用用户的补充重新 `prepare`；
- 补充后如果变成 `direct`/`assist`，继续；如果仍然模糊，返回 `needs-clarification`；
- 没有澄清回调时，直接返回建议，不执行任何动作。

### 5.4 suggest

- 发出 `suggest` 事件；
- 返回候选动作、所需参数与“补充对象/操作/目标”的提示；
- 不请求模型、不执行动作。

## 6. CLI 行为

```bash
# 真实模型默认开启归一化
pnpm ruling ask "写一份交付说明并构建" --yes

# 关闭归一化
pnpm ruling ask "写一份交付说明并构建" --no-normalize

# mock 模式跳过归一化，避免消耗脚本回合
pnpm ruling ask "添加文件" --mock

# 建议 / 澄清
pnpm ruling ask "如何交付" --mock --json
pnpm ruling ask "写文档或者构建" --mock --json
```

`--json` 输出包含：

```json
{
  "mode": "fuzzy",
  "stoppedReason": "needs-clarification",
  "ambiguities": ["候选动作不明确：doc.write 与 project.build 分数接近"],
  "suggestions": ["写入文档（doc.write，yellow）；需要参数：path, content", "..."]
}
```

## 7. 与门控的关系

前置归一化与任务分层都**不掌握执行权**：

- `direct` 只对绿灯、无参动作生效；
- `assist` 的每个调用仍走三区门控；
- `fuzzy`/`suggest` 根本不执行；
- 审批仍然按用户原始任务文本绑定，不按归一化后的描述绑定；
- 归一化失败不会改变系统行为，只会回到规则链路。

## 8. 已知局限

- 归一化本身消耗一次模型调用；弱模型可能输出坏 JSON，此时直接回落；
- 模糊/建议判定是规则启发式，不理解深层语义；
- 补充信息后只重新规划一次，不做多轮澄清；
- `direct` 只覆盖无参绿灯动作；带参读操作仍交给 `assist`；
- 模式不改变权限，任何模式都不能绕过红灯或未登记动作。
