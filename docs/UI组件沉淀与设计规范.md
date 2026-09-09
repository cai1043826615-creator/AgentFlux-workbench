# 多 Agent 电商工作台 · UI 组件沉淀与设计规范

> 版本：v1.0 ｜ 日期：2026-09-08 ｜ 状态：待确认（本轮仅梳理，未改动任何代码）
> 适用范围：`frontend/` 现有「电商新品上架」工作台；同时作为后续「直播带货上架 / 跨境选品」等工作流页面的组件基座。
> 规范依据：`quiet-signal-design` skill 的 `SPEC.md`（v0.1.0，2026-08-23 approved）+ `gpt-taste` 品味注入（宽容器大标题、章节级大间距、克制动效）+ 用户 2026-09-08 确认的「Aceternity UI 适度借鉴、不做玻璃拟态/强渐变/粒子」。

---

## 1. 现状 UI 结构梳理（页面 / 组件地图）

### 1.1 布局骨架（`App.tsx` Shell）

```
┌──────────────────────────────────────────────────────────────┐
│ TopBar（logo · 电商工作台 · MULTI-AGENT E-COMMERCE · 任务 ·    │
│        在岗/忙碌 · 实时连接 Badge）                             │
├──────────────┬──────────────────────────┬────────────────────┤
│ 左栏（可折叠） │ 主视图（可切换）           │ 右栏（可折叠）       │
│ LeftPanel    │ board   → BoardView       │ ChatPanel          │
│ 工作流导航    │ task    → TaskDetailView  │ 电商工作群 + 私聊    │
│ 通用导航      │ observability→ObservabilityView │ 事件筛选/折叠    │
│ 折叠态=图标列 │ （每视图顶部 WorkstationBar）│ 折叠态=头像列       │
└──────────────┴──────────────────────────┴────────────────────┘
```

- 视图切换：`board`（任务看板）⇄ `task`（任务详情，含内容交付/任务详情两个 Tab）⇄ `observability`（Agent 状态）。
- 左栏折叠态为「工作流/通用」图标列；右栏折叠态为「群 + 各 Agent 圆头像」头像列。

### 1.2 页面视图清单

| 视图 | 文件 | 主要模块 |
|---|---|---|
| 任务看板 | `features/board/BoardView.tsx` | 标题行、4 列看板、TaskCard、状态 Tag、6 段 flowbar、负责人 chip |
| 任务详情 | `features/status/TaskDetailView.tsx` | 面包屑、task-head、StageStepper、Tabs、当前阶段卡、EventTimeline、属性面板 |
| 内容交付 | `features/content/ContentDeliveryView.tsx` | 任务信息条、左右等宽双卡（卖点文案/图片交付）、审批条、图片网格+放大、主管校对终审 |
| Agent 状态 | `features/observability/ObservabilityView.tsx` | Agent 在线状态卡墙、执行统计、执行日志表 |
| 聊天 | `features/chat/ChatPanel.tsx` | 会话切换头像行、事件筛选、消息流、ReceiptLine、输入区 |
| 工位栏 | `features/workstation/WorkstationBar.tsx` | Agent 状态卡（头像+状态点+模型+活动+设置） |
| Agent 设置 | `features/workstation/AgentSettingsModal.tsx` | 角色行、人设、模型/API、SKILL/文件挂载 |
| 左栏导航 | `features/LeftPanel.tsx` | 工作流项、占位项、设置弹窗（任务推进方式单选） |
| 新建任务 | `App.tsx` NewTaskModal | 两步弹窗：表单 → 确认摘要 |
| 通知 | `components/Toast.tsx` | 右下角 Toast 队列（待拍板/任务完成） |

### 1.3 已封装基础组件（`components/ui.tsx` + `index.css`）

