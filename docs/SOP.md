---
topics: [sop, workflow]
doc_kind: note
created: 2026-05-31
---

# Standard Operating Procedure

## Daily Dev Cycle

```bash
# 1. 前台开发（watch 模式，实时重载）
npm run dev

# 2. 功能完成后，手动 E2E 验证
# - 确保 bridge 在运行: npm run status
# - 飞书发消息测试
# - 检查日志: cat ~/.opencode-copilot/bridge.log

# 3. 提交
git add -A
git commit -m "feat: description"
```

## Release Cycle

```bash
# 1. 确认所有变更已验证
npm run status

# 2. 更新版本号（package.json version 字段）
#    v0.1.0 → v0.2.0

# 3. 更新 CHANGELOG.md

# 4. 提交 + push
git add -A
git commit -m "chore: bump v0.2.0"
git push origin main
```

## 质量门禁

- **代码变更**: 必须无 TS 错误（`npx tsc --noEmit` 通过）+ E2E 测试（飞书发消息验证）
- **Bug 修复**: Reproduce → check logs at `~/.opencode-copilot/bridge.log` → root cause → fix → 回归测试
- **文档**: 新功能需在 `docs/CHANGELOG.md` 记录，重大变更需 `docs/decisions/` 的 D 号记录

## 常用命令

| 命令 | 用途 |
|------|------|
| `npm run dev` | 前台开发（watch） |
| `npm start` | 后台启动 |
| `npm stop` | 停止 |
| `npm restart` | 重启 |
| `npm run status` | 查看状态 |
| `cat ~/.opencode-copilot/bridge.log` | 查看日志 |
