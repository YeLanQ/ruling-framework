# 03 · 契约：数据结构、状态与协议

本文件是实现层的稳定契约。改动这些结构时，应同步更新测试与文档。

## 1. 基础类型

```ts
type Zone = "green" | "yellow" | "red";
type Decision = "autoExecute" | "needConfirm" | "deny";
type TrustMode = "agent" | "operator";
type Source = "assistant" | "cli" | "mcp" | "http" | "test";
```

## 2. 动作规格

```ts
interface ActionSpec {
  id: string;                 // 稳定契约，例如 "doc.write"
  title: string;
  description: string;
  keywords: string[];         // 大脑前置的确定性匹配词
  group: string;              // 能力组，用于角色授权
  zone: Zone;                 // 静态区域
  dynamicZone?: string;       // 动态区域解析器键
  speedBudgetMs: number;      // 速度分预算
  energyWeight: number;       // 能耗权重
  inputSchema?: JsonSchema;   // 轻量 JSON Schema 子集
}
```

约束：

- `id` 在一个 pack 内唯一；
- `zone` 只能是三区之一；
- 每个动作必须有执行器实现（`validatePack` 校验）；
- 动作表之外的动作不存在。

## 3. 执行请求与回执

```ts
interface ExecuteRequest {
  task: string;               // 截断 200 字，审批会话键
  action: string;
  params?: Record<string, unknown>;
  trust: TrustMode;
  actor?: { id?: string; role?: string };
  source?: Source;
}

interface ExecuteOutcome {
  status: "ok" | "needConfirm" | "denied" | "error";
  decision: Decision;
  zone: Zone;
  reason: string;
  ratio: number;
  result?: unknown;
  files?: string[];
  observe?: ObserveReport;
  errorCode?: RulingErrorCode;
}
```

`status` 与 `decision` 的区别：

- `decision` 是裁定结论；
- `status` 是执行结果：`needConfirm` 表示没有执行，`ok` 表示执行成功，`error` 表示执行器或边界失败。

## 4. 门控真值表

```ts
gate({ zone, approved, known }):
  red                          -> { decision: "deny",        reason: "红灯" }
  green                        -> { decision: "autoExecute", reason: "绿灯" }
  yellow + approved + known    -> { decision: "autoExecute", reason: "已批准" }
  yellow + 其他                -> { decision: "needConfirm", reason: "需批准/未登记" }
```

执行顺序（不可交换）：

```text
1. 动作是否登记
2. 静态红灯
3. 角色能力组授权
4. 动态区域解析
5. trust=agent: gate(zone, approved, known)
   trust=operator: 解析后红灯阻断
6. 输入 schema
7. ActionExecutor
8. 台账 + 因果 + 审计
```

## 5. 审批契约

```ts
interface ApprovalPolicy {
  ttlMs: number;
  defaultRoles: string[];
  byGroup?: Record<string, string[]>;
}
```

语义：

- 键：`task.trim().slice(0, 200)`；
- 批准角色集合去重；
- 一个能力组要求的角色必须**全部**出现；
- 过期即失效；
- 纯内存，不序列化；
- 批准不覆盖未登记动作；
- 批准不扩大源头策略。

示例：小公司 `release` 组：

```json
{
  "ttlMs": 600000,
  "defaultRoles": ["owner"],
  "byGroup": { "release": ["reviewer", "owner"] }
}
```

## 6. 错误码

| 错误码 | 含义 | 典型 status |
| --- | --- | --- |
| `UNKNOWN_ACTION` | 动作不在能力面 | agent=needConfirm / operator=denied |
| `ACTION_NOT_GRANTED` | 角色没有能力组授权 | denied |
| `RED_LINE` | 红灯，批准也不放行 | denied |
| `BAD_PARAMS` | 输入 schema 校验失败 | error |
| `PATH_INVALID` | 路径非法（空、反斜杠、绝对路径） | error |
| `PATH_ESCAPE` | 路径包含 `..` 或越出工作区 | error |
| `INTERNAL_READONLY` | 写入 `internal/` | error |
| `FORMAT_LOCKED` | 格式受专用通道保护 | error |
| `SIZE_LIMIT` | 超过读写体积上限 | error |
| `EXECUTOR_ERROR` | 执行器抛错 | error |
| `INTERNAL_ERROR` | 区域解析等内部失败，失败关闭 | error |

