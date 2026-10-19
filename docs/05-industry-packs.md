# 05 · 行业包：OPC、小公司、工业设计

行业包 = 一份 manifest（角色、授权、动作、区域、格式锁、知识种子）+ 一个执行器。核心引擎不认识任何行业概念。

## 1. OPC（一人公司）

### 1.1 角色与授权

| 角色 | 授权 |
| --- | --- |
| `owner` | `*`（全部能力组） |

默认角色：`owner`。审批：单角色，TTL 10 分钟。

### 1.2 动作表

| 动作 | 区域 | 能力组 | 说明 |
| --- | --- | --- | --- |
| `workspace.list` | 绿 | read | 列出目录 |
| `workspace.read` | 绿 | read | 读文本文件 |
| `doc.read` | 绿 | read | 读交付文档 |
| `doc.write` | 黄 | write | 写文档 |
| `asset.import` | 黄 | write | 导入文本资产 |
| `project.build` | 黄 | build | 生成构建清单 |
| `knowledge.add` | 黄 | knowledge | 登记经验/作业程序 |
| `lesson.add` | 黄 | knowledge | 登记失败教训与规避路径 |
| `knowledge.review` | 黄 | knowledge | 审核并标记 active |
| `knowledge.deprecate` | 黄 | knowledge | 标记 deprecated，可指定替代 |
| `knowledge.merge` | 黄 | knowledge | 合并重复知识 |
| `report.export` | 黄 | deliver | 导出交付报告 |
| `project.publish` | 红 | external | 对外发布 |
| `payment.execute` | 红 | external | 对外付款 |
| `workspace.delete` | 红 | destructive | 删除文件/目录 |

### 1.3 典型流程

```text
读现状（绿）
  → 写交付文档（黄，批准）
  → 构建（黄，批准）
  → 导出报告（黄，批准）
  → 导出审计/溯源
发布、付款、删除：红灯，人工在框架外完成
```

### 1.4 格式锁

`.pdf` 只能由 `report.export` 通道写入，避免通用文本直接伪造交付报告。

## 2. 小公司

### 2.1 角色与授权

| 角色 | 授权 |
| --- | --- |
| `owner` | `*` |
| `editor` | read, write, build, deliver, release |
| `reviewer` | read, review |
| `viewer` | read |

默认角色：`editor`。

### 2.2 审批策略

```json
{
  "ttlMs": 600000,
  "defaultRoles": ["owner"],
  "byGroup": { "release": ["reviewer", "owner"] }
}
```

`release` 组的动作需要 `reviewer` 与 `owner` **两个不同角色**分别批准；同一角色重复批准不计数。

### 2.3 动作表

| 动作 | 区域 | 能力组 | 说明 |
| --- | --- | --- | --- |
| `workspace.list` | 绿 | read | 列目录 |
| `workspace.read` | 绿 | read | 读文件 |
| `doc.read` | 绿 | read | 读文档 |
| `doc.write` | 黄 | write | 写文档 |
| `asset.import` | 黄 | write | 导入资产 |
| `project.build` | 黄 | build | 构建 |
| `team.invite` | 黄 | write | 邀请成员 |
| `review.request` | 黄 | review | 发起评审 |
| `knowledge.add` | 黄 | knowledge | 登记经验/作业程序 |
| `lesson.add` | 黄 | knowledge | 登记失败教训与规避路径 |
| `knowledge.review` | 黄 | knowledge | 审核并标记 active |
| `knowledge.deprecate` | 黄 | knowledge | 标记 deprecated，可指定替代 |
| `knowledge.merge` | 黄 | knowledge | 合并重复知识 |
| `report.export` | 黄 | deliver | 导出报告 |
| `release.prepare` | 黄 | release | 准备发布包（双批准） |
| `release.publish` | 红 | release | 对外发布 |
| `role.grant` | 红 | admin | 变更角色/权限 |
| `workspace.delete` | 红 | destructive | 删除 |

### 2.4 为什么要双批准

一个人可以完成“准备”，但“发布”影响外部。双批准把两类裁定分开：

- reviewer 判断质量；
- owner 判断商业与责任；
- 两者都到位，`release.prepare` 才执行。

`release.publish` 仍然是红灯：即使双批准，也不由框架执行，必须在发布系统里由人完成。

`role.grant` 是红灯：权限体系的变化不能由 Agent 自主执行。即使 owner 批准，也返回 `RED_LINE`。

## 3. 工业设计

### 3.1 角色与授权

| 角色 | 授权 |
| --- | --- |
| `designer` | read, write, analyze, knowledge |
| `engineer` | read, write, analyze, knowledge |
| `reviewer` | read, analyze |
| `owner` | `*` |

默认角色：`designer`。审批：默认 owner，TTL 15 分钟；`release` 组要求 reviewer + owner。

