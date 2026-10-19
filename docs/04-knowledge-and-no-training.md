# 04 · 知识与免训练：经验如何进入系统

## 1. 结论先行

本框架不做任何形式的训练：

- 不调用 fine-tune / SFT / DPO / LoRA 接口；
- 不下载或运行 embedding 模型；
- 不建向量数据库；
- 不更新任何模型参数；
- 知识以**文件、图谱、索引、统计台账**的形式存在。

模型是可替换的语言与推理供应商；知识是系统自己的持久状态。两者只在“把知识索引放进提示词、把工具结果回喂模型”处交汇。

## 2. 为什么不用微调

| 维度 | 微调 | 本框架 |
| --- | --- | --- |
| 一次事实修正 | 需要重新准备数据、训练、评测、部署 | 改一个 JSON/Markdown 单元 |
| 更换模型供应商 | 知识随参数留在旧模型 | 知识文件不动，换端点即可 |
| 可解释性 | 参数里不可读 | 每个知识单元有 id、标题、摘要、正文 |
| 回滚 | 回滚模型版本 | 删除或改回一个文件 |
| 权限副作用 | 训练数据可能夹带越权模式 | 知识不承载权限，权限只在运行时 |
| 成本 | 随修正次数累积 | 按层递减 |

微调优化的是“模型更可能想出正确动作”；本框架优化的是“无论模型想出什么，系统只执行被允许的动作”。两者正交，但后者更直接对应生产事故。

## 3. 知识三层与三个物理位置

| 层 | `kind` | 角色 | 物理位置 |
| --- | --- | --- | --- |
| 原始种子库 | `seed` | 系统元规则、已验证的核心路径、包内置手册 | `src/packs/manifests/*.json` 的 `knowledge`；可选 `.ruling/knowledge/seed.json` 本地覆盖/追加 |
| 经验库 | `extended` | 运行时积累的任务经验 | `.ruling/knowledge/experience.jsonl` |
| 失败教训库 | `error` | 已发生错误的规避路径 | `.ruling/knowledge/errors.jsonl` |

写入路径：

- `knowledge.add` → `extended` → `experience.jsonl`；
- `lesson.add` → `error` → `errors.jsonl`；
- 执行失败 → 自动生成 `failure:<action>` → `errors.jsonl`（带失败原因与错误码）；
- `seed` 由 manifest 与本地 `seed.json` 在引擎启动时重新载入，**不写进 state 快照**；
- 外部知识源（见第 12 节）只读加载，`origin` 为 `external:<id>`，不写进本地库。

这三层不是同一个大数组的三个标签，而是三套独立持久化：改种子不会污染经验，清理经验不会丢教训。审批状态不属于任何一层，它只在内存里。

## 4. 哈希嵌入

### 4.1 特征

- ASCII 词元：`[a-z0-9_]+`；
- CJK 单字；
- CJK 二元组。

例如 `DFM 检查` 产生 `w:dfm`、`c:检`、`c:查`、`b:检查`。

### 4.2 编码

```text
FNV-1a(feature) → splitmix 混合 → bucket = hash % 128
sign = 最高位 ? -1 : +1
vector[bucket] += sign
L2 归一化
i8 量化（每维约 1 字节）
```

性质：

- 确定性：同一文本永远同一向量；
- O(len) 计算；
- 零依赖；
- 无模型版本迁移；
- 每向量约 128 字节。

### 4.3 代价

哈希嵌入刻画的是**字符重叠**，不是语义相似：

- 同义词、跨语言、抽象改写会弱于神经嵌入；
- 千级节点以内有效；上万节点或细粒度语义要求提高时首先失效。

补救手段是确定性的前置路由与关键词候选，而不是再引入一个模型。

## 5. 图谱

边类型：

- `mentions`：知识单元提到某个概念；
- `uses`：知识单元推荐某个动作；
- `caused`：任务导致动作、动作导致结果；
- `coOccurs`：共同出现。

权重：

```text
w(t) = (w0 + gain) * 2^(-Δt / 14天)
```

- 成功增益：任务→动作 0.18，动作→结果 0.14；
- 失败增益：0.14 × 0.4 = 0.056；
- 低于 0.02 修剪；
- 封顶 1.0。

失败经验以较低权重保留：它能影响路由，但不会像成功路径一样主导。

## 6. 冷热分层

- 结构记忆（`seed` / `error`）永不下沉；
- 扩展记忆温度：

```text
temperature = ln(1 + hits) + 2^(-age / 3天)
```

- 低于 0.15 标记为冷；
- 冷单元仍可被检索，只是分数乘 0.9；
- 命中后立即回热。

冷热只影响检索排序与内存，不影响权限。

