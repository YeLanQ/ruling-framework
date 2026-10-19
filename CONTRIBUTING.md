# Contributing Guide（贡献指南）

感谢你考虑为 **Ruling Framework** 贡献代码。本指南说明开发环境、门禁约定与合入流程。

> 项目速览与设计文档见 [`README.md`](README.md) 与 [`docs/00-overview.md`](docs/00-overview.md)。

## 开发环境

| 依赖 | 版本要求 |
| --- | --- |
| Node.js | >= 20（开发验证使用 22.x） |
| pnpm | 11.24.0（`package.json` 的 `packageManager` 字段锁定，CI 与本地保持一致） |

首次安装：

```bash
pnpm install
```

## 常用命令

| 命令 | 作用 | 何时使用 |
| --- | --- | --- |
| `pnpm gate` | 全链路：六类门禁 + 测试 + 构建 + 两个 demo | **提交/合入前必跑** |
| `pnpm verify` | typecheck + 测试 + 两个 demo | 日常快速自检 |
| `pnpm check:eol` | 行尾门禁：全部文本文件必须 LF | 新增/编辑文件后 |
| `pnpm check:syntax` | 语法门禁：TS 文件纯语法解析 | 语法改动后 |
| `pnpm typecheck` | 类型门禁：`tsc --noEmit`（strict） | 类型改动后 |
| `pnpm lint:semantic` | 语义门禁：type-aware 严格规则 | 逻辑改动后 |
| `pnpm lint` | 质量门禁：ESLint recommended + 自定义 | 代码风格 |
| `pnpm audit` | 漏洞门禁：`--audit-level high` | 依赖变更后 |
| `pnpm test` | 全部测试（vitest） | 每次改动 |
| `pnpm build` / `pnpm demo` / `pnpm demo:industrial` | 构建与端到端演示 | 验证产物 |

## 代码规范

- **TypeScript strict**：`strict` + `noUncheckedIndexedAccess` 全程开启，禁止通过类型断言绕过。
- **禁止项**（由 ESLint 强制，命中即门禁失败）：`any`、非空断言 `!`、`ts-ignore`、`console.*`、未使用变量（`^_` 前缀豁免）。
- **行尾统一 LF**：`.editorconfig` 与 `.gitattributes` 已固化；Windows 编辑器写 CRLF 会被 `check:eol` 拦截。
- **测试与源码同目录**，命名 `*.spec.ts`；改动行为必须配套回归测试。
- **不引入新运行时依赖**；新增 devDependency 需在 PR 说明理由（依赖漏洞门禁会审计整棵树）。
- 文件末尾保留换行，不残留尾随空格。

## 提交约定

提交信息使用类型前缀 + 中文正文（与仓库历史一致）：

```
feat:    新功能
fix:     缺陷修复
docs:    文档
refactor: 重构（行为不变）
test:    测试
ci:      CI/CD 与门禁
chore:   杂项（依赖、配置）
```

示例：`fix: 知识动作层拒绝保留前缀覆盖观测单元`

**Changelog 自动生成**：commit 合并后运行 `pnpm changelog`，脚本会把未收录的显著提交（feat/fix/refactor/perf/security/removed）按 Keep a Changelog 分类增量聚合到 `[Unreleased]`；`pnpm changelog --release <版本>` 在发布时把 `[Unreleased]` 固化为版本节。文档/CI/杂项类提交（docs/ci/chore/test）不进 changelog，因此**提交信息里对显著变更使用 feat:/fix: 前缀**，它直接决定 changelog 内容。

## 提 PR 流程

1. 从 `main` 切功能分支：`git checkout -b feat/<简述>`。
2. 修改代码并**补充对应测试**。
3. 本地跑 `pnpm gate` 直到全绿（六门禁 + 153 测试 + 构建 + 两个 demo）。
4. 按提交约定提交，push 到远程，创建 Pull Request。
5. CI 会在 PR 上自动重跑全链路；通过后等待 review 合入。

## 发布流程（maintainer）

1. 更新 `package.json` 的 `version`，并在 `CHANGELOG.md` 增加对应版本节。
2. 打 tag 并推送：`git tag v<版本>` 与 `git push github v<版本>`（GitHub 自动创建 Release 并上传 `dist/` 产物）。
3. 发布流程由 CI 的 `release` 任务接管：gate 全绿后构建产物并创建 GitHub Release；npm 发布需在 GitHub 仓库配置 `NPM_TOKEN` secret 后启用工作流中注释的 `pnpm publish` 步骤。

## 问题与讨论

- Bug 报告与功能建议：开 Issue，注明复现步骤与期望行为。
- 行为变化必须先更新 `README.md` 与相关 `docs/` 设计文档，再提交代码。
