## Why

热点面板（`daily-hot`，未归档 change `knowledge-base` 交付）当前存在三个已被实证的问题，且与用户确认的最高前提原则冲突：

1. **边界越界（最严重）**：`knowledge-base` 让单条热点可以一键预填并派生出电商任务。现场实证——任务 `#7` 就是由热点「Apple 发布首款折叠屏 iPhone Duo，$1,999」一键创建成的「电商新品上架」任务，**产品主体来自热点，与真实业务无关**。这直接违反 `docs/优化方向-2026-09-11-知识库与工作流.md` §0.1：知识库决定「做什么产品」（产品事实），热点只是「环境情报」，只影响「怎么说」（合规、话术、时点）。
2. **信源单一、噪音严重**：现状只接 `https://aihot.virxact.com`（AI 行业聚合），与电商关注域交集很小，实测假阳性严重。用电商关注域匹配 AI 行业源时，`发布`/`预售`/`平台` 这类泛词导致 Apple 发布会、DeepSeek 模型发布都被判成「竞品动态」进入「今日必看」。
3. **可读性差**：用户明确反馈当前热点页「太丑、可读性太差」——统计只有一行纯文字计数、卡片无序号、只有领域标签没有证据等级、摘要单层平铺、单栏列表。

本 change 一次性完成边界修订 + 排版重做 + 多源接入 + 降噪四件事。**条目 1（边界修订）必须在最前且单独落地**：它改的是既有能力的语义，先切断「热点 → 产品任务」的通路，其余三项才有意义。

## What Changes

- **边界修订（条目 1，最先做）**：**移除**「热点创建任务」能力——删除热点卡片上的「创建任务」按钮（`frontend/src/features/knowledge/HotView.tsx`）与 `App.tsx` / `frontend/src/store/useWorkbench.tsx` 中 `openNewTask(prefill)` 的热点预填链路；热点成为**纯只读情报面板**。替代能力：用户在**任务详情**把某条热点**手动挂为任务背景**，走与知识库资料并列的注入通道，注入段中**明确标注为「外部环境情报」**，与知识库的「产品事实」严格区分。
- **A4 · 排版与信息分层重做（条目 2）**：顶部三枚统计药丸（多源热点 / 今日必看 / 24H 精选）替代一行纯文字；信息条补数据源新鲜度 + **上游日报外链**；卡片加 `01/02/03` 序号；卡片加**证据等级标签**（多源事件 / 单源 / 可回查原文）与领域标签；卡片内容分两层（`讯息` / `最新进展`，无进展则隐藏该层）；响应式多栏网格（大屏三栏 / 中屏两栏 / 窄屏单栏）+ 衬线大标题；保留并强化 live / stale / unavailable 三态降级提示的可读性。
- **B10 · 可插拔多源框架 + 至少 2 个非 AI 行业源（条目 3）**：把单一 `sourceBaseUrl` 改为**可插拔多源适配器注册表**，每个源标注来源与证据等级、可配置、可单源降级；至少接入 2 个覆盖 平台规则 / 促销节点 / 品类趋势 / 竞品动态 的非 AI 行业源。
- **降噪规则（条目 4）**：关注域配置增加**排除词**（命中直接降级）、**多词命中要求**（同一关注域需命中 ≥2 个关键词才成立，阈值可配置）、**源权重 / 来源分层**（非电商垂直源的条目默认不高于「浏览」层）。
- **不改**：知识库索引/检索/星图（板块 B 其余能力）、板块 A 状态机与既有业务表语义、`task_kb_refs` 表结构（只读复用）。

## Capabilities

### New Capabilities

- `hot-context`: 热点作为任务背景——用户在任务详情把某条热点**手动**挂为任务背景（存独立表 `task_hot_refs`），注入 Agent 上下文时该段明确标注为「外部环境情报」并声明不得作为产品品类/主体依据；热点源不可用时任务照常执行。

### Modified Capabilities

- `daily-hot`（未归档 change `knowledge-base` 的 delta capability，**语义修订**）：
  - **移除**原 `### Requirement: 热点创建任务` 的全部语义（含两个场景），系统不再提供任何从热点派生任务的入口；
  - 新增只读边界约束（热点不得成为产品品类/主体来源；新建任务表单不得被热点预填）；
  - 新增可插拔多源接入（至少 2 个非 AI 行业源）+ 每源来源与证据等级标注 + 单源降级；
  - 新增降噪规则（排除词 / 多词命中阈值 / 源权重分层）；
  - 新增热点卡片信息分层与响应式排版要求。

**关于 delta 表达方式（重要）**：主 `openspec/specs/` 中**尚无 `daily-hot` 正式 spec**——它只作为 `openspec/changes/knowledge-base` 的 delta 存在，而 `knowledge-base` 按用户要求**暂不归档**（26/26 已完成）。因此本 change 的 `specs/daily-hot/spec.md` **全部使用 `## ADDED Requirements`**，把「移除热点创建任务」表述为正向的边界约束 requirement（「热点不派生任务」），而不是 `## REMOVED Requirements` / `## MODIFIED Requirements`：后者会把本 change 变成必须叠加在 `knowledge-base` 之上的依赖型 delta，破坏 §0.3「梯队间互不阻塞」，且在当前主 spec 为空的情况下无法独立校验。`knowledge-base.specs.daily-hot` 的原文语义**由本 change 覆盖**，`knowledge-base` 归档时以本 change 为准（见 design.md 的 Migration Plan 与 Open Questions OQ-3）。

