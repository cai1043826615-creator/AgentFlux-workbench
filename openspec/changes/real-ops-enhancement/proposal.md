## Why

工作台真实链路已经跑通（DeepSeek 文案 + gpt-image-2 生图，69 次执行 0 失败、4 个任务真实完成到交付归档），但存在两类阻碍「真实运营」的问题：**文档与实现脱节**（README 与主 spec 均写「2 个人工拍板点」，实际图定义为 3 个；README 环境变量指引与 `config.ts` 实际读取名不符，按文档配置会不生效；版本号过时）、**数据积压无验收基线**（库中 11 个测试任务、18 个 pending 交付物，缺少一次干净环境下的真实端到端最终验收）。

## What Changes

- **文档同步修正**：README 修正 3 处（环境变量名 `DEEPSEEK_BASE_URL/DEEPSEEK_API_KEY/DEEPSEEK_MODEL` 与 `IMAGE_BASE_URL/IMAGE_API_KEY/IMAGE_MODEL`；拍板点 2→3；Vite 6/React 19 版本）；主 spec `workflow-engine` 的拍板点需求从 2 个改为 3 个（详情图设计同为拍板点），与图定义及实现一致
- **最终真实验收**：新增可恢复的数据清理脚本（备份后清空测试数据，默认 dry-run），在干净环境跑通一次真实端到端（需求对接 → 文案拍板 → 主图 → 详情图 → 校对 → 归档），产出验收证据（执行日志/交付物/审批记录）

## Capabilities

### New Capabilities

- 无（不引入新能力；生图沿用现有单一渠道语义）

### Modified Capabilities

- `workflow-engine`: 人工拍板点从 2 个改为 3 个（详情图设计阶段同为拍板点，产出后进入待确认；内容交付逐张决策与自动推进规则同步更新）

## Impact

- **backend**：新增 `scripts/reset-demo.ts`（备份 + 清理测试数据，默认 dry-run）；其余无代码行为变更
- **docs**：README、`openspec/specs/workflow-engine` delta、验收记录
- **数据**：`backend/data/workbench.db.ts` 备份与清理（测试任务/交付物/执行日志；保留 agents/workflows/settings）
- **不破坏既有功能**：单渠道生图、mock 降级、审批联动均不变
