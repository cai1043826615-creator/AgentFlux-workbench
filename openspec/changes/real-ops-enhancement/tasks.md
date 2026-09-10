## 1. 文档对齐

- [ ] 1.1 `README.md` 修正：环境变量名（`DEEPSEEK_BASE_URL/DEEPSEEK_API_KEY/DEEPSEEK_MODEL`、`IMAGE_BASE_URL/IMAGE_API_KEY/IMAGE_MODEL`）、拍板点 2→3（含 ASCII 工作流图）、版本 Vite 6 / React 19
  - ✓ 按文档配置渠道可生效；拍板点与图定义一致
- [ ] 1.2 主 spec `workflow-engine` 拍板点 2→3 + 详情图拍板后自动推进（delta spec 已就绪），归档时由 sync 流程落到 `openspec/specs/`
  - ✓ `openspec validate` 通过

## 2. 数据清理与最终验收

- [ ] 2.1 `backend/scripts/reset-demo.ts`：先备份 `data/workbench.db.ts` 到 `data/backups/<ts>-pre-reset.db`，再清空 `tasks/task_events/deliverables/messages/agent_executions`（保留 `agents/workflows/settings`）；默认 dry-run，需显式 `--force` 才执行
  - ✓ dry-run 不写库；`--force` 前生成备份文件
- [ ] 2.2 备份当前库并执行清理，确认看板为空、Agent/工作流/设置保留
  - ✓ 备份存在；tasks/deliverables/events/messages/executions 均为空
- [ ] 2.3 干净环境真实端到端验收：新建一个真实任务（真实 DeepSeek 文案 + 真实生图），走完 6 阶段 3 拍板点至交付归档，记录执行日志/交付物/审批证据
  - ✓ 一次任务完整走完；执行日志含真实模型名与耗时；交付物逐张可采纳
- [ ] 2.4 回归验证：单渠道生图、mock 降级路径、三处审批入口均不变
  - ✓ 既有功能无回归

## 验收总入口

- 2.1→2.4 全绿；`backend` 与 `frontend` 构建 0 error；README 与主 spec 与实现一致。
