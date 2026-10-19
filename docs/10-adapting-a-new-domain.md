# 10 · 适配一个新领域：介入点、事件、快照、Provider 与分数标定

本文回答一个问题：**把一个新领域（行业 / 业务线 / 产品）整体接入 Ruling Framework，需要在哪些位置动手、动什么、怎么验证。**

与 [07 扩展指南](07-extension-guide.md) 的分工：07 讲单点扩展（加一个动作、加一个适配器、换一个 Provider）；本文讲领域级接入的完整路径，并按适配者最关心的五个方面展开：**介入点、事件、快照、Provider、分数标定**。

核心立场先摆明：核心引擎不认识任何领域概念。领域逻辑全部落在 pack（manifest + executor）与外部组件上；事件、快照、Provider、分数是框架与领域之间的固定接口，适配者只在这些接口上工作，不进入裁定内核。

## 1. 总览：一个领域接入的五件事

```text
新领域
  ├─ 1. 介入点   pack（manifest + executor + 动态区域）+ 知识种子 + Provider + 适配器
  ├─ 2. 事件     提议层发出 AgentEvent，宿主消费；事件只观测，不授权
  ├─ 3. 快照     state.json.gz（图谱 + 台账）+ experience/errors JSONL；审批永不入快照
  ├─ 4. Provider  OpenAI 兼容端点 / 自定义 ChatProvider / mock 离线标定
  └─ 5. 分数标定  动作匹配分、语义路由分、效能分三套分数的参数与调法
```

建议的执行顺序：**先动作表 → 再执行器 → 再知识种子 → 再动态区域 → 再接 Provider → 再投影到适配器**。让动作可登记、可执行、可检索，再谈模型与协议。

## 2. 介入点（Intervention Points）

### 2.1 介入点总表

| # | 介入点 | 位置 | 改什么 | 最小验证 |
| --- | --- | --- | --- | --- |
| 1 | pack manifest | `packs/manifests/<domain>.json` | `id/name/roles/defaultRole/approval/grants/formatLocks/actions/knowledge` | `pnpm ruling validate --pack <id>` |
| 2 | executor handlers | `packs/<domain>.ts` | 每个动作的 handler | 每个动作可执行 / 可拒绝的测试 |
| 3 | 动态区域解析器 | `ZoneRegistry.register(key, resolver)` | 注册解析器 + 动作写 `dynamicZone` | 上下文升级 / 降级测试 |
| 4 | 知识种子 | manifest `knowledge` + `.ruling/knowledge/seed.json` + `synonyms.json` | seed 单元、`uses` 边、别名 / 同义词 | `pnpm ruling knowledge search "领域词"` |
| 5 | 外部知识源 | `.ruling/config.json` 的 `knowledge.external` | JSON / JSONL / Markdown 目录 / HTTP 源 | 加载报告成功且不落本地库 |
| 6 | Provider | `agent/provider.ts` | 实现 `ChatProvider` 或配置环境变量 | `pnpm ruling ask --mock` → 真实端点 |
| 7 | 适配器 | `adapters/*` | CLI / HTTP / MCP 投影 | 端到端演练 |
| 8 | 持久化 | `core/engine-state.ts` | 快照 / 恢复语义 | 恢复后审批为空 |

### 2.2 各介入点的关键约束

**manifest**：`id` 是稳定契约，不随文案变化；`zone` 先按最保守的估计填写；`keywords` 是大脑前置的确定性匹配词；`inputSchema` 应拒绝结构错误的参数；能产生外部副作用的动作不要写成绿灯。

**executor**：只通过 `ctx.workspace` 访问文件，不要直接 `fs` 写工作区；失败要抛错，让引擎记录 `EXECUTOR_ERROR`；返回 `files`，审计与溯源才有文件线索；审批逻辑留在引擎里，不要写进执行器。

**动态区域**：解析器返回 `red` 时 `gate` 直接拒绝，**批准也不能放行**；解析器抛错按失败关闭处理（`INTERNAL_ERROR`，不执行）。红灯在角色授权之前判定，保证"绝对禁止"不被角色差异掩盖。

**知识种子**：至少覆盖"先读后写""红灯清单""关键工作流"三类；`uses` 边指向本领域的核心动作，planner 会据此把动作拉进候选。

**Provider 与适配器**：所有调用收敛到 `RulingEngine.execute`，适配器不能绕过；远程入口显式声明 `trust`，不要静默降级；批准必须来自人，不在适配器里实现。

