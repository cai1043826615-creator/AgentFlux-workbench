## Context

工作台的执行层已经是图驱动的，但「只有一条工作流」这个假设散落在三处：

1. `WorkflowService` 持有一个 `TaskExecutor`（`service.ts:71-77`），构造时加载默认电商图
2. `service.ts` 的阶段调度按硬编码 stage key 分支（`switch (node.id)` L109），且确认点集合 `APPROVAL_POINT_STAGES`（L103/264/281）与负责人 `STAGE_AGENT`（L42-49）都是电商专属常量
3. 前端 `ContentDeliveryView` / `TaskDetailView` / `BoardView` 直接 import `WORKFLOW_STAGE_KEYS` 等电商常量

`workflow_id` 的管道本身已通：任务表有列、`toTask` 已带 `workflowId`、`loadWorkflow(id)` 已参数化、`POST /api/tasks` 已接收 `workflowId`。所以本次不是新建第二条流水线，而是**把单工作流假设拆成多工作流**。

动机见 proposal.md。需求见 `specs/` 下的三个 delta。

## Goals / Non-Goals

**Goals:**

- 让第二条工作流的阶段、产出、审核语义完全独立于电商，且互不影响
- 让「加第三条工作流」只需加定义 + producer + 面板，不再改调度层
- 电商工作流回归零差异（阶段常量改动是最高风险点）

**Non-Goals:**

- 不做工作流可视化编辑器（定义仍是代码内的常量）
- 不做跨工作流的任务迁移
- 不引入运行时动态加载工作流（seed 入库即可）

## Decisions

### 决策 1：XHS 阶段 key 全部加 `xhs-` 前缀

XHS 的语义阶段名 `copy` / `review` / `deliver` 与电商**完全同名**。当前 `nodeOf(task)` 用 `this.wf.nodes.find(n => n.id === task.stage)` 匹配，一旦 executor 加载错图，XHS 任务会匹配到电商节点并跑错 producer。

加前缀后，即使加载错图，`nodeOf` 返回 `undefined` → **安全失败**，而不是静默跑错逻辑。扁平的 `WORKFLOW_STAGE_LABELS` 可直接加 `'xhs-topic'` 等条目，无需改结构；存量任务都是电商的，无迁移成本。

**替代方案**：给 stage key 加 `workflowId` 命名空间（如 `xhs-note:copy`）。更彻底，但要求改造 `tasks.stage` 存储格式与所有前端比较逻辑，收益不匹配成本。

### 决策 2：一个 service，内部按 `workflowId` 取 executor

`WorkflowService` 改为持有 `Map<workflowId, TaskExecutor>`，所有读写路径统一走 `executorFor(task.workflowId)`。

**替代方案**：每个工作流一个 service 实例。会产生两个状态机写者，违反 `service.ts` 顶部注释已声明的「单写者」约束，且路由层要按 workflowId 选 service。

### 决策 3：渲染层不拷贝，抽阶段面板插件

`ContentDeliveryView` 的外壳（决策条 / 版本历史 / 产出溯源 / 加载态 / 空态）两条工作流**完全一致**，只有「阶段面板内容」不同。拷一份 = 第二套 UI，此后每个修复都要改两遍、必然分叉。

目标结构：

```
features/content/ContentDeliveryView.tsx      ← 外壳（唯一一份）
features/content/stage-panels/
  ├─ registry.ts                ← stageKey → 面板组件
  ├─ ecom/{Requirement,Copy,MainImage,DetailImage,Review}Panel.tsx
  └─ xhs/{Topic,Note,Image,Compliance,Package}Panel.tsx
```

拆分不是重写：把现有五个分支**原样搬进 `ecom/*`**，外壳留在原文件。

**执行顺序是硬约束**：先跑通电商重构并回归零差异，再接 XHS 面板。反过来会同时面对「重构 + 新功能」双重不确定性。

### 决策 4：XHS 内容交付用按阶段纵向序列，并 MODIFIED `content-delivery` spec

现行 spec 要求「两栏等宽并排（文案 | 图片）」。XHS 有六类产出，其中合规审核清单、发布包、发布顺序清单**既不是文案也不是图片**，装不进这两格；原型与插件化结构也都是纵向的。

与其让实现长期违约，不如改契约：把「两栏等宽」限定为电商工作流，新增 XHS 的纵向序列要求。电商现有布局与场景一字不改。

**替代方案 A**：XHS 强行两栏（上方全宽卡 + 中间文案|图片并排）—— 仍部分违约，且发布包/合规清单的归属很别扭。
**替代方案 B**：泛化为「文案类 | 图片类」并排 —— 一套规则覆盖两条工作流，但要改电商现有布局，回归风险最大。

### 决策 5：合规审核全自动，回退目标由 producer 产出决定

`xhs-review` 设为 `autoNext`，不进「待确认」、不提供人工按钮。检出问题时，`xhs-producer` 的审核结果带 `targetStage`，`service` 据此沿 rollback 边回退到 `xhs-copy` 或 `xhs-image`——复用电商既有的 `report.issues[0].targetStage` 契约。

「它是自动的」靠**面板内文案**说明（「主管 Agent 自动检查，无需人工」），**不加「自动」角标**——阶段条只显示人工确认点，与电商一致。

