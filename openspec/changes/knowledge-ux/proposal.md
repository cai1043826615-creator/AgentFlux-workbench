## Why

知识库管理系统（板块 B）的能力已经齐备（Vault 索引、目录/标签浏览、Markdown 阅读、中文全文搜索、知识星图、每日热点，`knowledge-base` 26/26 完成），但**知识库页只在用户主动翻找时才给出信息**：

- 页首只有四张统计卡（文档/标签/目录/关联边），看不到「这条知识库是否健康」：有多少资料真正被任务用过（文档使用率），有多少资料是 Agent 永远检索不到的孤岛文件（既无文档间链接、又无共享标签）。
- 星图没有操作说明、没有图例、没有缩放控件、没有过滤。用户面对一屏散点，不知道「悬停/点击/双击各做什么」，也无法把注意力收窄到「产品资料」或「品牌规范」。
- 空状态一律是「暂无数据」「暂无图谱数据」，只说「这里是什么」，不说「下一步该做什么」——已连接但索引为空、搜索无结果、「关联知识库资料」无搜索结果这几类场景下，用户被留在原地。

后果是一个危险的错觉：**「资料放进 Vault 就等于进了知识库」**。孤岛文件（无链接、无共享标签）在星图里孤立，在检索里排不上，而界面上没有任何提示这件事。本 change 修正这三处体验缺口，不新增视图、不打断既有三栏浏览效率。

依据文档：`docs/优化方向-2026-09-11-知识库与工作流.md`（唯一事实来源）§0 前提原则 与 §四 `T2 · knowledge-ux`（条目 A1 / A2 / A3 / A5）。指标口径以该文 §0.2 为准：知识库侧的「文档使用率」与任务侧的「产出溯源率」是两套指标，必须分开命名。

## What Changes

- **A1 · 顶部紧凑总览带**：在知识库页（已连接态）顶部横向铺一条紧凑总览带，包含统计四项（文档/标签/目录/关联边，复用 `knowledgeStats()`）、**星图缩略预览**（复用现有自绘 canvas，缩小只读渲染，点击进入星图视图）、最近更新条目、健康度摘要。**不新增视图，不改变既有三栏（目录/标签 → 文档列表 → 阅读区）的结构与行为**。
- **A2 · 知识健康度（缩小显示）**：新增后端健康度查询（文档使用率 = 被至少一个任务关联过的文档数 ÷ 已索引文档总数；孤岛文件数 = 既无文档间链接又无共享标签的文档数），以紧凑形式呈现：总览带内小指标 + 星图工具栏「N 页面 / M 双链 / K 孤岛」。**不新增大块面板**；孤岛文档可一键筛选列出（与 A3 的图谱过滤联动），因为孤岛 = Agent 永远检索不到的资料。
- **A3 · 星图交互提示 / 图例 / 缩放控件 / 过滤**：页头补操作说明「悬停看关系，点击聚焦邻居，双击进入文档」；工具栏补图例「拖拽 · 滚轮缩放 · 双击阅读」；右下补缩放控件（百分比 + 放大 / 缩小 / 适配）；新增**图谱透镜过滤**（按目录 / 按标签 / 按「有链接 vs 孤岛」/ 业务预设「只看产品资料」「只看品牌规范」）；**双击节点进入文档阅读，同时保留单击出节点详情**。
- **A5 · 空状态写「怎么用」**：每个空态除说明「这里是什么」外必须给「下一步该做什么」，至少覆盖 7 类：知识库未连接（保留现状）、已连接但无文档 / 无标签 / 无目录、星图无数据（无链接无标签）、搜索结果为空、热点不可用 / 无热点、「关联知识库资料」步骤无搜索结果。
- **边界与不破坏**：不新增视图、不新增数据表、不引入运行时依赖、图表继续自绘；三栏浏览、全文搜索、Markdown 阅读、未连接空状态、板块 A（工作流）全部既有行为必须回归验证不受影响。

## Capabilities

### New Capabilities

