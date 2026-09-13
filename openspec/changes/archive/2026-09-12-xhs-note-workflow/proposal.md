## Why

工作台目前只有一条真实业务流水线「电商新品上架」（6 阶段），但要支撑的产出形态不止一种——小红书种草笔记的产出物（选题方向 / 标题正文标签 / 首图内页图 / 合规清单 / 发布包）与电商完全不同，无法塞进现有六阶段。

`workflow_id` 的管道已经铺好：任务表有 `workflow_id` 列、创建任务接收 `workflowId`、`loadWorkflow(id)` 已参数化、执行器已图驱动。缺的只是「第二条工作流定义」以及**把散落在前端与 service 层的单工作流硬假设拆掉**。现在做，是因为这条管道天然支持多工作流，延后做只会让硬编码点继续扩散。

## What Changes

- 新增第二条业务工作流「小红书种草笔记」（`xhs-note`），六阶段：选题策划 → 笔记撰写 → 封面配图 → 合规审核 → 发布包装 → 交付完成
- 所有 XHS 阶段 key 统一加 `xhs-` 前缀（`xhs-topic` / `xhs-copy` / `xhs-image` / `xhs-review` / `xhs-package` / `xhs-deliver`），避免与电商 `copy` / `review` / `deliver` 三个同名 key 撞车
- 新增 XHS 生产者 `xhs-producer.ts`，实现选题 / 笔记 / 配图 / 发布包四类产出
- `WorkflowService` 从「单个 executor」改为「按 `workflowId` 取 executor」，使两条工作流的状态机各自独立
- 阶段调度从「按硬编码 stage key 查表」改为「按任务所属工作流的图节点取值」（确认点集合、负责人 Agent、阶段序列）
- 前端阶段序列、确认点标记、看板 flowbar、阶段面板全部改为按 `workflowId` 数据驱动，不再引用电商专属常量
- 左栏「工作流」组改为按 `GET /api/workflows` 列表渲染，计数按 `workflowId` 过滤；新建任务弹窗增加工作流单选
- 内容交付页在 XHS 下改为**按阶段纵向序列**布局（电商保持两栏等宽并排不变）
- XHS 合规审核为**自动节点**：通过后自动进入发布包装，检出问题时沿 rollback 边自动回退到笔记撰写或封面配图

### 非目标（本轮明确不做）

- 不新增 Agent：继续复用美美 / 平平 / 波波三个工位 Agent，工位栏仍为恰好 3 张卡
- 不引入「助理」角色参与任何工作流阶段（涵涵仅供知识库侧使用）
- 不改看板四列等宽 / 最小宽 / 横向滚动逻辑
- 不动工位栏（位置 / 结构 / 默认展开）
- 不做灵感库重构
- 不动任务详情属性右栏（保留 280px aside）
- 阶段条不加「自动」角标，只显示人工确认点

## Capabilities

### New Capabilities

- `xhs-note-workflow`: 小红书种草笔记工作流——六阶段定义、各阶段产出形态、合规审核自动语义与回退规则

### Modified Capabilities

- `workflow-engine`: 从「单工作流（电商）」语义改为「多工作流注册与按 `workflowId` 分派执行」
- `content-delivery`: 从「统一两栏等宽并排」改为「按工作流取布局——电商两栏并排，XHS 按阶段纵向序列」

## Impact

**共享契约层（`packages/shared`）**
- `workflow.ts`：新增 `XHS_WORKFLOW_ID` / `XHS_WORKFLOW` / XHS 阶段标签，新增 `stagesOf(workflowId)` 等按工作流取值的 helper
- `types.ts`：新增 `NotePackage` / `TopicOption`

**后端（`backend/src`）**
- `db/seed.ts`：幂等追加 XHS 工作流定义
- `routes/workflows.ts`：`GET /api/workflows` 返回库内全部工作流
- `engine/service.ts`：按 `workflowId` 取 executor；阶段调度改用图节点取值；新增 `advanceXhs()` 分支
- `engine/executor.ts` / `engine/graph.ts`：加载失败不再静默回退到电商图（非默认工作流抛错）
- `agents/xhs-producer.ts`：新建

**前端（`frontend/src`）**
- `features/content/ContentDeliveryView.tsx`：电商阶段面板抽到 `stage-panels/ecom/*`，外壳复用；新增 `stage-panels/xhs/*`
- `features/status/TaskDetailView.tsx`、`features/board/BoardView.tsx`：阶段序列与确认点改为数据驱动（属性 aside 不动）
- `features/LeftPanel.tsx`、`store/useWorkbench.tsx`、`App.tsx`：工作流列表、`currentWorkflowId`、新建任务弹窗工作流单选

**验收影响**
- 电商工作流必须回归零差异（阶段常量改动为最高风险点）
