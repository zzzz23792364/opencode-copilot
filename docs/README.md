---
topics: [docs, index]
doc_kind: index
created: 2026-05-31
---

# 文档索引

本文档汇总 `docs/` 目录下所有文档，方便快速定位。

## 按目录浏览

### 活跃文档

| 目录 | 内容 | 代表文档 |
|------|------|----------|
| [`specs/`](specs/) | 技术规格与架构 | [`tech-architecture.md`](specs/tech-architecture.md) |
| [`decisions/`](decisions/) | 技术决策记录 | [`D001-opencode-run-vs-serve.md`](decisions/D001-opencode-run-vs-serve.md) |
| [`bugs/`](bugs/) | 问题修复记录 | [`B001-invalid-y-flag.md`](bugs/B001-invalid-y-flag.md) |
| [`guides/`](guides/) | 操作指南 | [`dev-setup.md`](guides/dev-setup.md) |
| [`design/`](design/) | UI/UX 设计 | (暂无前端界面) |
| [`discussions/`](discussions/) | 技术讨论与评审记录 | (待新增) |
| [`status/`](status/) | 项目状态与进度 | (待新增) |
| [`ideas/`](ideas/) | 产品创意与待探索方向 | (待新增) |
| [`plans/`](plans/) | 实施计划 | (待新增) |
| [`ops/`](ops/) | 运维文档 | (待新增) |
| [`superpowers/`](superpowers/) | 自动生成内容 | (如 spec/plan 自动生成) |

### SOP & 变更

| 文件 | 内容 |
|------|------|
| [`SOP.md`](SOP.md) | 开发流程标准操作（start/test/release cycles） |
| [`CHANGELOG.md`](CHANGELOG.md) | 版本变更日志 |

### 归档文档

[`archive/`](archive/) 存放已过时、已完成或废弃路线的文档，仅供历史参考。

### 模板

[`_templates/`](_templates/) 提供新建文档的模板：

- [`feature.md`](_templates/feature.md) — 功能规格
- [`bug.md`](_templates/bug.md) — Bug 修复记录
- [`decision.md`](_templates/decision.md) — 技术决策

## 按主题快速检索

| 主题 | 相关文档 |
|------|----------|
| **架构设计** | [`specs/tech-architecture.md`](specs/tech-architecture.md) |
| **为什么用 CLI** | [`decisions/D001-opencode-run-vs-serve.md`](decisions/D001-opencode-run-vs-serve.md) |
| **为什么复用 clowder-local** | [`decisions/D002-clowder-local-reuse.md`](decisions/D002-clowder-local-reuse.md) |
| **开发环境搭建** | [`guides/dev-setup.md`](guides/dev-setup.md) |
| **日常开发流程** | [`SOP.md`](SOP.md) |
| **功能路线图** | [`../BACKLOG.md`](../BACKLOG.md) |
| **项目治理规则** | [`../AGENTS.md`](../AGENTS.md) |
| **版本历史** | [`CHANGELOG.md`](CHANGELOG.md) |

## 命名规则

- 活跃文档：`ID-名称.md`（如 `D001-opencode-run-vs-serve.md`、`F001-streaming-cards.md`）
- 归档文档：保留原始文件名，不修改
- YAML frontmatter 必填：`topics`、`doc_kind`、`created`