| 组件 | 说明 | 位置 |
|---|---|---|
| `Btn` | 按钮 default/primary/ghost/danger + sm | ui.tsx |
| `Badge` | 徽章 default/ok/no/warn/signal | ui.tsx |
| `Card` | 直角卡片 + 可选标题栏 | ui.tsx |
| `Modal` / `ModalFooter` | 模态框 + 底部按钮组 | ui.tsx |
| `Field` | 表单字段（label+children） | ui.tsx |
| `SectionTitle` | 章节标题（meta+标题） | ui.tsx |
| `StageFlow` | 阶段流程条（圆形指示器+连线） | ui.tsx |
| `Avatar` | 头像（图片/字母兜底） | ui.tsx |
| `Glyph` | 几何图标（flow/pulse/gear/box/chevron） | ui.tsx |
| `Spinner` / `Empty` | 加载 / 空态 | ui.tsx |
| `ToastHost` | 右下角通知队列 | Toast.tsx |
| CSS 类 | `qs-card / qs-btn / qs-input / qs-badge / qs-meta / qs-dot / qs-nav-item / qs-toast / qs-rail-icon / qs-resize-handle / qs-clickable / qs-sunken / qs-pulse` | index.css |

---

## 2. Quiet Signal 规范基线（对照 SPEC.md §4）

### 2.1 颜色 Token（已落地于 `index.css @theme`，与 SPEC 对齐）

| Token | 值 | 现状 |
|---|---|---|
| color.canvas | #FAFAFA | ✅ |
| color.surface | #FFFFFF | ✅ |
| color.surface.sunken | #F4F4F5 | ✅ |
| color.ink.primary | #0A0A0A | ✅ |
| color.ink.secondary | #52525B | ✅ |
| color.ink.faint | #A1A1AA | ✅ |
| color.line.default | #ECECEE | ✅ |
| color.line.strong | #DCDCE0 | ✅ |
| color.signal.primary | #7C3AED | ✅ |
| color.signal.strong | #6D28D9 | ✅ |
| color.signal.soft | #F3EFFE | ✅ |
| color.signal.wash | —（未用，可并入 signal-soft） | ⚠️ |
| 扩展状态色 | ok #15803D / warn #B45309 / danger #B91C1C（Kit 级，SPEC 允许语义色保留，不得单独传义） | ✅ |

### 2.2 字体角色（已落地）

| 角色 | 字体 | 现状 |
|---|---|---|
| type.display.cjk | Noto Serif SC / Songti SC | ✅（font-display） |
| type.body | Noto Sans SC / PingFang | ✅（font-body） |
| type.metadata | JetBrains Mono | ✅（font-mono + qs-meta） |

### 2.3 几何 / 表面（SPEC §4.4 圆角 Hybrid）

| Token | 核心值 | 现状 |
|---|---|---|
| structure / ruleJunction | 0（大结构直角） | ✅（qs-card border-radius 0） |
| small（按钮/输入框/小表面） | 4px | ⚠️ 存在 6px / 3px 混用（见 §5） |
| pill | 999px 条件使用（极短状态/标签） | ⚠️ 使用需审计（见 §5） |
| 默认无阴影 | — | ⚠️ 个别 hover 带 shadow（Toast 浮层除外，属真实抬升） |

### 2.4 动效（SPEC §4.6）

| Token | 值 | 现状 |
|---|---|---|
| fast 160ms / standard 220ms / deliberate 300ms | cubic-bezier(0.22,1,0.36,1) | ✅（--dur-* / --ease-standard） |
| busy 真实进行中允许脉冲 | qs-busy-pulse | ✅ |
| reduced-motion 等价 | index.css 全局关闭 | ✅ |

---

## 3. 重复 UI 模式识别（本轮梳理重点）

以下为在多个文件中重复出现、**应沉淀为共享组件/工具**的模式。括号内为出现位置。

### 3.1 高优先级（重复 ≥3 处）

1. **Agent 状态 → 状态点/文字/颜色 映射**（重复 4~5 处，逻辑完全一致）
   - `WorkstationBar.tsx` `dotClass / dotLabel / statusColor`
   - `ObservabilityView.tsx` `StatusBadge / dotColor`
   - `ChatPanel.tsx` `STATUS_META`
   - `App.tsx` `AGENT_DOT / AGENT_STATUS`
   - 结论：抽 `agentStatus.ts`（纯工具）+ `AgentStatusDot` / `AgentStatusBadge` 组件。**这是目前最大的重复源。**

2. **头像右下角状态点角标**（重复 4 处）
   - `ChatPanel.tsx`、`App.tsx`（右栏折叠）、`WorkstationBar.tsx`、`ObservabilityView.tsx`
   - 均为：`relative 包裹 + absolute -bottom-0.5 -right-0.5 + qs-dot + boxShadow 白描边`
   - 结论：抽 `AvatarStatus`（Avatar + 状态点角标，props: size/status）。

