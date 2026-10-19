# Ruling Framework（裁定权框架）

> 模型提议，系统裁定；命令执行，门禁验证。

面向 **OPC（一人公司）**、**小公司**、**工业设计（产品/结构设计）** 的通用大模型 Agent 框架。它不训练、不微调、不做 SFT/LoRA，也不依赖 embedding 模型或向量数据库。模型只负责提出“调哪个动作、传什么参数”；能不能执行、以什么边界执行、执行后如何记账和验证，全部由本地确定性内核决定。

本项目是独立项目：独立目录、独立依赖、独立构建，不依赖任何外部编辑器或应用框架。

---

## 30 秒开始

```bash
pnpm install
pnpm verify          # typecheck + 124 tests + 两个端到端 demo
pnpm demo            # OPC：绿/黄/红、审批、未知动作、Agent 循环、审计
pnpm demo:industrial # 工业设计：动态红灯、格式锁、版本溯源
```

初始化一个工作区：

```bash
pnpm ruling init --pack opc
pnpm ruling catalog
pnpm ruling knowledge list
pnpm ruling knowledge search "交付流程"
pnpm ruling knowledge stats
pnpm ruling exec workspace.list --task "查看工作区"
```

写操作需要显式批准：

```bash
# 第一次返回 needConfirm，退出码 2
pnpm ruling exec doc.write --task "写交付说明" \
  --params '{"path":"out/readme.md","content":"# Delivery"}'

# 同一进程内显式批准并执行
pnpm ruling exec doc.write --task "写交付说明" \
  --params '{"path":"out/readme.md","content":"# Delivery"}' --yes
```

运行本地 HTTP 服务：

```bash
pnpm ruling serve --http --port 39100
curl http://127.0.0.1:39100/health
```

运行 MCP stdio 服务：

```bash
pnpm ruling serve --mcp
```

---

## 它解决什么

| 结构性缺陷 | 常见表现 | 本框架的约束 |
| --- | --- | --- |
| 执行过程黑盒 | 模型说“已完成”，但不知道做了什么 | 唯一执行入口 + 决策回执 + 审计哈希链 |
| 行动边界缺失 | 能力所及即执行，删错文件、发布错版本 | 三区门控 + 源头能力授权 + 数据边界 |
| 经验复用失效 | 同一问题换个说法就重新推理 | 大脑前置路由 + 知识三层 + 因果链 |
| 运行成本失控 | 全库检索、全量重嵌入、微调再训练 | 按需知识索引 + 哈希嵌入 + 零参数更新 |
| 权限腐化 | 上次批准被这次任务继承 | 审批仅运行态、任务绑定、TTL 过期 |

核心判断：**可靠性不取决于模型能力，而取决于把验证、执行、放行三类裁定权从模型侧迁移到机器可校验组件。**

---

## 核心不变量

1. **三类裁定权外置**：验证归机器门禁，执行归唯一命令中心，放行归用户源头授权。
2. **门控是纯函数**：`gate(zone, approved, known) -> autoExecute | needConfirm | deny`。
3. **未登记动作永远不执行**：即使任务已批准，`known=false` 仍返回 `needConfirm`。
4. **红灯即使批准也拒绝**。
5. **审批只存运行态**：任务文本绑定、TTL 过期、纯内存、不跨进程、不写快照。
6. **知识持久，权限不持久**。
7. **效能门不是安全门**：0.99 只影响计划建议，不能放行黄灯写操作。
8. **能力面封闭**：能力表之外的动作，模型无论怎么提议都调不到。
9. **批准不是模型工具**：CLI 用 `--yes`，HTTP 用 `POST /approve`；MCP 不暴露 approve。
10. **一条命令 = 一个意图 = 一个权限区域 = 一条审计记录。**

---

## 架构一览

```text
CLI / HTTP / MCP / SDK
        │
        ▼
Agent 循环（提议层，可替换）
  · OpenAI 兼容 Provider
  · 弱模型护栏、上下文预算、正文工具方言
        │  proposals only
        ▼
RulingEngine（唯一执行入口）
  · 能力面登记 → 源头授权 → 区域解析 → gate()
  · 数据边界（路径/格式/体积）→ 输入 schema
  · ActionExecutor（唯一执行通道）
  · 台账 + 因果链 + 审计哈希链
        │
        ▼
Workspace（受控文件系统）/ 行业适配器
```

大脑前置（`engine.prepare`）会在模型主推理前完成分段、知识路由、候选动作预测，并在唯一高置信度绿灯动作时直接执行、完全不经过 LLM。