- `knowledge-overview`: 知识库页顶部紧凑总览带（统计四项 + 星图缩略预览 + 最近更新）、知识健康度（文档使用率 / 孤岛文件数及孤岛一键筛选、健康度查询接口）、知识域空状态「说明 + 下一步」的统一要求、以及既有知识库页行为的回归保障。

### Modified Capabilities

- `knowledge-graph`: 对**未归档** change `knowledge-base` 中同名 capability 的**语义修订**。修订内容为增量补充星图的交互提示与图例、缩放控件（百分比 + 放大/缩小/适配）、图谱透镜过滤（目录 / 标签 / 有链接 vs 孤岛 / 业务预设）、双击节点进入文档阅读（保留单击详情）、以及图数据的孤岛标记。
  - **表达方式说明（已实测）**：`knowledge-base` 按用户要求暂不归档，`openspec/specs/` 下尚无 `knowledge-graph` 基架。实测把本 change 的 `knowledge-graph` delta 写成 `## MODIFIED Requirements` 时，`openspec validate knowledge-ux` 虽仍 `valid: true`，但会给出 INFO：`Archive would refuse this delta: knowledge-graph: target spec does not exist; only ADDED requirements are allowed for new specs.`——即归档会被拒绝。因此本 change 对 `knowledge-graph` 的全部条目以 `## ADDED Requirements`（增量）表达，**不改写、不删除** `knowledge-base` 中既有 requirement 文本；语义上这些条目是既有「图谱可视化 / 节点详情与原文跳转」的扩展与修订（例如双击阅读是对原「点击节点 → 跳转阅读」交互的补充，单击详情保持不变）。归档 `knowledge-base` 后如需合并，由归档流程统一处理。

## Impact

- **后端**（新增/扩展，不加依赖）：
  - 新增 `backend/src/knowledge/health.ts`：文档使用率与孤岛判定的唯一计算函数（`computeDocUsageRate()` / `islandDocPaths()` / `knowledgeHealth()`），供 `knowledgeStats` 之外的只读查询复用。若 T1 `quality-loop` 已提供同义函数，则改为复用其实现（口径以主文档 §0.2 为准）。
  - 扩展 `backend/src/knowledge/graph.ts`：文档节点新增 `isolated` 标记，孤岛判定与健康度接口共用同一函数，保证两处计数一致。
  - 扩展 `backend/src/routes/knowledge.ts`：新增 `GET /api/knowledge/health`（返回文档使用率、孤岛数与孤岛路径清单）。
  - 只读消费既有表 `knowledge_docs` / `knowledge_links` / `task_kb_refs`，**不改表结构**（`task_kb_refs` 由 T1/T4 只读共享，见主文档 §六）。
- **前端**（新增组件 + 局部改造）：`frontend/src/features/knowledge/KnowledgeView.tsx`（总览带挂载、无文档/无标签/无目录空态、搜索空态、孤岛清单筛选）；`frontend/src/features/knowledge/KnowledgeGraphView.tsx`（说明/图例/缩放控件/过滤/双击）；新增总览带与只读缩略图组件（建议落在 `frontend/src/features/knowledge/`）；`frontend/src/components/ui.tsx`（`Empty` 组件新增可选「下一步」提示与可断言标记，既有用法不变）；`frontend/src/features/knowledge/HotView.tsx` 与 `frontend/src/features/knowledge/KbRefPicker.tsx`（仅补空态指引文案）；`frontend/src/store/useWorkbench.tsx`（如需跨视图传递孤岛/预设筛选态，优先用星图视图本地 state，避免扩全局状态）。
- **共享类型**：`packages/shared/src/knowledge.ts` 新增 `KnowledgeHealth` 与图谱预设常量，`KnowledgeGraphNode` 增加可选 `isolated` 字段——均为向后兼容的增量字段，不破坏既有消费方。
- **不影响既有功能**：不新增视图与路由入口；三栏浏览、搜索、阅读、未连接空状态、板块 A（工作流）全部既有行为保持不变；Vault 仍只读；知识库未连接时板块 A 照常运行。
- **验收基线**：`docs/验收记录-2026-09-11-知识库板块.md`；`openspec validate knowledge-ux` 必须通过。