### 决策 6：沿用现有三个 Agent，不新建专人专岗

阶段产出风格由 `xhs-producer.ts` 里独立的 prompt 决定，与电商 `SmartProducer` 的方法**互不影响**（两个方法、两套 prompt、两套解析契约）。

关键发现：`persona` 在生产链路里**根本没被使用**——`smart-producer.ts` 的 prompt 是硬编码字符串（如 `produceCopy` 的 `'你是资深电商文案专家…'`），`agents.persona` 只参与私聊（`chat-reply.ts:62`）。所以新建 agent 并不会带来更针对性的产出。

而新建 3 个 agent 的代价很大：角色是单点映射（`AGENT_BY_ROLE` / `STAGE_AGENT` / `AGENT_IDS` 三处 `{角色→单个id}`），必须新增角色；`WorkstationBar` 的 `WORKFLOW_ROLES = ['文案','设计师','主管']` 会让工位变 6 张卡，直接违反「恰好 3 张卡」定案；且 `seed.ts` 的 `llmChannels` 只给 `agent-copy` / `agent-supervisor` 配了渠道——新 agent 无渠道时 `callLlm` **静默降级 mock**，会看到「全是假数据」却找不到原因。

**已知缺口（本轮不修）**：`buildProducerSystemPrompt` 的技能挂载是**按 agent** 的，不是按工作流的，所以无法让「小红书违禁词表」只对 XHS 生效。低成本解法是给该函数多收一个 `workflowId` 参数、按工作流追加技能段，复用已有 `readSkillContent` 通道。记为后续项。

### 决策 7：未知工作流不静默回退到电商图

当前 `loadWorkflow(id)` 找不到就 `return ECOM_WORKFLOW`（`graph.ts:15`）。若某环境 seed 未跑到 XHS 那条，`executorFor('xhs-note')` 会拿到电商图，XHS 任务又变成「静默跑错」。

改为：仅默认工作流允许回退，非默认工作流缺失或损坏时**抛错**。

## Risks / Trade-offs

**[风险] 阶段常量改动导致电商回归破损** → 缓解：前端重构（决策 3）先行并单独回归，电商面板原样搬迁不做行为改动；回归通过后才接 XHS。

**[风险] `service.ts` 里三处电商常量遗漏导致 XHS 任务静默卡死**
具体是 `APPROVAL_POINT_STAGES`（L103 linear 自动放行、L264 copy 决策、L281 image 决策）与 `STAGE_AGENT`（L42-49，`runStage` 取 `agentId` 会得到 `undefined` → `markBusy(undefined)`）。
→ 缓解：改为从图节点取值——确认点用节点 `approvalPoint`，负责人用节点 `ownerRole` 经 `AGENT_BY_ROLE`。任务里已单列成 task，不靠记忆。

**[风险] 卡片副标题「已等待 X 小时」缺少时间依据**
`stageNoteOf` 已返回「等待你处理」（不再复述状态），但「已等待 X 小时」需要进入 awaiting 的时刻，`tasks` 表无此字段。
→ 缓解：从 `task_events` 中 `STAGE_COMPLETED{awaitingApproval:true}` 的时间戳推导，不新增列。作为独立小任务，不阻塞主线。

**[风险] OpenSpec `MODIFIED` 是整块替换** → 缓解：delta 里被修改的 Requirement 已原样带回全部 Scenario；每次改动后跑 `openspec validate --strict`。

**[风险] 前端 React Hooks 顺序错误导致白屏**（第二轮已踩过）
→ 缓解：任何 `useState/useEffect/useMemo` 不放在 early return 之后；`build` / `typecheck` 查不出此类问题，需人工走查。

## Migration Plan

1. 立项并 `validate --strict` 通过（已完成）
2. shared 契约层：XHS 定义 + 类型 + `stagesOf(workflowId)` 等 helper
3. 后端：seed 追加 → `GET /api/workflows` 返回全部 → `executorFor()` → 调度改图节点取值 → `advanceXhs()` → `xhs-producer`
4. 前端重构（先）：`ContentDelivery` 阶段面板拆出 → **电商回归零差异**
5. 前端重构（后）：`TaskDetailView` / `BoardView` 改按 `workflowId` 取值 → 回归（属性右栏不动）
6. 前端入口：左栏按 `/api/workflows` 渲染 → `useWorkbench` 引入 `currentWorkflowId` → `NewTaskModal` 工作流单选
7. 前端新增：XHS 五个阶段面板 + registry
8. 本地起服务（后端 4311 / 前端 4310）逐条走验收
9. `openspec archive 2026-09-12-xhs-note-workflow --yes`

**回滚**：本 change 未引入破坏性迁移（无存量数据改写，XHS 为新增工作流）。回滚 = 回退提交；电商链路不受影响。

## Open Questions

- 卡片副标题的「已等待 X 小时」是否要改为更粗粒度（如「已等待 2 小时」→「今天 / 昨天」）？可在实现该任务时定，不影响 spec 与任务拆分。
- XHS 封面配图的三张图是否都走同一 image channel（串行）还是分两个 channel（并行）？原型未体现，实现时按生图渠道限流情况定；两种都满足 spec 的「并行子任务组」要求。