---

## 目录结构

```text
ruling-framework/
├─ src/
│  ├─ core/            # 门控、审批、效能、台账、审计、工作区、知识、planner、engine
│  ├─ agent/           # Provider、循环、提示词、方言解析、会话
│  ├─ packs/           # OPC / 小公司 / 工业设计参考包
│  ├─ adapters/        # CLI / HTTP / MCP
│  ├─ demo/            # 两个端到端演示
│  └─ test-support/    # 测试临时目录
├─ docs/               # 9 篇设计文档
└─ package.json
```

测试与源码同目录，命名 `*.spec.ts`。

---

## 三个行业参考包

| 包 | 角色 | 典型红灯 | 特点 |
| --- | --- | --- | --- |
| `opc` | owner | 发布、付款、删除 | 一个人 + AI 员工；写操作逐任务批准 |
| `smb` | owner/editor/reviewer/viewer | 权限变更、发布、删除 | 能力组授权；发布准备需 reviewer + owner 双批准 |
| `industrial-design` | designer/engineer/reviewer/owner | 安全参数、发布、安全签核 | 动态红灯；格式锁；版本与变更溯源 |

详细动作表见 [`docs/05-industry-packs.md`](docs/05-industry-packs.md)。

---

## 免训练的知识注入

- **三层知识，三层存储**：
  - `seed`：包内置规则，源文件是 `src/packs/manifests/*.json` 的 `knowledge` 数组；可用 `.ruling/knowledge/seed.json` 追加本地种子。
  - `extended`：运行时经验，写入 `.ruling/knowledge/experience.jsonl`。
  - `error`：失败教训，写入 `.ruling/knowledge/errors.jsonl`；`lesson.add` 登记人工复盘，执行失败自动生成 `failure:<action>`。
- **外部知识源**：JSON、JSONL、Markdown 目录、HTTP JSON，配置在 `.ruling/config.json` 的 `knowledge.external`；只读加载，不复制进本地库。
- **语义化管理**：命名空间、领域、别名、状态（draft/active/deprecated）、置信度、版本、替代关系；同义词扩展与混合检索；`knowledge.review`、`knowledge.deprecate`、`knowledge.merge` 生命周期动作；`knowledge dedupe` 与 `knowledge conflicts` 检查。
- **哈希嵌入**：ASCII 词元 + CJK 单字/二元组，FNV-1a，128 桶，i8 量化；确定性、零依赖。
- **图谱**：`mentions / uses / caused / coOccurs`，14 天半衰期，低于 0.02 修剪。
- **冷热分层**：结构记忆永不下沉；扩展记忆按频次 + 3 天新近度冷却。
- **因果链**：任务→动作→结果，成功增益 0.18/0.14，失败增益 0.4 倍。
- **上下文预算**：提示词只放知识索引，全文按需读取；超预算裁最老的非 system 消息。

没有任何梯度更新、SFT、LoRA、fine-tune 接口或 embedding 模型调用。详见 [`docs/04-knowledge-and-no-training.md`](docs/04-knowledge-and-no-training.md)。

---

## 验证状态（2026-10-19）

- `pnpm typecheck`：通过（strict）。
- `pnpm test`：21 个测试文件，124 个用例全部通过。
- `pnpm demo`：OPC 端到端通过。
- `pnpm demo:industrial`：工业设计端到端通过。
- `pnpm build`：通过。
- 编译产物 CLI 的 `init / catalog / knowledge list / exec / audit verify / audit export` 实测通过。
- MCP stdio 的 `initialize / tools/list / tools/call` 实测通过。
- HTTP 的 `GET /health`、`POST /execute` 实测通过。

---

## 明确边界

- 不是操作系统沙箱：同机同用户有文件系统权限即可绕过应用内门。
- token 不是鉴权凭据；HTTP 只绑定 `127.0.0.1`。
- 角色是适配器断言，不是登录认证。
- 工业设计包是 JSON 参考实现，不是真实 CAD/PLM 集成。
- 不支持多租户、远程监听、多 Agent 协作。
- 没有 UI；交互面是 CLI / HTTP / MCP。
- 没有受控对比基线；本文档不宣称相对无约束系统的量化可靠性提升。
- 审计哈希链是防篡改留痕，不是法律认证。

完整清单见 [`docs/08-limitations.md`](docs/08-limitations.md)。

---

## License

Apache License 2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

You may use, modify, and distribute this project under the Apache License 2.0,
including for commercial purposes, provided you preserve the license and
attribution notices.
