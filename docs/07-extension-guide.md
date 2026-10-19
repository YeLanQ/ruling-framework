# 07 · 扩展指南：接入自己的动作、系统与协议

本框架的核心不包含任何行业逻辑。所有行业能力都通过 pack（manifest + executor）接入；协议通过适配器投影。以下是从零扩展的步骤。

## 1. 新增一个动作

### 1.1 在 manifest 登记

```json
{
  "id": "invoice.issue",
  "title": "开具发票",
  "description": "在财务系统中开具发票",
  "keywords": ["开票", "发票", "invoice"],
  "group": "finance",
  "zone": "yellow",
  "speedBudgetMs": 15000,
  "energyWeight": 3,
  "inputSchema": {
    "type": "object",
    "properties": {
      "customer": { "type": "string", "minLength": 1 },
      "amount": { "type": "number", "minimum": 0 }
    },
    "required": ["customer", "amount"],
    "additionalProperties": false
  }
}
```

规则：

- `id` 是稳定契约，不要随文案变化；
- `zone` 先按最保守的估计填写；
- `keywords` 是大脑前置的确定性匹配词；
- `inputSchema` 应拒绝结构错误的参数；
- 能产生外部副作用的动作不要写成绿灯。

### 1.2 实现 executor

```ts
import type { ActionHandler } from "ruling-framework/packs";

const issueInvoice: ActionHandler = async (ctx) => {
  const customer = String(ctx.params.customer);
  const amount = Number(ctx.params.amount);

  // 只通过 ctx.workspace 访问工作区文件；
  // 外部系统调用放在这里，失败时抛错。
  const receipt = await finance.createInvoice({ customer, amount });

  await ctx.workspace.write(
    `invoices/${receipt.id}.json`,
    JSON.stringify(receipt, null, 2)
  );

  return { result: receipt, files: [`invoices/${receipt.id}.json`] };
};
```

执行器约束：

- 不要绕过 `ctx.workspace` 直接写工作区；
- 失败要抛错，让引擎记录 `EXECUTOR_ERROR`；
- 返回 `files`，审计与溯源才有文件线索；
- 不要把审批逻辑写进执行器；审批在引擎里。

### 1.3 注册 handler 与 pack

```ts
const handlers = {
  ...existingHandlers,
  "invoice.issue": issueInvoice
};
```

`validatePack` 会检查每个动作是否有 handler；漏实现会在启动时失败，而不是运行时才暴露。

## 2. 新增动态区域

当一个动作的区域取决于上下文时，使用 `dynamicZone`：

```json
{
  "id": "design.set_param",
  "zone": "yellow",
  "dynamicZone": "safetyParam"
}
```

注册解析器：

```ts
import type { ZoneResolver } from "ruling-framework/core";

const safetyParam: ZoneResolver = async ({ params, workspace }) => {
  if (params.name === "wallThickness") return "red";
  return "yellow";
};

zones.register("safetyParam", safetyParam);
```

解析器返回 `red` 时，`gate` 会拒绝，批准也不能放行。解析器抛错按失败关闭处理（`INTERNAL_ERROR`，不执行）。

## 3. 自定义 Provider

任何实现下面接口的类都可以作为提议层：

```ts
import type { ChatProvider } from "ruling-framework/agent";

class MyProvider implements ChatProvider {
  async chat(request) {
    // 调用你的模型端点，返回 content 与 toolCalls
    return { content: "", toolCalls: [] };
  }
}
```

要求：

- 工具调用名必须与 `toToolName(actionId)` 一致；
- 不支持原生工具调用时，可以返回正文 JSON，由 `agent/dialect.ts` 兜底解析；
- 不要在执行器之外直接执行动作；所有调用交给 `RulingEngine.execute`。

## 4. 自定义适配器

适配器只做三件事：解析请求、构造 `ExecuteRequest`、序列化 `ExecuteOutcome`。

