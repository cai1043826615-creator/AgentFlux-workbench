## Context

知识库管理系统（板块 B）已完整落地（`openspec/changes/knowledge-base` 26/26，按用户要求暂不归档）：后端 `backend/src/knowledge/`（Vault 只读接入、索引、FTS5 检索、`docs.ts` 浏览/阅读、`graph.ts` 图谱、`refs.ts` 任务关联注入、`hot.ts` 热点），前端 `frontend/src/features/knowledge/`（`KnowledgeView.tsx` 三栏浏览+搜索+阅读、`KnowledgeGraphView.tsx` 自绘 canvas 力导向星图、`HotView.tsx`、`KbRefPicker.tsx`），共享契约在 `packages/shared/src/knowledge.ts`，REST 端点在 `backend/src/routes/knowledge.ts`。

本 change 是 `docs/优化方向-2026-09-11-知识库与工作流.md` §四 的 T2 梯队（条目 A1 / A2 / A3 / A5），只在**既有页面结构内**做体验升级：顶部总览带、缩小的健康度、星图可用性层、空状态「下一步」。前提原则见该文 §0：知识库是信息基础、热点只是环境情报；「文档使用率」（知识库侧）与「产出溯源率」（任务侧，T1）必须分开命名；板块独立性不得破坏（Vault 只读、知识库异常不阻塞板块 A）；不引入重型运行时依赖，图表继续自绘。

## Goals / Non-Goals

**Goals:**

- 知识库页「一眼可见」：文档/标签/目录/关联边 + 星图缩略预览 + 最近更新 + 健康度，且**不新增视图、不打断既有三栏浏览效率**
- 健康度可见且可下钻：文档使用率（§0.2 定义）+ 孤岛文件数，孤岛可一键筛选列出（孤岛 = Agent 永远检索不到的资料）
- 星图可控可收窄：操作说明、图例、缩放控件（百分比 + 放大/缩小/适配）、图谱透镜过滤（目录 / 标签 / 有链接 vs 孤岛 / 业务预设）、双击进阅读同时保留单击详情
- 空状态不再是死胡同：8 类空态均给出「下一步该做什么」，且**可自动化断言**（`data-qs-empty` / `data-qs-empty-next`）
- 零回归：三栏浏览、搜索、阅读、未连接空状态、板块 A 独立性、Vault 只读全部保持

**Non-Goals:**

- 不做 RAG 自动检索、不做交付物回写 Vault（仍属 v2 边界）
- 不新增数据表、不修改既有表结构（`task_kb_refs` 只读消费，见主文档 §六.2）
- 不引入图库 / 图表库 / 状态管理库；不改用第三方图谱组件
- 不做星图标签节点的双击跳转（标签无原文可读，保持选中与详情）
- 不做后端过滤接口（过滤在前端完成，见 D6）
- 不改写 `knowledge-base` 中既有 requirement 文本；不改动 `docs/` 下既有文件

## Decisions

### D1. 总览带形态：页面顶部插入式组件，不新增视图
**选择**：在 `KnowledgeView.tsx`「已连接」分支中，把现有四张统计卡替换/升级为一条 `<KnowledgeOverviewBar />`（建议新文件 `frontend/src/features/knowledge/KnowledgeOverviewBar.tsx`），横向排布：统计四项（`knowledgeStats()`）+ 星图缩略预览 + 最近更新 + 健康度小指标。总览带高度设上限（约 120–140px），下方三栏结构、宽度（目录/标签 210px、列表 300px、阅读自适应）与交互完全不动。
**理由**：用户已明确选择「顶部紧凑总览带」，不新增视图是硬约束；统计四项复用既有 `knowledgeStats()`，零新增后端成本。
**备选**：新增「知识库仪表盘」视图（被否：打断三栏浏览效率）；把健康度做成右侧固定面板（被否：A2 明确要求「不新增大块面板」）。