## 7. 因果链

每次执行：

```text
task hash → action → outcome(ok|fail)
```

写入图谱边，并作为 `caused` 边参与后续路由。它不是训练：

- 不改变模型；
- 不改变动作表；
- 不改变区域；
- 只影响“哪些知识单元更可能被前置路由命中”。

## 8. 前置路由

`engine.prepare(task)`：

1. 查询向量与每个知识单元做余弦；
2. 类型先验：seed ×1.15，error ×1.10，extended ×1.0；
3. 取前 3 个种子，沿边给邻居加 `0.1 × 边权 × 种子分`；
4. 过滤分数 ≤ 0.05，取 topK（默认 5）；
5. 更新命中次数与热度；
6. 用知识单元的 `uses` 边给候选动作加分；
7. 与动作关键词分数合并，排序。

关键点：**检索保留，裁决权取消**。向量只提名候选；进入哪个决策单元由确定性路由与动作表决定。排序还叠加别名/同义词、领域/标签、状态与置信度权重，详见第 11 节。

## 9. 上下文预算

- 默认 `contextK = 128`（千 token）；
- 字符估算：1 token ≈ 1.5 字符；
- 系统提示保留；
- 从最新消息回溯累加，超预算时跳过最老的非 system 消息；
- 单条工具结果上限 4000 字符；
- 历史数组本身不改，只裁“发送视图”。

这避免“为了记住全部历史而把上下文塞爆”，也避免改写用户可见的会话记录。

## 10. 知识更新

| 方式 | 操作 | 写入位置 | 生效 |
| --- | --- | --- | --- |
| 包内置种子 | 修改 manifest `knowledge` | 代码 | 下次创建引擎 |
| 本地种子 | 编辑 `.ruling/knowledge/seed.json` | 本地种子文件 | 下次创建引擎（不被快照覆盖） |
| 运行时经验 | `knowledge.add` 动作 | `experience.jsonl` | 当前引擎立即；保存后跨进程 |
| 人工教训 | `lesson.add` 动作 | `errors.jsonl` | 当前引擎立即；保存后跨进程 |
| 自动教训 | 执行失败 | `errors.jsonl` | 当前引擎立即；保存后跨进程 |
| 外部知识 | `.ruling/config.json` 的 `knowledge.external` | 外部源（只读） | 启动时 / `loadExternalKnowledge()` |
| 经验统计 | 自动写入台账/因果链 | `state.json.gz` | 执行后立即 |

持久化布局：

```text
.ruling/
├─ knowledge/
│  ├─ seed.json          # 可选：本地种子覆盖/追加，不由引擎写入
│  ├─ experience.jsonl   # extended
│  └─ errors.jsonl       # error / failure
├─ state.json.gz         # { version: 2, savedAt, graph, ledger }
└─ audit.jsonl           # 执行审计与失败详情
```

`state.json.gz` 不再包含知识单元；它只保存图谱与台账。旧版 `version: 1`（内嵌 `knowledge`）仍可读取，并在下次保存时迁移为 v2。审批状态不在任何文件中。

## 11. 语义化管理

语义管理是确定性的，不引入神经模型：用元数据、同义词、别名与状态权重把“检索”变成“有语义边界的管理”。

### 11.1 语义元数据

每个知识单元可带：

| 字段 | 作用 |
| --- | --- |
| `namespace` | 归属命名空间，默认 `local`；外部源默认 `external` |
| `domain` | 业务领域，如 `delivery`、`safety` |
| `aliases` | 别名/同义词，参与检索加分 |
| `status` | `draft` / `active` / `deprecated` |
| `confidence` | 0..1，参与排序 |
| `version` | 版本号；`update` 自动递增 |
| `supersedes` | 被本单元替代的旧单元 |
| `supersededBy` | 本单元被哪个单元替代 |
| `contradicts` | 显式冲突关系 |
| `validFrom` / `validUntil` | 生效时间窗 |
| `reviewedBy` / `reviewedAt` | 审核人与审核时间 |

状态含义：

- `draft`：候选知识，排序乘 0.85；
- `active`：可用知识，排序乘 1.0；
- `deprecated`：过期知识，排序乘 0.5，默认仍可被显式检索到，但不会主导候选。

### 11.2 同义词文件

`.ruling/knowledge/synonyms.json`：

```json
{
  "交付": ["交付物", "deliverable", "delivery"],
  "安全": ["safety", "合规", "compliance"]
}
```

也支持数组形式：

```json
[["交付", "交付物", "deliverable"], ["安全", "safety", "合规"]]
```

查询词命中组内任一词时，整组参与别名加分。

### 11.3 混合排序

