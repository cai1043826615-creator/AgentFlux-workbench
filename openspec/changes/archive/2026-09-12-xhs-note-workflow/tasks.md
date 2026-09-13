## 1. OpenSpec 立项

- [x] 1.1 创建 change `2026-09-12-xhs-note-workflow` 并写入 proposal / design / 三个 delta spec，验证 `openspec validate 2026-09-12-xhs-note-workflow --strict` 输出 valid

## 2. shared 契约层

- [x] 2.1 在 `packages/shared/src/workflow.ts` 新增 `XHS_WORKFLOW_ID` / `XHS_WORKFLOW`（六节点 + 边，key 全带 `xhs-` 前缀），验证无任何 XHS stage key 与电商 stage key 同名
- [x] 2.2 新增 `stagesOf(workflowId)` / `approvalPointsOf(workflowId)` helper 并把 XHS 标签并入 `WORKFLOW_STAGE_LABELS`，验证传入电商 id 返回电商六阶段、传入 `xhs-note` 返回 XHS 六阶段
- [x] 2.3 在 `packages/shared/src/types.ts` 新增 `NotePackage` / `TopicOption` 并在 `index.ts` 导出，验证 `pnpm typecheck` 通过

## 3. backend · 工作流注册

- [x] 3.1 在 `backend/src/db/seed.ts` 幂等追加 XHS 工作流，验证重启后库内存在两条 workflows 记录且重复启动不产生第二条 XHS
- [x] 3.2 修改 `backend/src/routes/workflows.ts` 使 `GET /api/workflows` 返回库内全部工作流，验证响应含电商与 XHS 两条
- [x] 3.3 修改 `backend/src/engine/graph.ts` 的 `loadWorkflow`：非默认工作流缺失或 JSON 损坏时抛错并带 workflow id，验证传入不存在的 id 抛错而非返回电商图

## 4. backend · 调度去硬编码

- [x] 4.1 `WorkflowService` 改为持有 `Map<workflowId, TaskExecutor>` 并提供 `executorFor(workflowId)`，所有读写路径改走它，验证两条工作流的任务各自独立推进
- [x] 4.2 `service.ts` 三处 `APPROVAL_POINT_STAGES`（L103 linear 自动放行 / L264 copy 决策 / L281 image 决策）改为按任务所属工作流的图节点 `approvalPoint` 判定，验证 XHS 确认点在确认与全自动模式下都能正确推进
- [x] 4.3 `service.ts` 的 `STAGE_AGENT` 硬映射（L42-49）改为从图节点 `ownerRole` 经 `AGENT_BY_ROLE` 解析，验证 XHS 阶段执行时 `markBusy` 收到的是 `agent-copy` / `agent-design` / `agent-supervisor` 之一，不再是 `undefined`
- [x] 4.4 `advance()` 开头按 `task.workflowId` 分派到 `advanceXhs()`，验证 XHS 任务不会进入电商的 `switch (node.id)` 分支

## 5. backend · XHS 生产者

- [x] 5.1 新建 `backend/src/agents/xhs-producer.ts`，实现 `produceTopic`（3 个方向）与 `produceNote`（标题 ≤20 字含 emoji + 正文 + 话题标签），验证无 LLM 渠道时降级 mock 且不抛异常
- [x] 5.2 实现 `produceNoteImages`（首图 ×1 + 内页图 ×2 并行组）与单图重试，验证失败图状态为 `failed` 且可单独重试
- [x] 5.3 实现 `produceCompliance`：审核结果带 `targetStage`（`xhs-copy` 或 `xhs-image`），验证检出问题时返回对应 targetStage
- [x] 5.4 `advanceXhs()` 复用现有 `runStage()` 包装实现六个 XHS 节点分支，合规审核通过走 `passed` 边、有问题按 `targetStage` 走 `rollback` 边，验证审核从不进入「待确认」列

## 6. frontend · 重构先行（电商回归）

