# 06 · 操作：安装、运行与排障

## 1. 环境

- Node.js ≥ 20（实测 Node 22）；
- pnpm ≥ 10（实测 pnpm 11）；
- 无需 API Key 即可运行测试与演示。

```bash
pnpm install
pnpm verify
```

`pnpm verify` = `typecheck + test + demo + demo:industrial`。

## 2. 初始化工作区

```bash
pnpm ruling init --pack opc
```

生成：

```text
.ruling/config.json
```

示例：

```json
{
  "pack": "opc",
  "workspace": ".",
  "trust": "agent",
  "role": "owner",
  "provider": {
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
    "apiKeyEnv": "RULING_API_KEY",
    "contextK": 128
  },
  "knowledge": {
    "dir": ".ruling/knowledge",
    "seedFile": ".ruling/knowledge/seed.json",
    "synonymsFile": ".ruling/knowledge/synonyms.json",
    "experienceFile": ".ruling/knowledge/experience.jsonl",
    "errorsFile": ".ruling/knowledge/errors.jsonl",
    "external": []
  },
  "audit": { "ringSize": 50, "file": ".ruling/audit.jsonl" }
}
```

`workspace` 是相对配置文件所在目录的路径。API Key 只从环境变量读取，不写入配置。

## 3. 常用命令

```bash
# 列出动作与区域
pnpm ruling catalog
pnpm ruling catalog --json

# 列出行业包
pnpm ruling packs

# 校验 pack
pnpm ruling validate --pack industrial-design

# 查看三层知识
pnpm ruling knowledge list
pnpm ruling knowledge list --kind seed
pnpm ruling knowledge list --kind extended --json
pnpm ruling knowledge list --kind error
pnpm ruling knowledge list --namespace company --status active

# 语义检索与检查
pnpm ruling knowledge search "交付物" --top 5
pnpm ruling knowledge dedupe --threshold 0.95
pnpm ruling knowledge conflicts
pnpm ruling knowledge stats

# 登记经验（extended）
pnpm ruling exec knowledge.add --task "登记经验" \
  --params '{"id":"exp:1","title":"交付顺序","body":"先写文档再构建","namespace":"company","domain":"delivery","aliases":["交付物"],"tags":["workflow"],"status":"draft","confidence":0.6}' --yes

# 登记失败教训（error）
pnpm ruling exec lesson.add --task "登记教训" \
  --params '{"id":"lesson:1","title":"不要直接写 STEP","body":"走 cad.import","uses":["cad.import"]}' --yes

# 审核 / 废弃 / 合并
pnpm ruling exec knowledge.review --task "审核知识" \
  --params '{"id":"exp:1","confidence":0.95}' --yes
pnpm ruling exec knowledge.deprecate --task "废弃知识" \
  --params '{"id":"exp:1","reason":"被新流程替代","supersededBy":"exp:2"}' --yes
pnpm ruling exec knowledge.merge --task "合并知识" \
  --params '{"canonicalId":"exp:1","duplicateIds":["exp:dup"]}' --yes

# 执行一个动作
pnpm ruling exec workspace.list --task "查看工作区" --json

# 黄灯：第一次返回 needConfirm，退出码 2
pnpm ruling exec doc.write --task "写说明" \
  --params '{"path":"a.md","content":"x"}' --json

# 同一进程内显式批准并执行
pnpm ruling exec doc.write --task "写说明" \
  --params '{"path":"a.md","content":"x"}' --yes --json

# 计划级建议（不替代单次门控）
pnpm ruling plan workspace.list project.build --task "准备交付"

# Agent 循环（真实模型）
export RULING_BASE_URL=http://127.0.0.1:11434/v1
export RULING_MODEL=qwen2.5:7b
export RULING_API_KEY=
pnpm ruling ask "写一份交付说明并构建" --yes

# 没有模型时用启发式 Provider
pnpm ruling ask "查看工作区" --mock --json

# 审计
pnpm ruling audit
pnpm ruling audit verify
pnpm ruling audit export --format md
pnpm ruling audit export --format json
```

### 3.1 审批为什么没有独立 CLI 命令