## 7. 审计记录

```ts
interface AuditEntry {
  seq: number;
  ts: number;
  source: Source;
  actorId?: string;
  actorRole?: string;
  task: string;
  taskHash: string;       // sha256(task).slice(0, 16)
  taskPreview: string;    // 前 80 字
  action: string;
  zone: Zone;
  decision: Decision;
  status: "ok" | "needConfirm" | "denied" | "error";
  ok: boolean;
  ms: number;
  reason: string;
  files?: string[];
  errorCode?: string;
  prevHash: string;
  hash: string;           // sha256(固定字段序列 + prevHash)
}
```

- 内存环形缓冲默认 50 条，启动时从 `audit.jsonl` 恢复最近 50 条；
- `verifyChain` 校验环形缓冲；
- `verifyFile` 校验完整文件；
- 导出 Markdown 按任务分组。

## 8. 行业包 manifest

```ts
interface PackManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  roles: string[];
  defaultRole: string;
  approval: ApprovalPolicy;
  grants: Record<string, string[]>; // "*" | 能力组 | 动作 id
  formatLocks: FormatLock[];
  actions: ActionSpec[];
  knowledge: KnowledgeInput[];
}
```

校验项：

- `defaultRole` 必须在 `roles` 内；
- `grants` 只能引用已知角色、能力组或动作 id；
- 每个角色都有 grants 条目；
- 审批策略中的角色必须存在；
- 动作 id 唯一；
- 每个动作都有 handler。

## 9. 知识单元

```ts
interface KnowledgeUnit {
  id: string;
  kind: "seed" | "extended" | "error";
  title: string;
  summary: string;
  body: string;
  tags: string[];
  uses?: string[];        // 推荐动作，供 planner 使用
  origin?: string;        // seed | workspace | runtime | external:<id>
  namespace: string;       // 默认 local；外部源默认 external
  domain?: string;
  aliases: string[];
  status: "draft" | "active" | "deprecated";
  confidence: number;      // 0..1
  version: number;
  supersedes?: string[];
  supersededBy?: string;
  contradicts?: string[];
  validFrom?: number;
  validUntil?: number;
  reviewedBy?: string;
  reviewedAt?: number;
  createdAt: number;
  hits: number;
  lastHitAt: number;
  hot: boolean;
}
```

### 9.1 三层持久化契约

| 层 | 文件 | 写入者 | 是否进 state 快照 |
| --- | --- | --- | --- |
| `seed` | pack manifest + `.ruling/knowledge/seed.json` | 代码 / 人工编辑 | 否 |
| `extended` | `.ruling/knowledge/experience.jsonl` | `knowledge.add` + 自动观测 | 否 |
| `error` | `.ruling/knowledge/errors.jsonl` | `lesson.add` + 失败观测 | 否 |

```text
.ruling/state.json.gz = { version: 2, savedAt, graph, ledger }
```

- 旧版 `version: 1` 内嵌 `knowledge`，可读取并在下次保存时迁移。
- `origin` 以 `external:` 开头的单元只读、不写本地库。
- JSONL 每行是一个 `KnowledgeUnit`；坏行跳过，不影响其余单元。
- 审批不在任何持久化文件中。

### 9.2 语义查询契约

```ts
interface KnowledgeQueryOptions {
  topK?: number;
  namespace?: string;
  domain?: string;
  status?: "draft" | "active" | "deprecated";
  tag?: string;
}
```

排序：

```text
(余弦 × 类型先验 × 冷热 + 别名加分 + 领域/标签加分) × 状态权重 × 置信度权重
```