```text
score = (余弦相似度 × 类型先验 × 冷热系数
         + 别名加分 + 领域/标签加分)
        × 状态权重 × 置信度权重
```

- 别名加分：每个命中别名 +0.15，封顶 0.6；
- 领域/标签加分：领域 +0.1、每个标签 +0.05，封顶 0.3；
- 状态与置信度权重不改变权限，只影响候选排序；
- 图谱邻接加成仍在排序后施加。

### 11.4 生命周期动作

| 动作 | 行为 |
| --- | --- |
| `knowledge.review` | 标记 `active`，记录 `reviewedBy/reviewedAt`，可设置 `confidence` |
| `knowledge.deprecate` | 标记 `deprecated`，设置 `validUntil`，可指定 `supersededBy` 与原因 |
| `knowledge.merge` | 把重复单元的别名/标签/推荐动作合并到规范单元，废弃重复项，写入 `supersedes` |

这些都是黄灯动作：需要任务级批准，和普通写操作一样受门控。

### 11.5 检查命令

```bash
pnpm ruling knowledge search "交付物" --top 5
pnpm ruling knowledge list --namespace company --status active
pnpm ruling knowledge dedupe --threshold 0.95
pnpm ruling knowledge conflicts
pnpm ruling knowledge stats
```

- `dedupe` 用向量余弦 + 共享别名找近重复；
- `conflicts` 只报告显式 `contradicts`，不做语义矛盾推断；
- `stats` 按层/状态/命名空间/领域统计。

## 12. 外部知识库扩展

外部知识源是只读输入；它们进入内存索引，但不写入 `experience.jsonl` / `errors.jsonl`。

配置位置：`.ruling/config.json`

```json
{
  "knowledge": {
    "dir": ".ruling/knowledge",
    "seedFile": ".ruling/knowledge/seed.json",
    "experienceFile": ".ruling/knowledge/experience.jsonl",
    "errorsFile": ".ruling/knowledge/errors.jsonl",
    "external": [
      {
        "id": "company-handbook",
        "type": "markdown",
        "dir": "docs/handbook",
        "kind": "extended",
        "tags": ["company"]
      },
      {
        "id": "incident-lessons",
        "type": "jsonl",
        "path": "knowledge/incidents.jsonl",
        "kind": "error"
      },
      {
        "id": "design-wiki",
        "type": "http",
        "url": "http://127.0.0.1:8080/knowledge.json",
        "timeoutMs": 5000
      }
    ]
  }
}
```

支持的类型：

| `type` | 必填字段 | 读取方式 |
| --- | --- | --- |
| `json` | `path` | 文件内数组，或 `{ "units": [...] }` |
| `jsonl` | `path` | 每行一个知识单元；坏行跳过 |
| `markdown` | `dir` | 递归读取 `.md`；标题取一级标题，摘要取首个段落 |
| `http` | `url` | GET JSON；默认 10 秒超时，2MB 上限 |

字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 源 id，用作 `origin` 与默认 id 前缀 |
| `kind` | `seed` / `extended` / `error`，默认 `extended` |
| `tags` | 附加到该源所有单元 |
| `prefix` | 默认 `ext:<id>:` |
| `enabled` | `false` 可临时停用 |
| `headers` | HTTP 请求头（如认证头） |

加载：

- CLI / HTTP / MCP 启动时会自动加载配置中的外部源；
- 作为库使用时调用 `await engine.loadExternalKnowledge(config.external ?? [])`；
- 加载失败按源隔离：一个源失败不会阻止其他源；
- 外部源的 `uses` 字段会参与大脑前置的候选动作加分。

安全边界：

- 外部源配置来自本地配置工件，不来自模型；
- HTTP 源只做 GET，建议指向内网/回环地址；
- 外部内容仍可能包含提示词注入文本，执行权仍在门禁，不因知识内容而扩大。

## 13. 与 RAG 的差异

| 维度 | 常规 RAG | 本框架 |
| --- | --- | --- |
| 检索结果 | 直接拼进提示词 | 只提名候选，由前置路由决定单元 |
| 裁决权 | 相似度决定模型看到什么 | 路由决定；相似度不参与最终排序 |
| 知识更新 | 重建索引/嵌入 | 文件修改、按层更新 |
| 权限 | 无 | 与知识生命周期完全分离 |

## 14. 已知局限

- 语义天花板：字符重叠无法理解同义改写；
- 冷启动：因果链为空时路由质量有限；
- 换域成本：种子库与关键词是领域定制的，跨域后需要补种子；
- 规模上限：设计目标是千级节点、本地工作区；
- 没有受控基线：未在固定任务集上对比有/无知识层的成功率。