审批只存运行态、不跨进程。`ruling approve` 在一个新进程里批准，然后进程退出，授权也随之消失，命令会误导使用者。因此：

- CLI：用 `--yes` 在同一进程内批准；
- HTTP：`POST /approve` 对**同一运行进程**生效；
- 宿主应用：实现自己的 `onConfirm` 回调。

跨进程持久化审批被明确禁止。

## 4. 真实模型

任何 OpenAI 兼容端点：

```bash
export RULING_BASE_URL=https://api.openai.com/v1
export RULING_MODEL=gpt-4o-mini
export RULING_API_KEY=sk-...
```

本地：

```bash
# Ollama
export RULING_BASE_URL=http://127.0.0.1:11434/v1
export RULING_MODEL=qwen2.5:7b
export RULING_API_KEY=

# LM Studio
export RULING_BASE_URL=http://127.0.0.1:1234/v1
export RULING_MODEL=local-model
```

空 Key 时不发送 `Authorization`。Provider 在端点返回 400/422 时会自动去掉 `tools` 重试一次，兼容不支持原生工具调用的模型。

## 5. HTTP 服务

```bash
pnpm ruling serve --http --port 39100
```

只绑定 `127.0.0.1`。

```bash
curl http://127.0.0.1:39100/health
curl http://127.0.0.1:39100/catalog
curl http://127.0.0.1:39100/stats
curl http://127.0.0.1:39100/audit?limit=20

# operator 信任：不逐动作批准
curl -X POST http://127.0.0.1:39100/execute \
  -H 'content-type: application/json' \
  -d '{"task":"写说明","action":"doc.write","params":{"path":"a.md","content":"x"},"trust":"operator"}'

# agent 信任：先 needConfirm
curl -X POST http://127.0.0.1:39100/execute \
  -H 'content-type: application/json' \
  -d '{"task":"写说明","action":"doc.write","params":{"path":"a.md","content":"x"},"trust":"agent"}'

# 对同一进程批准后重试
curl -X POST http://127.0.0.1:39100/approve \
  -H 'content-type: application/json' \
  -d '{"task":"写说明","role":"owner"}'
```

可选 token：

```bash
pnpm ruling serve --http --token local-secret
curl -H 'x-ruling-token: local-secret' http://127.0.0.1:39100/health
```

token 不是鉴权凭据；不要端口转发到局域网/公网。

## 6. MCP 服务

```bash
pnpm ruling serve --mcp
```

客户端配置示例（路径按实际修改）：

```json
{
  "mcpServers": {
    "ruling": {
      "command": "node",
      "args": [
        "C:/dev/projects/ruling-framework/dist/adapters/cli.js",
        "serve",
        "--mcp",
        "--pack",
        "opc",
        "--role",
        "owner"
      ],
      "env": {
        "RULING_BASE_URL": "https://api.openai.com/v1",
        "RULING_MODEL": "gpt-4o-mini",
        "RULING_API_KEY": "sk-..."
      }
    }
  }
}
```

注意：

- MCP 进程的 `cwd` 决定 `.ruling/config.json` 与相对 `workspace` 的解析位置。建议把客户端的工作目录设置为项目目录，或在配置里写绝对 `workspace`。
- 默认信任模式来自 `.ruling/config.json`；也可显式 `--trust operator|agent`。
- `tools/list` 只暴露当前角色获授权的动作。
- 没有 approve 工具；`needConfirm` 时请对同一进程使用 HTTP `/approve`，或在 CLI 使用 `--yes`。

## 7. 作为库使用

```ts
import { createEngineForPack } from "ruling-framework/packs";

const { engine } = createEngineForPack("opc", {
  workspace: { root: "C:/work/demo" }
});

const outcome = await engine.execute({
  task: "写交付说明",
  action: "doc.write",
  params: { path: "out/readme.md", content: "# Delivery" },
  trust: "agent",
  actor: { role: "owner" },
  source: "http"
});

if (outcome.status === "needConfirm") {
  // 展示给人类；不要自动批准
}
```

构建产物通过子路径导出：`ruling-framework/core`、`/agent`、`/packs`。