### D2. 星图缩略预览：抽出渲染内核，只读 + 静态布局
**选择**：把 `KnowledgeGraphView.tsx` 的绘制逻辑抽成公共渲染函数（建议 `frontend/src/features/knowledge/graphCanvas.ts`，如 `layoutInitial(nodes)` 与 `drawGraph(ctx, { nodes, edges, view, size, selectedId, zoom })`），主视图与缩略图共用；缩略图使用与主视图一致的确定性环形初始布局**静态绘制一次**（数据变化或尺寸变化时重绘），**不启动 `simulate()` 力导向循环、不绑定指针与滚轮事件**；点击缩略区域 → `setView('knowledge-graph')`。
**理由**：主视图每帧 `requestAnimationFrame` + 全节点 O(n²) 斥力，缩略图再跑一份会白白争抢 CPU，而缩略图只需要「看得出形状」；交互全部留在主视图。
**备选**：直接复用 `KnowledgeGraphView` 传 `readonly`（被否：组件内含详情侧栏、搜索、刷新、ResizeObserver 与模拟循环，条件渲染分支过多，且两个 rAF 循环并存）。

### D3. 健康度计算归属：后端唯一实现，新增 `health.ts`
**选择**：新增 `backend/src/knowledge/health.ts`，导出 `computeDocUsageRate()`（文档使用率）、`islandDocPaths()`（孤岛路径集合）、`knowledgeHealth()`（聚合）；`graphData()` 的 `isolated` 标记直接调用 `islandDocPaths()`，保证接口计数与图谱标记同源。
**理由**：口径必须唯一（主文档 §0.2 与 §六.1 要求 T1/T2 共用同一口径）；后端一次算清，前端不重复推导。若 T1 `quality-loop` 已先提供同义计算函数，则本 change 改为复用其实现、不重复造第二个口径（见 Open Questions 1）。

### D4. 孤岛判定实现：一次遍历，标签按 trim 后原字符串比较
**选择**：孤岛 = 同时满足「无文档间链接边（`knowledge_links` 中 `kind='link'` 的入边与出边均为空）」与「无共享标签（其任一标签被 ≥2 篇文档声明；无标签亦满足）」的文档。实现上取 link 边的 source/target 并集得「有链接集合」，再遍历 `knowledge_docs.tags` 建「标签 → 文档数」映射，两集合相减得到孤岛；标签比较为去掉首尾空白后的原字符串精确匹配（与 `listTags()` / `graphData()` 一致，不做大小写归一化）。
**理由**：文档量数百级，O(n) 内存计算足够；与既有标签语义不分叉，避免同一标签在标签区与孤岛判定中判定不同。
**反例（必须写进测试）**：只有独有标签（无其他文档共享）的文档仍算孤岛——「有标签边」不等于「有共享标签」。

### D5. 文档使用率实现：分子只算仍在索引中的文档
**选择**：分子 = `SELECT count(DISTINCT doc_path) FROM task_kb_refs` 与当前索引路径求交（仅统计仍存在于 `knowledge_docs` 的路径，重复关联去重）；分母 = `count(*) FROM knowledge_docs`；`totalDocs === 0` 时 `ratio = null`。前端展示为「25%（3/12）」，`null` 展示为「—」。
**理由**：`task_kb_refs` 中的失效行（文档已移出 Vault/索引范围）不应虚高使用率；除零必须可解释。
**命名约束**：代码与界面一律「文档使用率 / `docUsageRate`」，禁止使用「产出溯源率 / `traceabilityRate`」（任务侧指标，T1）。

### D6. 过滤在前端完成，状态为星图本地 state
**选择**：`KnowledgeGraphView` 内维护 `filters: { dir: string | null; tag: string | null; isolation: 'all' | 'linked' | 'island'; preset: string | null }`，由可见节点集合推导可见边（两端均可见才画），并让可见集合参与命中测试与「适配」范围；被过滤掉的当前选中节点触发 `setKbNodeId(null)` 清空详情。`/api/knowledge/graph` 只增加 `isolated` 字段，不新增查询参数。
**理由**：数百节点前端过滤是瞬时操作，交互（拖拽/缩放中切换过滤）体验更好；后端过滤需要每次筛选一次请求，且既有「节点搜索定位」依赖全量节点集。
**备选**：后端 `?dir=&tag=&isolation=` 参数（被否：请求往返与状态同步成本高，且收益不明显）。