3. **选中态圆头像圈**（重复 2 处，且跨组件行为一致）
   - `ChatPanel.tsx` 顶部会话切换、`App.tsx` 右栏折叠头像列
   - 均为：`outline: 2px solid signal + outlineOffset: 2 + hover scale-105 + signal-soft 底 + shadow`
   - 结论：抽 `SelectableAvatar`（含群头像/Agent 头像统一）。

4. **下划线式 Tab 组**（重复 2 处，样式细节各自内联）
   - `TaskDetailView.tsx`（内容交付/任务详情）、`ContentDeliveryView.tsx`（主图/详情图）
   - 均为：`border-bottom 2px signal + 选中加粗 + 未选 opacity/灰`
   - 结论：抽 `Tabs` 组件（items + activeKey + onChange）。

5. **时间格式化工具**（重复 4 处）
   - `TaskDetailView.tsx` `fmtTime / fmtFull`、`ObservabilityView.tsx` `relTime / timeFmt`、`ChatPanel.tsx` 消息时间
   - 结论：抽 `format.ts`（fmtTime / fmtFull / relTime 统一）。

6. **状态 → 徽章 tone 映射**（重复 3 处）
   - `ObservabilityView.tsx` StatusBadge、`ContentDeliveryView.tsx` copyBadge/imgBadge/columnTones、`BoardView.tsx` Tag
   - 结论：统一由 `AgentStatusBadge` / `StatusTag` 承接，映射集中管理。

### 3.2 中优先级（重复 2 处或单处但跨页面可复用）

7. **阶段推导逻辑**（done/current/todo + 拍板点）：`ui.tsx` `StageFlow` 与 `TaskDetailView.tsx` `StageStepper` 双实现。
   → 统一为 `StageStepper`（详情页增强版），`StageFlow` 保留为看板卡内紧凑版，共享 `useStageState` 推导 hook。

8. **空态占位**：各处 `<Empty>` 已用组件，但文案/结构不统一 → 升级 `EmptyState`（支持 icon/action/插画位，接 gpt-taste 品味）。

9. **弹窗底部按钮组**：`LeftPanel.tsx` 设置弹窗内联了「取消/保存」按钮行 → 统一用 `ModalFooter`。

10. **挂载项行 / 勾选块 / 上传按钮**：`AgentSettingsModal.tsx` 内联 `checkBox`、SKILL/FILE 行、label 伪装上传按钮 → 抽 `Checkbox`、`ListItem`、`FileUploadButton`。

11. **图片缩略 + 放大预览**：`ContentDeliveryView.tsx` `Thumb / RefThumb / preview overlay` → 抽 `ImageThumb` / `ImagePreview`（lightbox）。

12. **负责人 chip / 元数据小徽标**：`BoardView.tsx` 负责人 chip、TopBar 任务角标 → 抽 `Pill`（条件使用，符合 QS pill 边界）。

### 3.3 低优先级（单体但会随新工作流页面复制）

13. **活动日志时间线** `EventTimeline` → 抽 `Timeline` 通用组件（供后续工作流的事件流复用）。
14. **执行日志表 / 统计卡** `ObservabilityView` → 抽 `DataTable`、`StatCard`（后续工作流状态页复用）。
15. **聊天气泡 / 回执** `ChatPanel` `MessageBubble / ReceiptLine`（会话组件复用）。

---

## 4. 组件沉淀清单（目标组件库结构）

按「基础原子 → 组合组件 → 业务组件」三层沉淀到 `frontend/src/components/`，为后续工作流页面（直播上架/跨境选品）提供统一基座。