## 8. 文件与状态

| 路径 | 内容 | 可删除？ |
| --- | --- | --- |
| `.ruling/config.json` | pack/role/trust/provider/knowledge | 会回到默认 |
| `.ruling/knowledge/seed.json` | 可选本地种子；引擎不写 | 可删；下次启动生效 |
| `.ruling/knowledge/synonyms.json` | 同义词组，用于查询扩展 | 可删；下次启动生效 |
| `.ruling/knowledge/experience.jsonl` | 经验库（extended） | 会丢失经验 |
| `.ruling/knowledge/errors.jsonl` | 失败教训库（error） | 会丢失教训 |
| `.ruling/state.json.gz` | 图谱 + 台账（不含知识单元、不含审批） | 会丢失路由权重与统计 |
| `.ruling/audit.jsonl` | 审计哈希链与失败详情 | 会丢失留痕；不建议 |
| `.ruling/sessions/*.json` | 会话 | 可删 |
| `designs/*.json` | 工业设计参考状态 | 业务数据，谨慎 |

审批不在任何文件中；重启后自动清空。外部知识源不写进本地库，启动时重新加载。

## 9. 排障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 退出码 2 / `needConfirm` | 黄灯未批准 | 同一进程加 `--yes`，或 HTTP `/approve` |
| `UNKNOWN_ACTION` | 动作不在能力面 | `pnpm ruling catalog` 查可用动作 |
| `ACTION_NOT_GRANTED` | 角色没有能力组 | 检查 `grants` 或换 `--role` |
| `RED_LINE` | 红灯动作 | 人工在框架外完成 |
| `BAD_PARAMS` | 参数不符合 schema | 查 `catalog --json` 的 `inputSchema` |
| `FORMAT_LOCKED` | 写了受保护格式 | 改用专用通道（如 `cad.import`） |
| `SIZE_LIMIT` | 超过 512KB 写入 / 2MB 读取 | 分片或走专用导入 |
| 服务启动后立即退出 | 旧版本的 `process.exit` 缺陷 | 使用当前版本；确认 `serve` 命令已更新 |
| 端口占用 | 39100 被占 | `--port` 换端口 |
| MCP 无响应 | stdin 关闭过早 / 客户端 cwd 不对 | 检查 cwd 与客户端配置 |
| 审计导出为空 | 旧版本未加载历史 | 当前版本启动时会恢复最近 50 条 |
| `knowledge list` 没有外部知识 | 外部源路径/URL 错误或被停用 | 检查 `knowledge.external` 与 `enabled` |
| 外部 HTTP 源超时 | 地址不可达或超过 10 秒 | 调大 `timeoutMs` 或改成本地文件 |
| JSONL 中某条知识不生效 | 该行 JSON 损坏 | 修复该行；加载器会跳过坏行 |
| 语义检索不命中 | 缺别名/同义词，或状态为 deprecated | 补 `aliases`/`synonyms.json`，或查看 `--status` |
| `knowledge.merge` 找不到单元 | id 拼写或命名空间不同 | 先用 `knowledge search`/`list` 确认 id |
| 模型总是 needConfirm | 默认 trust 是 agent | `--trust operator` 或批准 |

## 10. 重置

- 清空审批：重启进程。
- 清空经验：删除 `.ruling/knowledge/experience.jsonl`。
- 清空失败教训：删除 `.ruling/knowledge/errors.jsonl`。
- 清空图谱与台账：删除 `.ruling/state.json.gz`。
- 修改种子：编辑 `.ruling/knowledge/seed.json`；下次启动生效，不会被旧快照覆盖。
- 修改同义词：编辑 `.ruling/knowledge/synonyms.json`；下次启动生效。
- 清空审计：删除 `.ruling/audit.jsonl`（会失去留痕，谨慎）。
- 重装依赖：`rm -rf node_modules && pnpm install`。

## 11. 提交前自检

```bash
pnpm typecheck
pnpm test
pnpm demo
pnpm demo:industrial
pnpm build
```

本仓库没有自动提交；是否需要版本控制由使用者决定。