状态权重：active 1.0、draft 0.85、deprecated 0.5。语义权重只影响检索排序，不影响执行权限。

生命周期动作：

| 动作 | 作用 |
| --- | --- |
| `knowledge.review` | 置为 active，记录审核者与置信度 |
| `knowledge.deprecate` | 置为 deprecated，可指定 `supersededBy` |
| `knowledge.merge` | 合并别名/标签/uses，废弃重复项，写入 `supersedes` |

### 9.3 外部知识源配置

```ts
interface ExternalKnowledgeConfig {
  id: string;
  type: "json" | "jsonl" | "markdown" | "http";
  kind?: "seed" | "extended" | "error"; // 默认 extended
  path?: string;   // json/jsonl
  dir?: string;    // markdown
  url?: string;    // http
  tags?: string[];
  headers?: Record<string, string>;
  timeoutMs?: number;
  enabled?: boolean;
  prefix?: string; // 默认 ext:<id>:
}
```

配置位置：`.ruling/config.json` 的 `knowledge.external`。外部源只读加载，失败按源隔离。

## 10. HTTP 契约

只绑定 `127.0.0.1`。

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/health` | - | `{ ok, pack }` |
| GET | `/catalog` | - | `{ pack, defaultRole, roles, grants, actions, stats }` |
| GET | `/stats` | - | 决策计数、正确率、动作列表 |
| GET | `/audit?limit=50` | - | `{ entries }` |
| POST | `/execute` | `ExecuteRequest`（`trust` 默认 `operator`） | `ExecuteOutcome`；ok=200，其他=409 |
| POST | `/approve` | `{ task, role? }` | `{ approved, task, role }` |

可选 `x-ruling-token` 头：配置后必须匹配。它只是本地脚本便利，不是认证。

## 11. MCP 契约

stdio JSON-RPC 2.0，协议版本 `2024-11-05`。

| 方法 | 说明 |
| --- | --- |
| `initialize` | 返回协议版本与 serverInfo |
| `notifications/initialized` | 无响应 |
| `ping` | 空结果 |
| `tools/list` | 只列当前角色获授权的动作 |
| `tools/call` | `{ name, arguments }`；`arguments.__task` 作为任务文本，执行前移除 |

返回：

```json
{
  "content": [{ "type": "text", "text": "<ExecuteOutcome JSON>" }],
  "isError": true
}
```

`needConfirm` 时文本中带提示：使用 HTTP `POST /approve`（同一进程），或 CLI `--yes`。**不提供 approve 工具**。

## 12. CLI 契约

| 命令 | 说明 |
| --- | --- |
| `init` | 写入 `.ruling/config.json` |
| `packs` | 列出行业包 |
| `validate` | 校验 pack |
| `catalog` | 列出动作与区域 |
| `knowledge list` | 列出 seed / extended / error；支持 `--kind/--status/--namespace/--domain/--tag` |
| `knowledge search` | 语义检索：别名/同义词/领域加权 |
| `knowledge dedupe` | 近重复检测 |
| `knowledge conflicts` | 显式 `contradicts` 检测 |
| `knowledge stats` | 分层/状态/命名空间统计 |
| `exec` | 单动作执行；黄灯用 `--yes` 在同一进程批准 |
| `plan` | 计划级建议（不替代单次门控） |
| `ask` | Agent 循环；`--mock` 使用启发式 Provider |
| `audit` | `list` / `verify` / `export` |
| `serve` | `--http` 或 `--mcp` |

退出码：

- `0` 成功；
- `1` 错误；
- `2` `needConfirm` 且未提供批准。

## 13. 兼容性纪律

- 动作 `id` 是稳定契约；CLI 文本、标题、描述可以改。
- 新增动作必须同时更新 manifest、executor、测试；`validatePack` 会拦截漏实现。
- 协议字段变更属于破坏性变更；应在 pack `version` 与文档中标注。
- 审计哈希链字段顺序是契约的一部分；修改需同时升级 `version`。