```
frontend/src/components/
├── ui/                       # 基础原子（现有 ui.tsx 拆分）
│   ├── Button.tsx            # Btn（default/primary/ghost/danger/sm）
│   ├── Input.tsx             # qs-input 封装（input/textarea/select）
│   ├── Badge.tsx
│   ├── Card.tsx
│   ├── Modal.tsx / ModalFooter.tsx
│   ├── Field.tsx / Label.tsx
│   ├── SectionTitle.tsx
│   ├── Avatar.tsx
│   ├── Glyph.tsx             # 图标（可扩展为图标集）
│   ├── Spinner.tsx / EmptyState.tsx
│   └── index.ts              # 统一出口
├── feedback/                 # 反馈类
│   ├── Toast.tsx / Toaster.tsx
│   ├── StatusDot.tsx         # qs-dot 语义化（含脉冲/灰/绿/紫）
│   └── AgentStatusBadge.tsx  # 状态徽章（复用 agentStatus.ts）
├── layout/                   # 布局类
│   ├── Tabs.tsx
│   ├── Breadcrumb.tsx
│   ├── Timeline.tsx
│   ├── Popover.tsx / Dropdown.tsx
│   └── ResizeHandle.tsx
├── workflow/                 # 工作流类（工作流页面通用）
│   ├── StageStepper.tsx      # 6 阶段条（头像/拍板/完成角标）
│   ├── StageFlowMini.tsx     # 看板卡内紧凑进度条
│   ├── useStageState.ts      # 阶段状态推导 hook
│   └── StatusTag.tsx         # 任务状态徽章
├── data/                     # 数据展示类
│   ├── DataTable.tsx
│   ├── StatCard.tsx
│   └── ProgressBar.tsx
├── media/                    # 媒体类
│   ├── ImageThumb.tsx
│   └── ImagePreview.tsx      # lightbox
└── chat/                     # 会话类
    ├── AvatarStatus.tsx      # 头像+右下状态点
    ├── SelectableAvatar.tsx  # 选中态头像圈
    ├── MessageBubble.tsx
    └── ReceiptLine.tsx
```

> 沉淀原则（CLAUDE.md）：仅抽取**已重复 ≥2 处**或**明确将随新工作流页面复用**的模式；单次使用的内联代码不强行抽象。共享工具（agentStatus/format/stageState）优先沉淀为 `frontend/src/lib/` 纯函数。

---

## 5. 一致性审计结果（圆角 / 颜色 / 间距 对照 QS 规范）

> 本轮**仅审计、不修改**。以下为与 SPEC 不符或存在风险的项，建议后续修复。改动涉及多文件，将拆分为独立小任务逐项落地（每项都有验证方式）。

### 5.1 圆角（radius）审计

| # | 位置 | 现状 | 规范值 | 判定 | 建议 |
|---|---|---|---|---|---|
| R1 | `TaskDetailView.tsx` L358 返回按钮 | `rounded-[6px]` | 4px | ❌ 不一致 | 改 `rounded-[4px]` |
| R2 | `AgentSettingsModal.tsx` checkBox | `rounded-[3px]` | 4px | ❌ 微偏差 | 改 `rounded-[4px]` |
| R3 | `TaskDetailView.tsx` 事件 mark（L138/145） | `rounded-[3px]` | 4px | ❌ 微偏差 | 改 `rounded-[4px]` |
| R4 | `TaskDetailView.tsx` StageStepper 拍板角标（L245） | `rounded-[3px]` | 4px | ❌ 微偏差 | 改 `rounded-[4px]` |
| R5 | `BoardView.tsx` 负责人 chip（L97） | `rounded-full` | pill 条件使用 | ⚠️ 需确认 | 属「极短状态/标签」，QS 允许，但建议统一为 pill 语义（保留） |
| R6 | `App.tsx` TopBar 任务角标、Toast action、状态点 | pill / 4px | — | ✅ 合规 | 保留 |
| R7 | `ContentDeliveryView.tsx` 图片边框、信息条 | `rounded-[4px]` | 4px | ✅ 合规 | 保留 |
| R8 | `ChatPanel.tsx` 消息气泡 | 4px | 4px | ✅ 合规 | 保留 |
| R9 | `TaskDetailView.tsx` 当前阶段卡、审批条 | 4px | 4px | ✅ 合规 | 保留 |

### 5.2 颜色审计