## Impact

- **后端**：
  - `backend/src/knowledge/hot-sources/`（**新增目录**）：多源适配器注册表，每个源一个适配器文件 + `index.ts` 注册表（现状 `backend/src/knowledge/hot.ts` 的 `fetchJson`/`normalizeHotTopics`/`normalizeSelected` 下沉为默认源适配器）
  - `backend/src/knowledge/hot.ts`：由「单源 + 两路 Promise.all」改为「注册表遍历 + 每源 `Promise.allSettled` 隔离」，聚合出每源状态与证据等级
  - `backend/src/knowledge/attention.ts`：关注域增加 `excludeKeywords` / `minKeywordHits`；新增 `sources[]` 与源权重；`matchDomains`/`classifyHot` 落实排除词、多词命中、来源分层
  - `backend/src/knowledge/refs.ts`：注入通道（`buildKnowledgeContext`）追加「外部环境情报」段；新增 `backend/src/knowledge/hot-refs.ts` 承载热点背景的存储与读取
  - `backend/src/routes/knowledge.ts`：`/api/hot`、`/api/hot/attention` 扩展；新增 `/api/tasks/:id/hot-refs`（GET/PUT）
  - `backend/src/knowledge/schema.ts`：新增独立表 `task_hot_refs`（**不改** `task_kb_refs`，遵守 §六.2 的字段隔离约定）
  - `backend/src/agents/smart-producer.ts`：`buildProducerSystemPrompt` 在其后追加热点段（**共享改动点**，与 T1 的 B2 打回意见注入共用；本 change 只追加，不改既有块顺序）
- **前端**：
  - `frontend/src/features/knowledge/HotView.tsx`：整体重做排版（药丸 / 信息条 / 序号 / 证据等级 / 双层内容 / 响应式多栏），**移除**「创建任务」按钮与 `toTask`
  - `frontend/src/App.tsx`：新建任务弹窗移除 `newTask.prefill` 的应用逻辑（预填态一并删除，避免留下无人写入的死状态）
  - `frontend/src/store/useWorkbench.tsx`：`openNewTask` 去掉 `prefill` 形参、`newTask.prefill` 字段与相关 state
  - `frontend/src/features/status/TaskDetailView.tsx`：新增「任务背景 · 外部环境情报」区块（手动关联/移除热点）
  - `frontend/src/lib/api.ts`：新增 `taskHotRefs` / `saveTaskHotRefs`
- **共享类型**：`packages/shared/src/knowledge.ts` 扩展 `HotItem`（证据等级 / 最新进展 / 来源 id / 来源分层）、`AttentionConfig`（`sources[]` / 排除词 / 多词命中阈值）、新增 `HotSourceStatus` / `HotSourceConfig` / `TaskHotRef` / `TaskHotRefInput`
- **配置**：`backend/config/attention.json`（本地、不入版本库）新增 `sources` 数组与关注域 `excludeKeywords` / `minKeywordHits`；旧配置缺项自动回退内置默认
- **数据/迁移**：新增 `task_hot_refs` 表（幂等 ensureSchema，首版建表即用，无既有数据迁移）；`knowledge_hot_cache` 缓存 key 由 `daily-hot` 扩展为带源集合版本号，旧缓存结构不兼容时直接作废重取（见 design.md Migration Plan）
- **外部依赖**：无新增运行时依赖；多源仅用原生 `fetch` + `AbortController`
- **不影响既有功能**：热点源全部失败时面板降级为 stale/unavailable，板块 A 与知识库其余能力照常；未关联热点背景的任务产出与既有完全一致

## 与其他 change 的关系

- **`knowledge-base`（未归档，保持活跃）**：本 change 是其 `daily-hot` capability 的**语义修订**，也是它的下游。修订仅限「热点」这一 capability；`knowledge-base` 的知识库索引/检索/星图/`workflow-context` 不受影响。因 `knowledge-base` 未归档，本 change 的 spec 采用 ADDED 表达（理由见上），**不修改 `openspec/changes/knowledge-base/` 下任何文件**。
- **`quality-loop`（T1，并行）**：`backend/src/agents/smart-producer.ts` 的 `buildProducerSystemPrompt` 是共享改动点（T1 的 B2 打回意见注入、本 change 的热点背景注入）。约定：T1 先改基础组装，本 change 只在其后**追加**热点段，不改既有块顺序与知识库段内容。
- **`knowledge-ux`（T2，并行）**：热点页空态文案（A5 清单中的「热点不可用 / 无热点」）与本 change 的排版重做落在同一文件 `HotView.tsx`。约定：以本 change 的降级三态结构为准，T2 只补文案。
- **`delivery-ops`（T4，并行）**：无交集（`task_kb_refs` 只读，本 change 新建 `task_hot_refs`）。
