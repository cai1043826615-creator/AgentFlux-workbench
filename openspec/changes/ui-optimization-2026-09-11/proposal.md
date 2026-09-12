## Why

主文档走查后累积了 30+ 条 UI/交互优化意见（P1 第 24-30 项、P2 一批收尾项，以及走查中发现的 4 个功能性缺陷），已在一个分支上分批实现：包括全站组件类层级失效导致宽度工具类被压过、浏览器前进后退失效、顶栏角标与看板列数不一致、热点配置弹窗 Hooks 顺序崩溃等。这些改动已在代码中落地并通过全量 typecheck / build / test，但尚未形成可追溯的规格记录，也未同步进 `openspec/specs/` 主规格。本变更把已实现的 UI 优化补记为一份完整的 spec 增量，使代码行为与规格库重新对齐。

## What Changes

**结构层（Shell）**
- 顶栏精简：移除「MULTI-AGENT E-COMMERCE」副标题与「在岗 / 忙碌」统计文案；连接状态改为 Connected 时仅留一个安静状态点，断开时升级为「已断开 · 点击重连」按钮（与聊天面板共用同一 `connected` 状态）。
- 顶栏任务角标改从 `tasks` 派生（`column === 'awaiting' && !archived`），与看板「待确认」列数字口径一致，不再依赖 WS 推送的 `approvalQueue`。
- 右栏聊天面板**默认折叠**，首屏把横向空间让给主视图。
- 折叠态 rail 移除常驻的分组文字标签，分组语义改由各图标 tooltip 承载；移除两个占位工作流项；rail 图标禁止 flex 收缩，避免窄屏压缩重叠。
- 左栏「设置」改名为「运行设置」；工位卡「设置」改名为「配置」。

**看板与列表**
- 卡片主按钮独占一行，次要操作收进溢出菜单；按钮标签全局禁止折行。
- 空列压缩宽度；已完成卡补「查看交付物」入口。
- 任务描述 3 行截断 + 展开；列表表头支持排序，时间列改为相对时间。

**知识库 / 星图 / 热点**
- 星图筛选重构为左树形态：目录树 + ⭐预设 + 标签多选 + 孤岛开关，并新增「已激活筛选标签条」（可单项移除）；未选中节点时收起详情面板；图例移入画布角；页头冗余文案合并进画布图例。
- 关注域配置重构：摘要展开、分层规则分区、数据源折叠管理、空域禁用保存、说明移入提示。
- 热点「其他」分组默认折叠、序号全局连续、挂载任务搜索；热点面板信息分层与响应式排版调整；「今日必看」为 0 时降级展示；「最近更新」收窄。
- 知识库目录栏可折叠；搜索条 sticky；文档内关联链接可点击跳转。

**状态与反馈**
- 新增通用动作反馈 Toast 栈（底部居中），接入归档 / 恢复 / 采纳 / 打回 / 重试 / 保存配置等轻量确认，常驻上限 4 条。
- 子面板加载骨架屏。
- 修复 hash 路由只写不读：补 `hashchange` / `popstate` 监听，恢复浏览器前进后退、分享链接与刷新保持视图。
- 新建任务弹窗校验改为「交互后才提示」，消除打开即满屏红字；平台多选与参考图上传触发 `touched`。
- 浏览器通知被拒时给出可点击的开启指引（原为静态「已拒绝」徽章）。

**样式基建（根因修复）**
- `index.css` 的组件类统一纳入 `@layer components`，恢复 Tailwind 工具类（`w-[Npx]` / `flex-1` 等）的覆盖能力 —— 这是关注域配置弹窗输入框不可见的根因。
- vite 代理端口由 4312 回归 4311，对齐后端实际监听端口。

**不包含**
- 后端接口、数据库 schema 与工作流引擎行为不变。
- 不新增业务能力，仅收敛既有 UI 行为与一处样式分层根因。

## Capabilities

### New Capabilities

无。本变更为既有 UI 能力的规格收敛与缺陷修复，不引入新的 capability。

### Modified Capabilities

- `shell-layout`: 顶栏组成精简（去副标题与在岗统计）、任务角标口径改为从任务派生、连接状态改为状态点 + 断线重连按钮、右栏默认折叠、折叠 rail 的分组标签与占位项调整、设置入口改名。
- `task-board`: 卡片操作布局（主按钮独占一行、次要操作进溢出菜单）、空列压缩宽度、已完成卡「查看交付物」入口、新建任务弹窗校验时机改为交互后。
- `task-explorer`: 列表视图的描述截断与展开、表头排序、创建时间改相对时间展示。
- `knowledge-overview`: 目录栏可折叠、搜索条 sticky、最近更新收窄、今日必看为 0 时降级、文档内关联链接可跳转。
- `knowledge-graph`: 筛选重构为左树（目录树 / 预设 / 标签多选 / 孤岛开关）+ 已激活筛选标签条、未选中收起详情、图例移入画布角、页头文案合并。
- `daily-hot`: 关注域配置重构（摘要展开 / 分层分区 / 数据源折叠 / 空域禁用保存）、其他分组默认折叠 + 序号全局连续 + 挂载任务搜索。
- `agent-observability`: 通用动作反馈 Toast（底部居中、常驻上限 4 条）与顶栏连接状态的统一；子面板加载骨架屏。

## Impact

**前端代码**（`frontend/src/`）
- `App.tsx`：顶栏重构、右栏默认折叠、rail 折叠态、`ActionToastStack` 挂载、新建任务弹窗校验时机。
- `components/Toast.tsx`：新增 `ActionToastStack` / `ActionToastCard`。
- `components/ui.tsx`、`index.css`：组件类分层（`@layer base` / `@layer components`）、按钮禁折行、rail 图标 `flex: none`。
- `store/useWorkbench.tsx`：`reconnect`、`actionToasts` / `pushToast` / `dismissToast`、WS 处理抽成稳定回调、hash 路由回绑。
- `features/`：`board/BoardView.tsx`、`board/TaskListView.tsx`、`board/ArchivedTasksModal.tsx`、`knowledge/*`（HotView / KnowledgeGraphView / KnowledgeView / KnowledgeOverviewBar / Markdown）、`status/TaskDetailView.tsx`、`workstation/WorkstationBar.tsx`、`workstation/AgentSettingsModal.tsx`、`content/ContentDeliveryView.tsx`、`observability/ObservabilityView.tsx`、`LeftPanel.tsx`。
- `vite.config.ts`：代理端口 4311。

**兼容性**
- 无 **BREAKING**：仅 UI 行为与展示口径调整，未改变对外接口契约；`/api/deliverables/search` 等既有接口签名不变。

**验证基线**
- `pnpm typecheck` / `pnpm build` / `pnpm test` 全绿（2026-09-12 复跑通过）。
