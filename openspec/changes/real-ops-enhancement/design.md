## Context

现状（见 proposal.md — Why）：真实链路已跑通（DeepSeek + gpt-image-2 单渠道），但文档（README、主 spec workflow-engine）与实际实现脱节——README 写「2 个拍板点」实际 3 个、环境变量指引与 `config.ts` 不符、版本号过时；主 spec 拍板点需求也是 2 个。数据库积压测试数据，无干净验收基线。约束：密钥仅存本机；**生图保持现有单一渠道语义，不引入多渠道**。

## Goals / Non-Goals

**Goals:**
- README 与主 spec 与实现对齐（3 拍板点 / 正确环境变量名 / 版本号）
- 提供可恢复的数据清理脚本与一次干净环境真实端到端验收（真实 DeepSeek + 真实生图）
- 验收前后行为不变（单渠道、mock 降级、审批联动）

**Non-Goals:**
- 不做多渠道生图/渠道路由（用户已明确取消）
- 不做生图额度统计、渠道健康探测
- 不做真实平台上架发布
- 不改工作流图定义与引擎行为

## Decisions

### D1. 文档对齐（3 拍板点 / 环境变量 / 版本）

- README：修正环境变量名（`DEEPSEEK_BASE_URL/DEEPSEEK_API_KEY/DEEPSEEK_MODEL`、`IMAGE_BASE_URL/IMAGE_API_KEY/IMAGE_MODEL`）、拍板点 2→3（含 ASCII 图）、版本 Vite 6/React 19。
- 主 spec `workflow-engine`：拍板点 2→3（delta spec 覆盖 Human approval points / Approval actions driven from content delivery / Automatic progression；detail-image 拍板后自动推进到校对，语义自洽）。
- 归档文档（`changes/archive/2026-09-09-*`）视为历史快照，不改。
- **理由**：实现（3 拍板点）是演进后的正确状态，文档对齐到实现；README 环境变量指引错误会直接误导渠道配置。
- **备选**：把实现改回 2 拍板点（破坏已验证的真实流程，错误方向）。

### D2. 数据清理与验收基线

- 新增 `backend/scripts/reset-demo.ts`：先备份 `data/workbench.db.ts` 到 `data/backups/<ts>-pre-reset.db`（文件拷贝），再清空 `tasks/task_events/deliverables/messages/agent_executions`（保留 `agents/workflows/settings`）；默认 dry-run，需显式 `--force` 才执行。
- 验收：备份后清库 → 启动后端 → 新建一个真实任务 → 走完 6 阶段 3 拍板点（真实 DeepSeek + 真实生图）→ 记录执行日志/交付物/审批证据到验收文档。
- **理由**：验收需要可恢复的安全网与干净基线；备份保底。
- **备选**：手动逐条删（易漏、不可回滚）；不清理直接验收（基线不干净，交付物列表混乱）。

## Risks / Trade-offs

- [reset-demo 误删数据] → 默认 dry-run + 强制备份到 backups/ 后才执行；README 注明用法。
- [验收消耗真实 API 额度] → 验收是用户已确认的动作，单任务额度可控；生图失败不阻塞（沿用失败汇总）。
- [文档与实现再脱节] → 本次把 README 与主 spec 一并对齐；后续变更沿用「delta spec + 归档同步」机制。

## Migration Plan

- 无 schema 迁移：清理脚本只删业务数据行，保留 `agents/workflows/settings`。
- 部署：更新代码/文档 → 重启后端（`cd backend && node src/index.ts`）。
- 回滚：恢复 `data/backups/*-pre-reset.db`，或 git 回退代码版本。

## Open Questions

- 生图额度/成本统计是否值得做（可在后续 change 决策，不影响本 change）。