## 3. 事件（AgentEvent）

提议层 `runAgent` 通过 `AgentOptions.onEvent` 发布事件。事件是**提议层的观测出口**：宿主用它画界面、写测试、做监控，但事件本身不携带任何执行权。

### 3.1 八类事件

| 事件 | 触发时机 | 载荷 | 典型用途 |
| --- | --- | --- | --- |
| `text` | 模型产出一段文本 | `content` | 流式展示 |
| `tool` | 每个工具调用裁定后 | `action` / `status` / `reason` | 审计面板、进度条 |
| `confirm` | 黄灯动作未批准 | `request`（任务/动作/参数/区域/原因） | 人机确认 UI |
| `suggest` | 任务判为 `suggest` | `suggestions` | 建议展示 |
| `clarify` | 任务判为 `fuzzy` | `question` / `suggestions` | 澄清提问 |
| `guard` | 护栏拉回（空回复 / 假完成） | `message` | 弱模型调试 |
| `done` | 循环正常结束 | `content` | 结束态 |
| `error` | 模型调用失败 | `message` | 失败展示 |

### 3.2 事件与裁定的边界

- **事件只观测，不授权**：收到 `confirm` 事件不等于已批准。宿主必须通过 `engine.approve(task, role)` 或让 CLI 用 `--yes`、HTTP 用 `POST /approve` 完成批准，然后重试执行。
- **双向回调**：`onConfirm` 返回 `boolean`；`onClarify` 返回补充文本（补充后只重规划一次）。不提供回调时，`fuzzy` 直接返回建议、不执行任何动作。
- `suggest` / `clarify` 事件发生时，循环**不请求模型、不执行动作**；`guard` 事件只改变"模型还能不能继续提议"，不改变任何执行权限。

### 3.3 新领域适配时最少接哪几个

| 事件 | 场景 | 说明 |
| --- | --- | --- |
| `confirm` | 写操作确认 | 领域包必有黄灯动作，宿主必须有确认出口 |
| `clarify` | 歧义澄清 | 领域术语多、动作名接近时高频出现 |
| `tool` | 执行台账 | 展示"谁在何时执行了什么" |
| `error` | 模型降级 | 弱模型 / 端点不稳定时可见 |

CLI 的 `ask` 命令已消费全部事件（`text/tool/confirm/suggest/clarify/guard/error`），作为库接入时自己实现 `onEvent` 即可。

## 4. 快照（快照与恢复）

### 4.1 快照布局

| 内容 | 载体 | 是否进 `state.json.gz` | 说明 |
| --- | --- | --- | --- |
| seed 知识 | manifest + `.ruling/knowledge/seed.json` | 否 | 每次启动从源重载 |
| extended 经验 | `.ruling/knowledge/experience.jsonl` | 否（独立 JSONL） | `knowledge.add` + 自动观测 |
| error 教训 | `.ruling/knowledge/errors.jsonl` | 否（独立 JSONL） | `lesson.add` + 失败观测 |
| 图谱 + 台账 | `.ruling/state.json.gz`（v2） | 是 | `{ version: 2, savedAt, graph, ledger }` |
| 审批 | 内存 | **永不** | 重启后必须重新批准 |
| 外部源 | 源本身 | 否 | `origin: external:<id>` 只读、不复制 |

### 4.2 快照与恢复语义

- `engine.save(filePath)`：extended / error 原子写 JSONL；图谱 + 台账 gzip 写 `state.json.gz`；全部用 tmp + rename 原子替换。
- `engine.restore(filePath)`：先合并本地 experience / errors，再恢复图谱与台账；v1 旧快照迁移时**过滤 seed 与 external 单元**，避免旧快照覆盖新种子。
- 接数据库时复用现成结构：`KnowledgeStore.snapshot/restore`、`GraphSnapshot`、`LedgerSnapshot`；写入前原子替换；不要把 `ApprovalStore` 的内容序列化。

### 4.3 适配新领域的四条规则

1. **权限不进快照**：任何把审批、角色写进 state 的设计都违反"知识持久，权限不持久"。权限持久化必然腐化——授予语境消失后权限仍然存续。
2. **领域字段放语义元数据**：新领域的标识（行业、产品线、语料集）放进 KnowledgeUnit 的 `domain / namespace / tags / aliases`，不要为每个领域新造持久化格式。
3. **seed 与运行态分离**：改领域规则就改 manifest / seed.json，不要手改 `state.json.gz`；`seed` 永远不落 experience / errors。
4. **外部源幂等重载**：`loadExternalKnowledge` 先按 `origin` 前缀清理再加载，失败按源隔离。