- [ ] 6.1 把 `ContentDeliveryView.tsx` 五个电商阶段面板原样抽到 `stage-panels/ecom/*`，外壳留在原文件，验证 `pnpm typecheck` 与 `pnpm build` 通过
- [ ] 6.2 电商全链路回归走查：新建 → 确认开工 → 六个阶段推进 → 打回 → 交付，验证与重构前零差异
- [x] 6.3 `TaskDetailView.tsx`（L197-198/202/508-510）与 `BoardView.tsx`（L3/108/109）改为按 `workflowId` 取阶段序列与确认点，验证电商阶段条与 flowbar 表现不变，**属性 aside（L641）不动**
- [x] 6.4 `TaskDetailView.tsx` L85 的图片单位判定改为按节点是否有 `parallelGroups`，验证电商阶段计数文案不变

## 7. frontend · 工作流入口

- [x] 7.1 删除 `LeftPanel.tsx` 未使用的 `PlaceholderItem` 死代码，并把 `WorkflowItem` 参数化（label / count / active / onClick），验证无 lint 未使用告警
- [x] 7.2 左栏「工作流」组改为按 `GET /api/workflows` 渲染，count 按 `workflowId` 过滤，验证 XHS 计数不含电商任务
- [x] 7.3 `store/useWorkbench.tsx` 引入 `workflows` 列表与 `currentWorkflowId`，验证切换工作流后任务列表随之过滤
- [x] 7.4 `App.tsx` 的 `NewTaskModal` 第 1 步增加工作流单选并把 `workflowId` 随创建请求提交，验证选择 XHS 后创建的任务落在 XHS 首个阶段
- [x] 7.5 `App.tsx` L393/462 的工作流激活判定与 rail 图标 title 改为按 `currentWorkflowId` 参数化，验证 title 不再写死「电商工作流」

## 8. frontend · XHS 阶段面板

- [x] 8.1 实现 `stage-panels/xhs/TopicPanel`（3 方向单选 + 重出选题）与 `NotePanel`（标题 / 正文 / 标签 + 采纳打回），验证打回重置本阶段产出
- [x] 8.2 实现 `ImagePanel`（首图 / 内页图 subtab + 单图重试）与 `CompliancePanel`（合规清单，无决策按钮，含「主管 Agent 自动检查，无需人工」文案），验证合规面板不渲染采纳/打回
- [x] 8.3 实现 `PackagePanel`（发布包 + 图片顺序清单 + 复制）与交付终态引导（查看发布包 / 新建下一个任务），验证未到交付完成时下载置灰
- [x] 8.4 `ContentDeliveryView` 按 `workflowId` 选择布局：电商两栏并排、XHS 按阶段纵向序列，验证电商布局一字不变
- [x] 8.5 `stage-panels/registry.ts` 注册 XHS 面板，验证六个 XHS 阶段都能渲染对应面板
- [x] 8.6 XHS 阶段面板内文档链接统一挂 `.qs-doc-link`，验证 `frontend/src` 内 `text-violet-` / `text-purple-` / `text-indigo-` 类名命中数为 0
- [x] 8.7 未开始阶段显示灰态占位且不显示「生成中」，验证文案待确认时配图面板不出现生成态

## 9. 端到端验收

- [x] 9.1 起后端 4311 / 前端 4310，创建 XHS 任务走完六阶段，验证顺序推进、确认点阻塞、打回返工、审核回退均正确
- [x] 9.2 验证 XHS 阶段条：完成绿 / 当前黑 / 未到灰，头像显示，仅四个人工确认点有「确认」角标，合规审核无角标
- [x] 9.3 验证工位栏仍默认展开且恰好 3 张卡（不含涵涵），小助理不出现在任何工作流阶段
- [x] 9.4 电商工作流完整回归，验证阶段常量改动未引入差异
- [x] 9.5 跑 `pnpm typecheck` / `pnpm build` / `pnpm test` 全绿，且 `openspec validate 2026-09-12-xhs-note-workflow --strict` 通过

## 10. 收尾

- [x] 10.1 待确认卡副标题补「已等待 X 小时」（从 `task_events` 的 `STAGE_COMPLETED{awaitingApproval:true}` 时间戳推导，不加列），验证副标题不与 badge 重复
- [ ] 10.2 归档 change：`openspec archive 2026-09-12-xhs-note-workflow --yes`，验证 `openspec/specs/` 下 `xhs-note-workflow` 已创建且 `workflow-engine` / `content-delivery` 已合入