| # | 位置 | 现状 | 问题 | 建议 |
|---|---|---|---|---|
| C1 | `index.css` L207 `.qs-dot.unconfigured` | 硬编码 `#a1a1aa` | 应引用 token | 改 `var(--color-ink-faint)` |
| C2 | `ObservabilityView.tsx` dotColor L36 | 硬编码 `#a1a1aa` | 同上 | 抽 `agentStatus.ts` 统一 |
| C3 | `BoardView.tsx` 负责人 chip L98 | `rgba(0,0,0,0.04)` | 半透明黑底，非 token | 建议 `var(--color-sunken)` |
| C4 | `ChatPanel.tsx` 消息气泡 L226 | `rgba(0,0,0,0.045)` | 同上 | 建议 `var(--color-sunken)` |
| C5 | `index.css` qs-nav-item hover L275 | `rgba(0,0,0,0.04)` | 同上 | 建议 token 化 |
| C6 | `index.css` qs-rail-icon hover L375 | `rgba(0,0,0,0.04)` | 同上 | 建议 token 化 |
| C7 | 状态语义色（ok/warn/danger）| 已在 @theme | 属 Kit 扩展 | ✅ 合规（保留） |
| C8 | Modal 遮罩 `bg-black/25`、图片预览遮罩 `rgba(10,10,10,0.72)` | 语义遮罩 | 可接受 | 保留 |

### 5.3 间距审计

| # | 位置 | 现状 | 问题 | 建议 |
|---|---|---|---|---|
| S1 | `qs-label` margin-bottom | 5px | 无 token 依据 | 建议 `space.block` 体系：`margin-bottom: 8px`（2u，u=4px） |
| S2 | `.qs-btn` padding | 6px 16px / sm 3px 12px | 无 token 依据 | 建议固定为按钮尺寸 token（h-32px 常规 / h-24px sm） |
| S3 | `.qs-input` padding | 8px 11px | 无 token 依据 | 建议 h-34px 常规、输入内边距统一 |
| S4 | 页面主区 `main p-4` / 看板标题 `mb-3.5` | 16px / 14px | 无 token | 建议统一 `space.section/group` |
| S5 | 各卡内 padding | px-3~5 / py-2~4 混用 | 无 token | 建议 Card 统一 16px（4u），紧凑版 12px |
| S6 | 模态框 | header px-5 py-3 / body p-5 | 无 token | 建议统一 20px/16px |

> **结论**：圆角问题集中在 **TaskDetailView 6px 返回按钮 + 3 处 3px 微偏差**（R1~R4，建议后续统一为 4px）；颜色问题为**硬编码 #a1a1aa 与 rgba 半透明底未 token 化**（C1~C6）；间距为**整体缺少 token 体系**（S1~S6，属结构性改进，可结合「视效升级」一并落地）。

---

## 6. 后续工作流页面的复用指引

1. **新工作流页面（直播上架 / 跨境选品）结构模板**：沿用 `BoardView` 标题行 + 四列看板 + `TaskDetailView`（阶段条 + 内容交付 + 活动日志 + 属性面板）的骨架，只替换 `WORKFLOW_STAGE_*` 配置与负责人映射。
2. **阶段配置外置**：工作流阶段名/拍板点/负责人角色已由 `@workbench/shared` 的 `WORKFLOW_STAGE_*` + `STAGE_OWNER_ROLE` 承载，新工作流只需新增一组常量 + 一个 workflow 图定义（后端 `workflows.stages_json`），前端 `StageStepper/StatusTag/ContentDeliveryView` 天然复用。
3. **组件接入顺序**：先沉淀基础原子（§4 的 ui/ + feedback/）→ 再抽业务组件（workflow/ + media/ + chat/）→ 新页面直接组合，避免复制内联样式。
4. **风格红线（禁止项，SPEC §7）**：不做玻璃拟态 / 渐变光晕 / 层层圆角 / 卡片墙 / 胶囊泛滥 / 装饰性 3D / 无意义循环动效；紫色仅作焦点与关键状态，稀疏使用。

---

## 7. 变更范围（本文件之后的分步计划，均待用户确认）

| 步骤 | 内容 | 涉及文件 | 验证 |
|---|---|---|---|
| P1 | 圆角统一 4px（R1~R4） | TaskDetailView / AgentSettingsModal | 截图核对 4 处 |
| P2 | 颜色 token 化（C1~C6） | index.css / ObservabilityView / BoardView / ChatPanel | grep 无 #a1a1aa / rgba(0,0,0,0.0) |
| P3 | 抽 agentStatus.ts + AgentStatusDot / AgentStatusBadge | 新建 + 4 文件替换 | tsc + 4 处状态一致 |
| P4 | 抽 Tabs / Breadcrumb / Timeline / EmptyState 等基础组件 | 新建 + 2~3 文件替换 | tsc + 截图 |
| P5 | 抽 AvatarStatus / SelectableAvatar / 阶段组件 | 新建 + 替换 | 截图 |
| P6 | 间距 token 体系（S1~S6） | index.css @theme | 视觉走查 |
| P7 | 视效升级（另文《组件视效规划表》，参考 4 个组件网站） | 按确认结果分批 | 截图对比 |