固定测试项：快照恢复后审批为空；`seed` 不被写入 experience/errors；外部源加载成功且不落本地库。

## 5. Provider（提议层接入）

### 5.1 接口

提议层只依赖一个接口，任何实现它的类都可以替换：

```ts
interface ChatProvider {
  chat(request: ChatRequest): Promise<ChatResponse>; // { content, toolCalls }
}
```

### 5.2 现成实现

| 实现 | 用途 | 说明 |
| --- | --- | --- |
| `OpenAICompatibleProvider` | 真实模型 | 任意 OpenAI 兼容 `/chat/completions`；原生工具调用；端点拒绝 `tools` 字段时（400/422）去掉 tools 重试一次；默认超时 120s |
| `providerFromEnv()` | 环境配置 | `RULING_BASE_URL / RULING_MODEL / RULING_API_KEY`；默认 `https://api.openai.com/v1`、`gpt-4o-mini` |
| `mock-provider` / `heuristic-provider` | 离线演练与测试 | 不消耗模型回合，用于标定与 CI |

### 5.3 接入要点

- 工具名 = `toToolName(actionId)`（动作 id 中的点替换为下划线）；工具清单只暴露当前角色获授权的动作。
- 模型不输出原生工具调用时，可以返回正文 JSON / 标签，由 `agent/dialect.ts` 兜底解析。
- NormSpec 前置归一化是**可选**的（`normalize` 默认 false；CLI 在真实模型下默认开启）：它只做语言归一化、不做决策、失败回落；弱模型输出不了稳定 JSON 就关掉，规则链路照常运行。
- 护栏只限制"还能不能继续提议"，不改变执行权限：temperature 0.2、最大 24 轮、空回复 / 零工具假完成各拉回 2 次、同参连续失败 2 次短路、工具结果单条 4000 字截断、上下文按 `contextK` 预算裁剪。

### 5.4 新领域建议

1. 先用 `--mock` 跑通动作与知识种子（离线、可重复）；
2. 再连真实端点，验证原生工具调用与方言兜底；
3. 换模型 / 换供应商时只换 Provider，包内逻辑与门控不动——约束不随供应商改变。

## 6. 分数标定建议

框架里有三套分数，**全部确定性、可复算、不依赖模型**。适配新领域时，真正要标定的是它们，而不是"让模型更准"。

### 6.1 动作匹配分（决定 direct / fuzzy / assist / suggest）

来源：`catalog.matchText` + `planner`。

```text
标题命中      +3
每个关键词命中 +2
动作 id 命中  +4
知识 uses 边   +1 + hit.score（planner 候选累加）
```

分类阈值：

| 条件 | 分类 |
| --- | --- |
| 绿灯 + 无必填参数 + 分数 ≥ 2 且领先 > 1 | `direct`（不经过 LLM 直接执行） |
| 前两名分差 ≤ 1 | `fuzzy`（先澄清） |
| 问句 / 咨询词 | `suggest`（只给建议） |
| 其余有候选 | `assist`（交给助手提议，仍过门控） |

`confidence = min(1, score / 4)`，只用于展示，不参与门控。

标定建议：

- **标题是 +3 的高权入口**：把"领域动词 + 对象"写进标题（如"开具发票"），比堆关键词更稳。
- **关键词会叠加**：每个命中 +2。同一动作留 2–4 个领域高频词即可；堆同义词会造成分数通胀，且容易与相邻动作分差 ≤ 1 掉进 `fuzzy`。
- **id 的 +4 只在用户直接说出 id 时命中**：正常用户不会说 id，别指望它兜底。
- **想让"读"类动作直达**：至少有一个能独立命中 ≥ 2 的关键词，且与第二名分差 > 1。
- **`uses` 边会把知识命中的动作拉进候选**（+1 + hit.score）：seed 知识的 `uses` 应指向本领域核心动作，而不是所有动作。

### 6.2 语义路由分（决定知识命中与候选提名）

来源：`store-route.ts`。

