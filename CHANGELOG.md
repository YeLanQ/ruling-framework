# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.0] - 2026-10-20

首个可用版本：通用裁定权框架 v0.1.0。

### Added

- 通用裁定权框架主体：三区门控（`gate(zone, approved, known)`）、审批运行态、效能门、台账、审计哈希链、受控工作区、免训练知识三层（seed / extended / error）、Agent 循环、CLI / HTTP / MCP / SDK 适配器。
- 前置归一化（NormSpec）与任务分层（direct / assist / fuzzy / suggest）：只有唯一高置信度绿灯动作完全绕过 LLM。
- 三个行业参考包：`opc`（一人公司）、`smb`（小公司）、`industrial-design`（工业设计，动态红灯 + 格式锁 + 版本溯源）。
- 领域适配指南：[`docs/10-adapting-a-new-domain.md`](docs/10-adapting-a-new-domain.md)（介入点、事件、快照、Provider、分数标定）。
- 六类质量门禁并聚合为 `pnpm gate`：行尾（`check:eol`）、语法（`check:syntax`）、类型（`typecheck`）、语义（`lint:semantic`）、质量（`lint`）、漏洞（`audit`）。
- Gitea Actions 自动化：push / pull request 全链路跑 gate；tag `v*` 额外构建并产出 `dist/` 产物。

### Fixed

- `Workspace.remove` 数据边界缺口：删除路径补齐 `assertWritable`，internal/ 只读与格式锁覆盖删除操作。
- MCP `callTool` 缺 `__task` 时退化为共享审批键，一次批准放行 TTL 内全部调用：改为强制携带 `__task`，缺失返回错误。
- manifest 以 `as unknown as` 导入逃过类型检查：改为 `coerceManifest` 类型谓词收窄；`validatePack` 校验 schema 的 type 枚举与 required 引用存在性。
- 知识单元可覆盖 `task:` / `action:` / `failure:` / `outcome:` 观测单元：知识动作层加保留前缀拒绝。
- `taskId` 使用 32 位 FNV-1a 产生碰撞污染图谱：改为 sha256 前 16 hex。
- `audit.append` 使用 `Date.now()` 与引擎时钟不一致：支持时钟注入，engine 统一注入。
- `loadConfig` 不校验 trust / role 枚举，坏配置拖到 preflight 才报：改为加载即校验。
- v1 快照迁移绕过 `hydrateUnit` 规范化，缺字段单元在 `reindex` 崩溃：迁移统一走规范化入口。
- 参数校验对未知 schema type 静默放行：改为 fail-closed（显式非法类型报错；缺失 type 表示“任意标量”，放行）。

### Changed

- 测试规模：22 个文件 136 用例 → 24 个文件 153 用例。
- vitest 3.2.7 → 4.1.11，清零 2 critical + 2 moderate 依赖漏洞。
- README 文档地图、验证状态与 CI/CD 说明同步更新。

### Security

- `pnpm audit --audit-level high` 0 漏洞（vitest 链漏洞全部升级修复）。

---

历史 commit 对应关系：

| 版本 | 提交 | 说明 |
| --- | --- | --- |
| 0.1.0 | `cbfc2ff` | 通用裁定权框架 v0.1.0 |
| 0.1.0 | `5fbdda8` | 前置归一化与任务分层 |
| 0.1.0 | `5155c6b` | 领域适配指南 |
| 0.1.0 | `3cce1cb` | 质量加固：P2/P3 修复 + 测试 + 六类门禁 |
| 0.1.0 | `a7924c7` | Gitea Actions 自动化 |