> 以上 P1~P7 均未执行，等待用户确认后按顺序实施。

---

## 8. 实施进度（2026-09-09 更新，用户已确认按 P1→P7 推进）

| 步骤 | 状态 | 落地说明 | 验证 |
|---|---|---|---|
| P1 圆角统一 4px | ✅ 完成 | TaskDetailView 返回按钮 6px→4px、事件 mark 3px→4px×2、拍板角标 3px→4px；AgentSettingsModal 勾选块 3px→4px（共 5 处） | tsc 0 error；浏览器实测返回按钮/事件区正常 |
| P2 颜色 token 化 | ✅ 完成 | index.css `#a1a1aa`→`var(--color-ink-faint)`、`rgba(0,0,0,0.04)`→`var(--color-sunken)`×2；BoardView 负责人 chip、ChatPanel 气泡、ObservabilityView dotColor 全部 token 化（Toast 浮层阴影 L305 保留为浮层例外） | tsc 0 error；页面实测无视觉回归 |
| P3 抽 agentStatus.ts | ✅ 完成 | 新建 `lib/agentStatus.ts`（AGENT_STATUS_META + agentDotClass/Label/Color/BadgeTone）；WorkstationBar 与 ObservabilityView 收敛至共享；App/ChatPanel 保留其「后缀 dot + 差异化文案」的有意差异（未强行统一，避免改变功能） | tsc 0 error；工位/状态显示与改动前一致 |
| P4 抽 Tabs 组件 | ✅ 完成 | ui.tsx 新增 `Tabs`（下划线式 2px 紫 + 可选角标计数）；TaskDetailView（内容交付/任务详情）与 ContentDeliveryView（主图/详情图，带计数）替换 | tsc 0 error；两处 Tabs 实测正常 |
| P5 AvatarStatus/阶段组件抽取 | ⏸ 文档已定稿 | App/ChatPanel 使用不同的 dot 体系（busy/idle/ok/no 后缀）且文案有意差异，强行统一有回归风险；规格已在 §4 定稿，待后续工作流页面实际复用时再实施 | — |
| P6 间距 token | ✅ 完成 | index.css @theme 新增 `--space-1..6`（4px 基数体系）；现有内联值保持不动（视觉零变化），供新组件/后续页面引用 | tsc 0 error |
| P7 视效升级（克制版） | ✅ 完成 | index.css 新增 `.qs-interactive`（可点击卡 hover 微抬升+边框加深+极轻阴影，含 reduced-motion 降级）、`.qs-btn.signal`（紫色主按钮可选变体，不替换现有黑色 primary）、`.qs-input:disabled` 视觉；BoardView 看板卡应用 qs-interactive；未动图片/头像/功能 | tsc 0 error；看板/详情/交付页截图回归无异常 |
| P7 视效升级（完整版） | ✅ 完成 | 追加 5 项规划表借鉴点：① 输入框 hover 边框微加深（21st.dev input）；② 默认按钮 hover 背景微变 sunken；③ 左侧导航激活项主色 2px 指示条（21st.dev Sidebar）；④ 步骤当前节点「点亮」呼吸光圈 `qs-step-pulse`（Aceternity Multi Step Loader，2px 主色+7px 浅紫外圈，2.6s 缓呼吸）；⑤ 按钮 loading 态 `qs-btn-spinner`（Aceternity Stateful Button，随前景色旋转指示）——Btn 组件新增 `loading` prop 并接入 AgentSettingsModal 保存按钮（文案不变）；全部含 prefers-reduced-motion 降级 | tsc 0 error；DOM 实测：导航指示条 2px/#7C3AED ✓、qs-step-pulse 动画运行 ✓、看板/详情页截图无回归 |

> 说明：vite build 在本沙箱环境因 esbuild spawn EPERM（命名管道限制）无法执行；已用 `tsc --noEmit`（build 脚本内同样先跑，0 error）+ 运行中 dev server 浏览器截图回归替代验证。dev server 构建环境不受该限制，正式构建请在本机正常终端执行。