### D7. 双击与单击共存：`onDoubleClick` 负责跳转，`pointerup` 负责选中
**选择**：保留既有 `onPointerUp` 的单击逻辑（未拖动 → `setKbNodeId(id)`，空白取消选中），新增 canvas `onDoubleClick`：命中文档节点 → 调既有 `openKbDoc(node.path)`（等价于视图切到知识库并打开该文档）；命中标签节点 → 不跳转（保持选中）。单击逻辑不改写 `kbDocPath`。
**理由**：双击进入阅读要求「单击仍出详情」，两者职责分离最稳；`dblclick` 触发时先发生的一次单击只产生选中（同视图内的可接受副作用），不产生跳转。
**验证**：双击 → `view === 'knowledge'` 且阅读区标题为该文档；单击 → `view` 不变、详情面板有内容、`kbDocPath` 未变。

### D8. 缩放控件：单一变换入口 + 百分比同步 state
**选择**：把「设置 zoom/pan」收敛为一个内部函数（clamp 到 0.25–3 后写 `viewRef`），并在每次变换后 `setZoomPct(Math.round(zoom * 100))`；放大/缩小按钮按 ×1.2 / ÷1.2 步进；适配 = 计算可见节点包围盒（含内边距）→ `zoom = clamp(min(w / bw, h / bh))`、`pan` 使包围盒中心对齐画布中心。
**理由**：滚轮、按钮、适配三条路径写同一处，避免「按钮改了 zoom、百分比没更新」或状态双源不一致。

### D9. 空状态的统一形态：`Empty` 组件扩展可选「下一步」
**选择**：`frontend/src/components/ui.tsx` 的 `Empty` 增加可选 `hint`（下一步指引）与 `emptyKey`（场景标识）两个参数：`text` 渲染在 `data-qs-empty="<key>"` 节点上，`hint` 渲染在 `data-qs-empty-next="<key>"` 节点上；不传 `hint` 时行为与现在完全一致（既有调用点无需改动即可编译通过）。
**理由**：可见即可断言——空态文案是纯展示层，自动化回归必须有一个稳定的挂钩；用 data 属性而不是文案关键字匹配，避免文案微调就打碎测试。

### D10. A5 中热点与「关联知识库资料」空态的声明归属
**选择**：这两处空态的要求写在 `knowledge-overview` delta 中，实现落在 `HotView.tsx`（daily-hot 表面）与 `KbRefPicker.tsx`（workflow-context 表面），不向 `daily-hot` / `workflow-context` 写 delta。
**理由**：`daily-hot` 的 spec 将由并行梯队 T3 `hot-intel` 以 MODIFIED 改写（见主文档 §六.4），本 change 若同时对 `daily-hot` 写 delta，会与 T3 产生同 capability 冲突；A5 本身是跨知识域的统一 UX 要求，集中声明更易整体验收。
**代价**：能力归属不够纯粹（知识库总览的能力里含热点页文案要求）；如需严格归属，可在 T3 归档后迁移（见 Open Questions 8）。

### D11. 与 T1 `quality-loop` 的并行协调
**选择**：共享点仅两处——`packages/shared/src/knowledge.ts`（本 change 只**追加** `KnowledgeHealth`、`isolated`、预设常量，不改既有声明）与「文档使用率」计算函数（本 change 落在 `backend/src/knowledge/health.ts`，若 T1 已提供则复用）。
**理由**：主文档 §六.1 要求口径统一、§六.2 要求 `task_kb_refs` 只读不改表结构；追加式改动可并行不冲突。

## Risks / Trade-offs

- [缩略图与主视图绘制分叉，后续改一处忘另一处] → 共用 `graphCanvas.ts` 渲染内核 + 主视图视觉回归截图比对 + 缩略图节点数断言
- [总览带挤压三栏可用高度（现为 `max-h-[62vh]` 固定）] → 总览带高度上限；文档列表/阅读区高度改为随视口自适应（保留滚动），回归验证三栏均可滚动、无内容被裁切
- [过滤后残留已消失节点的选中与详情] → 过滤应用时清除被排除的选中节点（D6）+ 对应 scenario
- [缩放百分比与画布实际比例不同步（ref/state 双源）] → 单一变换入口 + 每次变换后同步百分比（D8）
- [孤岛口径被误实现为「图中没有任何边」] → 独有标签文档仍有标签边但仍是孤岛；测试用 A/B/C/D 四文档样本固定住口径（D4）
- [`task_kb_refs` 中残留失效行导致使用率虚高] → 分子与当前索引求交（D5）+ 单测覆盖
- [空态改造涉及 4 个前端文件，漏改某一类] → tasks 4.2–4.7 逐类列出并逐条核对 `data-qs-empty` / `data-qs-empty-next`
- [预设依据未定（目录还是标签）导致返工] → 预设集中声明为常量/配置（D2 前置 + 见 Open Questions 1），实现期先内置默认值
- [双 rAF 循环带来性能问题] → 缩略图不跑模拟（D2），只静态绘制
- [与 T1 并行改同一共享文件] → 只追加不改写（D11）