### 3.2 动作表

| 动作 | 区域 | 能力组 | 说明 |
| --- | --- | --- | --- |
| `design.list` | 绿 | read | 列出设计对象 |
| `design.read` | 绿 | read | 读参数/BOM/版本/溯源 |
| `dfm.check` | 绿 | analyze | 可制造性检查（仅建议） |
| `design.create` | 黄 | write | 创建草稿 |
| `design.create_revision` | 黄 | write | 创建新版本 |
| `design.set_param` | 黄/动态红 | write | 修改参数 |
| `design.attach_asset` | 黄 | write | 附加资产 |
| `bom.update` | 黄 | write | 更新 BOM |
| `cad.import` | 黄 | write | 导入 CAD 交换格式 |
| `report.export` | 黄 | deliver | 导出设计报告 |
| `knowledge.add` | 黄 | knowledge | 登记设计规范 |
| `lesson.add` | 黄 | knowledge | 登记设计失败教训与规避路径 |
| `knowledge.review` | 黄 | knowledge | 审核并标记 active |
| `knowledge.deprecate` | 黄 | knowledge | 标记 deprecated，可指定替代 |
| `knowledge.merge` | 黄 | knowledge | 合并重复知识 |
| `design.release` | 红 | release | 正式发布 |
| `safety.signoff` | 红 | signoff | 安全/合规签核 |

### 3.3 动态红灯

`design.set_param` 的区域不是固定的。解析器检查：

1. 参数名是否属于安全关键集合：`wallThickness`、`safetyFactor`、`materialGrade`、`loadRating`；
2. 请求是否显式标记 `safetyCritical: true`；
3. 设计对象中该参数是否已被标记为 `safetyCritical`。

任一命中 → `red`。红灯在批准之前判定，批准也无法放行。

### 3.4 格式锁

| 扩展名 | 专用通道 | 原因 |
| --- | --- | --- |
| `.step/.stp/.iges/.igs/.stl/.3mf` | `cad.import` | CAD 二进制/交换格式 |
| `.pdf` | `report.export` | 交付 PDF |
| `.csv/.xlsx` | `bom.update` | BOM 表格 |

通用 `design.attach_asset` 写 `.step` 会返回 `FORMAT_LOCKED`；必须调用 `cad.import`。

### 3.5 版本与溯源

每次变更写入 `designs/<id>.json`：

```json
{
  "id": "bracket",
  "revision": 1,
  "status": "draft",
  "params": { "length": { "value": 120, "safetyCritical": false } },
  "bom": [],
  "files": ["bracket.step"],
  "provenance": [
    {
      "ts": 0,
      "action": "design.set_param",
      "actorRole": "designer",
      "revision": 1,
      "beforeHash": "...",
      "afterHash": "...",
      "note": "param:length"
    }
  ]
}
```

`provenance` 记录时间、动作、执行者角色、修订号、变更前后哈希。`report.export` 可把该记录写进交付报告。

### 3.6 发布与签核

`design.release` 与 `safety.signoff` 是红灯：

- 发布影响外部交付与责任；
- 安全/合规签核需要资质与法律主体；
- 框架只记录“谁在何时尝试过”，不代替人签核。

## 4. 三个包的共同结构

```text
manifest
├─ roles / defaultRole
├─ grants        # 角色 → 能力组
├─ approval      # TTL + 默认角色 + 按组多角色
├─ formatLocks   # 扩展名 → 专用通道
├─ actions       # 动作表（区域、预算、schema）
└─ knowledge     # seed 单元 + uses 边
```

执行器：

```ts
interface ActionExecutor {
  execute(ctx: ExecContext): Promise<{ result?: unknown; files?: string[] }>;
  handles?(action: string): boolean;
}
```

`ctx.workspace` 是唯一文件访问面。

## 5. 新增一个行业包

1. 复制一个现有 manifest，改 `id/name/roles/grants/actions`。
2. 为每个动作写 handler；红灯动作可以是 `blockedByRedLine`（永远不会被调用）。
3. 如有上下文相关区域，注册 `dynamicZone` 解析器。
4. 补知识种子：至少覆盖“先读后写”“红灯清单”“关键工作流”。
5. 在 `packs/loader.ts` 注册工厂。
6. 运行 `pnpm ruling validate --pack <id>`。
7. 补测试：动作表完整性、红灯不可批准、动态红灯、格式锁、双批准（如有）。

## 6. 不要做的事

- 不要把“提示词里写了不允许”当成权限；必须在动作表或执行器里拦截。
- 不要把红灯改成黄灯来“让流程跑通”；红灯是责任边界。
- 不要让执行器绕过 `ctx.workspace` 直接 `fs` 写文件。
- 不要把审批结果写进配置文件或数据库。
- 不要把行业知识写进系统提示词的硬编码字符串；放进知识单元。