```ts
const outcome = await engine.execute({
  task,
  action,
  params,
  trust: "operator",          // 或 "agent"
  actor: { role: "owner" },
  source: "http"              // 用于审计
});
```

建议：

- 远程入口显式声明信任模式，不要静默降级；
- 不要在适配器里实现批准；批准必须来自人；
- 保持单一能力面：适配器不能绕过 `engine.execute`；
- 对输入做类型检查，非法 `trust`/`params` 直接拒绝。

## 5. 自定义知识来源

默认知识分三层、三处存放：

- `seed`：pack manifest + `.ruling/knowledge/seed.json`；
- `extended`：`.ruling/knowledge/experience.jsonl`；
- `error`：`.ruling/knowledge/errors.jsonl`。

外部知识源通过 `.ruling/config.json` 配置：

```json
{
  "knowledge": {
    "external": [
      { "id": "handbook", "type": "markdown", "dir": "docs/handbook", "kind": "extended" },
      { "id": "incidents", "type": "jsonl", "path": "knowledge/incidents.jsonl", "kind": "error" },
      { "id": "wiki", "type": "http", "url": "http://127.0.0.1:8080/kb.json" }
    ]
  }
}
```

作为库使用时：

```ts
await engine.loadExternalKnowledge(config.knowledge?.external ?? []);
```

也可以实现自己的 `KnowledgeSource`，加载后调用：

```ts
engine.surface.knowledge.addMany(units);
```

要求：

- 外部单元设置 `origin: "external:<id>"`，这样不会被写进本地库；
- 为单元补 `namespace/domain/aliases/status/confidence`，语义检索才能稳定命中；
- 不要把权限写进知识单元；
- 不要让检索结果直接决定执行；
- 外部内容视为不可信输入，执行仍过门禁。

知识生命周期使用动作而不是直接改文件：`knowledge.review`、`knowledge.deprecate`、`knowledge.merge`。它们都走黄灯批准，和普通写操作一样。

## 6. 自定义持久化

`engine.save(filePath)` 会：

- 把 `extended` 写入 `experience.jsonl`；
- 把 `error` 写入 `errors.jsonl`；
- 把图谱与台账写入 `state.json.gz`（v2）。

审批永远不保存。若需要数据库：

- 复用 `KnowledgeUnit`、`GraphSnapshot` 与 `LedgerSnapshot` 结构；
- 写入前做原子替换；
- 不要把 `ApprovalStore` 的内容序列化；
- 保持 `seed` 与运行态知识分离，避免旧快照覆盖新种子。

## 7. 测试清单

新增动作或 pack 后至少覆盖：

- [ ] 每个动作都有 handler（`validatePack`）。
- [ ] 绿灯动作无批准可执行。
- [ ] 黄灯动作未批准返回 `needConfirm`。
- [ ] 红灯动作批准后仍 `denied`。
- [ ] 未登记动作批准后仍 `needConfirm`。
- [ ] 参数缺失/类型错误返回 `BAD_PARAMS`。
- [ ] 路径穿越、格式锁、体积上限。
- [ ] 动态区域按上下文升级/降级。
- [ ] 角色授权拒绝。
- [ ] 多角色审批（如适用）。
- [ ] 审计哈希链可验证。
- [ ] 快照恢复后审批为空。
- [ ] `seed` 不被写入 experience/errors。
- [ ] 外部知识源加载成功且不落本地库。
- [ ] `lesson.add` 写入 errors.jsonl。
- [ ] 失败执行生成 `failure:<action>` 并带原因。

## 8. 上线检查

- 只绑定回环地址；
- 只授予必要能力组；
- 不可逆动作保持红灯；
- 审查 `audit.jsonl` 的留存与隐私；
- 备份工作区；框架没有通用撤销；
- 明确哪些动作由执行器负责幂等/去重；
- 在真实系统前先用参考执行器做端到端演练。