## Migration Plan

- **数据**：无迁移。不新增表、不改表结构；`health` 接口与 `isolated` 字段均为只读派生数据，可随时回滚（回滚 = 移除新增组件与字段，旧前端忽略未知字段）。
- **实施顺序**：共享契约 → 后端健康度（health.ts / graph.ts / 路由 / 单测）→ 总览带（含缩略预览）→ 星图交互与过滤 → 空态 8 类 → 回归与验收。该顺序保证每一步都可独立验证，且后端先于前端可用。
- **并行拆分**（与主文档 §四「并行拆分建议」一致，可 3 路并行）：
  - 路 1：A1 + A2（后端健康度、总览带、缩略预览、孤岛筛选）——同一区域，建议同一子代理
  - 路 2：A3（星图渲染内核抽取、说明/图例、缩放控件、过滤、预设、双击）
  - 路 3：A5（空态 8 类清单，含热点与关联资料步骤）
  - 注意：路 1 与路 2 都会触及 `KnowledgeGraphView.tsx`（缩略预览需要渲染内核），必须**先完成渲染内核抽取（tasks 3.1）再让路 1 接缩略预览（tasks 2.3）**，同一文件不得两路同时改。
- **回滚**：本 change 全部为增量（新文件 + 追加字段 + 组件内新增区块），按文件回退即可，不涉及数据修复。

## Open Questions

1. ~~**业务预设「只看产品资料」「只看品牌规范」的依据**~~（**已拍板，2026-09-11**）：**按目录预设**（默认 `10_raw/products` 与 `wiki/brand`），且**可在连接设置里修改**（持久化到设置表，本地保存、不入版本库）；按**标签**过滤作为**独立过滤维度**保留（不与预设绑定）。预设依据的目录在当前索引中不存在时的降级：显示空态指引 + 可一键清除过滤。
2. **目录过滤是单选还是多选**？当前设计为单选（与目录树点击一致），且包含子孙目录（与 `listDocsByDir(recursive=true)` 一致）——若要多选，需要额外的多选控件与状态形状。
3. **「仅有链接」的口径**：是否只算 Markdown 文档间链接（`kind='link'`）？当前设计**不含**仅通过共享标签连通（无文档间链接）的文档；若用户认为「共享标签也算连通」，需同时调整孤岛定义（会显著减少孤岛数，与 §四「孤岛 = Agent 永远检索不到」的直觉冲突）。
4. **孤岛一键筛选的落点**：本 change 落在文档列表区（复用既有列表）+ 星图「仅孤岛」过滤；是否还需要在左栏目录/标签区增加一个固定「孤岛」虚拟筛选项？
5. **文档使用率的分母**：当前为「当前已索引文档总数」（即受索引范围白名单约束）；是否需要额外展示「Vault 中全部 Markdown 数」作为对照（会引入索引范围外的计数语义，暂不做）。
6. ~~**预设是否需要持久化**~~（**已拍板，2026-09-11**）：**存设置表让用户可改**（用户明确要求「可在连接设置里修改」）。实现取「内置默认值 + 设置表覆盖」：设置缺失或非法时回退内置默认，不报错；写入路径只动 `settings`（共享配置基础设施），不违反 Vault 只读边界。
7. **图谱为空时总览带的缩略预览**：本 change 取「显示空态 + 下一步指引」；是否更希望直接隐藏缩略区、让总览带更紧凑？
8. **A5 空态的能力归属**：热点不可用/无热点与「关联知识库资料」无搜索结果的空态，本 change 暂声明在 `knowledge-overview`（理由见 D10）；是否需要在 T3 `hot-intel` 归档后，把这两条迁回 `daily-hot` / `workflow-context` 的 delta？
9. **文档使用率计算函数的最终归属**：若 T1 `quality-loop` 已提供同义实现，是否统一由 T1 的模块导出、本 change 只调用（避免两个函数名并存）？