```text
(余弦 × 类型先验 × 冷热 + 别名加分 + 领域/标签加分) × 状态权重 × 置信度权重
+ 一跳邻接：top3 种子 + 边权重 × 0.1 × max(0.1, 种子分)
```

| 项 | 值 | 含义 |
| --- | --- | --- |
| 类型先验 | seed 1.15 / error 1.1 / extended 1 | 种子与教训优先 |
| 冷热 | hot 1 / 冷 0.9 | 低频 extended 会被降热 |
| 别名加分 | 每个命中 +0.15，上限 0.6 | aliases 补齐领域黑话 |
| 领域 / 标签加分 | domain +0.1、tag +0.05，上限 0.3 | 命中才加 |
| 状态权重 | active 1 / draft 0.85 / deprecated 0.5 | 状态衰减 |
| 置信度权重 | 0.5 + 0.5 × confidence | confidence∈[0,1] 线性放大 |
| 命中阈值 | 分数 ≤ 0.05 截断 | 低分不命中 |

标定建议：

- 新领域种子单元**必填 `domain / tags / aliases` 与合理 `confidence`**（默认 seed 1、extended 0.8），否则语义检索只能靠哈希嵌入的余弦命中。
- **别名比领域更值钱**（0.15 vs 0.1）：把用户的真实说法写进 aliases。
- **draft 状态直接乘 0.85**：未经 `knowledge.review` 审核的新知识不要压过 active 知识。
- 图谱邻接只在 top3 种子上做一跳扩散：**种子质量决定图扩散质量**，先管好种子再谈图谱。

### 6.3 效能分（只影响计划级建议，不是安全门）

来源：`budget.ts`。

```text
accuracy = (successes + 40 × 0.995) / (attempts + 40)
speed    = min(1, speedBudgetMs / avgMs)
energy   = min(1, 5 / (avgMs/1000 × max(1, energyWeight)))
ratio    = accuracy × (0.5 × speed + 0.5 × energy)
```

- 冷启动 ratio ≈ 0.995；`ratio ≥ 0.99` 才 `autoEligible`（计划级建议不再打扰用户）。
- 先验权重 40：样本少时不被一两次成败带偏（20 次执行 1 次失败，ratio = 0.98）。
- **单次黄灯写操作永远不会因为 ratio 高而放行**——效能门不是安全门，这是最常见的误读。

标定建议：

- `speedBudgetMs` 按真实 `avgMs` 标定：给无限预算会让 `speed` 恒为 1，失去区分度；一般取真实均值的 2–4 倍作为"达标预算"。
- `energyWeight` 反映动作的真实成本：外部系统调用 > 本地读写。
- **先收集台账再调预算**：台账来自 `engine.stats()`（SDK）或 HTTP `GET /stats`；CLI 没有独立的 stats 命令。
- 台账与图谱的全局常量（成功增益 0.18 / 0.14、失败 ×0.4、14 天半衰期、0.02 修剪、0.15 降热）**新领域先用默认值**，至少跑一个月观测再决定是否改。

### 6.4 标定顺序

```text
1. 登记动作 + 关键词        → pnpm ruling catalog 检查匹配分
2. 对典型任务跑 plan        → 看 direct / fuzzy / assist / suggest 分布
3. --mock 跑典型任务        → 收集台账（avgMs、成功率）
4. 按台账标定预算           → speedBudgetMs / energyWeight
5. 调关键词与 uses 边       → 读动作直达、写动作稳定进 assist
6. 上线后复盘               → stats + audit，微调知识种子与 confidence
```

## 7. 适配验收清单

- [ ] `validatePack` 通过：每个动作有 handler，roles / grants / approval 合法。
- [ ] 绿灯动作无批准可执行；黄灯未批准返回 `needConfirm`；红灯批准后仍 `denied`。
- [ ] 未登记动作不执行（批准也不能执行）。
- [ ] 动态区域按上下文升级 / 降级；解析器抛错失败关闭。
- [ ] 知识检索命中领域种子；`uses` 边提名正确动作。
- [ ] 事件流：`confirm / clarify / tool` 在宿主中可见；事件不携带执行权。
- [ ] 快照：save → restore 后审批为空；seed 不落 JSONL；external 不落本地库。
- [ ] Provider：mock 与真实端点都通过；方言兜底生效。
- [ ] 分数：典型任务分类符合预期（读直达、写 assist、模糊澄清、问句建议）。
- [ ] 审计哈希链可验证。
