## Why

板块 A（多 Agent 工作流）已能跑通「新建 → 确认 → 各阶段产出 → 拍板 → 归档」，但**交付闭环与运营效率**仍是短板，渠道运营与用户在日常使用中反复撞到 7 个具体问题：

- **B3 看不出改了什么**：文案被打回重做后，`deliverables.version` 会从 v1 递增到 v2，但 `saveDeliverable` 是**原地 UPDATE**（`backend/src/delivery/store.ts`），旧内容被直接覆盖——库里其实**没有** v1 正文，用户无法对照「这版比上版增删了哪些卖点」。
- **B4 拿不到物料**：`deliver` 阶段只落一条「上架资料包已完成」的描述型 copy 交付物，渠道运营需要的是**可下载的 zip**（文案 + 全部已采纳图片原图）。
- **B5 任务翻不动**：`BoardView.tsx` 是固定 4 列看板，没有搜索/筛选/排序；任务一多只能肉眼翻。交付物更是完全没有全局检索入口。
- **B6 失效告警看不到**：`GET /api/tasks/:id/kb-refs` 已返回 `valid: false`（`backend/src/knowledge/refs.ts`），但只有进任务详情才看得见，看板卡片上毫无提示。
- **B8 分不清谁的错**：apiKey 填错时只在 `agent_executions.error` 里出现一行 `LLM HTTP 401`，用户分不清是**渠道配置错**还是 **Agent 有问题**；设置面板里没有可主动触发的「测试渠道」。
- **B9 待确认会漏**：任务进待确认只有 TopBar 角标 + 页面内 Toast（`frontend/src/components/Toast.tsx`），用户切走浏览器就完全错过。
- **B12 没有任务级账单**：`agent_executions` 已有每次执行的 `duration_ms`/`model`，但任务详情没有任何汇总，无法回答「这个任务花了多久、用了哪个模型、大概花了多少钱」。

## What Changes

- **B3 交付物版本对比**：新增交付物版本历史表 `deliverable_versions`，`saveDeliverable` 在**覆盖前**把上一版内容留档（版本号与 `deliverables.version` 对齐）；新增相邻版本差异计算（文案至少列出**新增/删除/保留的卖点行**，并标注标题/大纲/关键词变化；图片交付物列出新增/删除的图片条目）；内容交付页提供版本切换与差异对照视图。
- **B4 交付包打包下载**：新增 `GET /api/tasks/:id/deliverable-package`，流式返回 zip（文案 Markdown/JSON + **全部已采纳**图片原图，含 dataURL 与 http URL 两种来源）；归档任务在看板/任务详情提供「下载交付包」入口。零新增运行时依赖：用 `node:zlib` + 手写 CRC32 组装 ZIP。
- **B5 任务列表视图 + 检索**：看板页新增「看板 / 列表」视图切换（同一数据源），列表视图按 **平台 / 负责人 / 时间 / 关键字** 筛选 + 排序；`GET /api/tasks` 支持对应 query 参数（服务端单一筛选口径）；新增 `GET /api/deliverables/search?q=` 交付物全局搜索（命中文案标题/卖点/关键词与图片名称，返回任务 id、阶段、版本与命中片段，可跳转任务）。
- **B6 关联资料失效告警**：`GET /api/tasks` 每条任务附带 `kbRefsTotal` / `kbRefsInvalid`（由板块 B 侧新增的**只读**批量聚合函数产出，板块 A 不直连板块 B 表）；看板卡片、任务列表行、任务详情头部展示「N 份关联资料已失效」角标并可跳转。**`task_kb_refs` 表结构与其既有读写行为完全不变**。
- **B8 渠道健康检查**：新增 `POST /api/agents/:id/channel-test`，用该 Agent 的生效渠道发一次**最小请求**（短 prompt + 最小 `max_tokens`），返回 `{ ok, latencyMs, model, baseUrlHost, error, recentFailedRuns? }`（`model`/`baseUrlHost` 在未发起请求时为 `null`）；设置面板加「测试渠道」按钮，展示红/绿 + 延迟 + **区分「渠道配置错误」与「Agent 问题」**的失败原因；健康检查不写 `agent_executions`、不改 Agent 在线状态、不回显 apiKey。
- **B9 待确认浏览器通知**：前端在 WS 收到 `approval:prompt` 且页面不可见时，通过浏览器 `Notification` 推送一条本地通知（纯前端，无需服务端改动，复用既有 `approval:prompt` 广播）；**未授权/不支持时静默降级不报错**，页面角标照常；同一 (任务, 阶段) 只通知一次。
- **B12 任务级成本/耗时统计**：`agent_executions` 新增 `input_tokens` / `output_tokens` / `tokens_estimated` 三列（幂等 `ALTER TABLE`，第三列为估算标记，见验证记录偏差 #1），`callLlm` 回传渠道 `usage`（未回传时按字符数估算并标记 `estimated`）；新增 `GET /api/tasks/:id/cost` 聚合阶段耗时、执行次数、涉及模型与 token；**仅当配置了单价表**（`settings.modelPricing`）才计算估算费用，否则只展示 token 数与耗时；任务详情新增汇总卡片。

## Capabilities

### New Capabilities

- `deliverable-package`: 交付物版本历史留档、相邻版本差异对比（卖点行增删）、交付包 ZIP 打包下载（文案 + 已采纳图片原图）
- `task-explorer`: 任务列表视图与多维筛选/排序（平台 / 负责人 / 时间 / 关键字），以及跨任务的交付物全局搜索
- `task-alerts`: 关联资料失效的聚合计数与看板/详情角标告警，以及待确认任务的浏览器本地通知（含未授权静默降级）
- `channel-health`: 渠道健康检查端点与设置面板「测试渠道」（红/绿 + 延迟 + 失败原因归属），不污染执行统计
- `task-cost`: 任务级执行聚合（阶段耗时合计、执行次数、模型、token 实测/估算）与可选的费用估算

### Modified Capabilities

- **无**：本 change 的 7 个条目全部是对板块 A 的**新增**能力，不改动任何既有 spec 的语义——B6 对 `task_kb_refs` 只读复用、B9 复用既有 WS `approval:prompt` 广播、B12 只新增列而不改 `agent_executions` 既有列语义、B3/B4 不改变 `deliverables` 既有字段与状态机行为。因此 5 个 spec 全部使用 `## ADDED Requirements`，不使用 `## MODIFIED Requirements`（主 `openspec/specs/` 当前为空，MODIFIED 也无既有需求可参照）。

## Impact

- **后端（板块 A）**：
  - `backend/src/db/ensure.ts`：新增 `deliverable_versions` 表与 `agent_executions.input_tokens/output_tokens/tokens_estimated` 幂等迁移；`backend/src/db/schema.ts` 补行类型
  - `backend/src/delivery/store.ts`：产出前留档 + 版本历史读取；新增 `backend/src/delivery/versions.ts`（历史读写与回填）、`backend/src/delivery/diff.ts`（版本差异）、`backend/src/delivery/package.ts`（ZIP 组装）
  - `backend/src/routes/tasks.ts`：`GET /api/tasks` 扩展 query（筛选/排序/聚合计数）、新增 `GET /api/tasks/:id/deliverable-package`、`GET /api/tasks/:id/cost`、`GET /api/deliverables/search`
  - `backend/src/routes/agents.ts`：新增 `POST /api/agents/:id/channel-test`
  - `backend/src/agents/llm.ts`：`callLlm` 回传 `usage`；`backend/src/agents/execution-logger.ts` 记录 token；`backend/src/engine/service.ts` 透传 token
- **后端（板块 B，仅新增只读导出）**：`backend/src/knowledge/refs.ts` 新增只读批量聚合 `countKbRefsByTask(taskIds)`，**不修改 `task_kb_refs` 表结构与既有函数行为**；板块 A 不直接读写板块 B 任何表
- **前端**：`frontend/src/features/board/`（列表视图 + 筛选栏 + 失效角标）、`frontend/src/features/content/`（版本切换与差异对照、交付包下载）、`frontend/src/features/status/TaskDetailView.tsx`（成本汇总卡片 + 角标）、`frontend/src/features/workstation/AgentSettingsModal.tsx`（测试渠道）、`frontend/src/store/useWorkbench.tsx`（筛选状态、通知订阅、元字段合并）、`frontend/src/lib/api.ts`（新端点封装）、`frontend/src/App.tsx`（通知授权入口）
- **共享类型**：`@workbench/shared` 新增 `DeliverableVersion` / `DeliverableDiff` / `TaskCostSummary` / `ChannelTestResult` / 任务筛选参数与交付物搜索命中类型
- **外部依赖**：**零新增**。ZIP 用 `node:zlib` + 自写 CRC32；通知用浏览器原生 `Notification`；筛选/搜索用 `node:sqlite` 的 SQL
- **不影响既有功能**：看板 4 列渲染与归档语义不变；`deliverables` 既有字段/状态机/逐张审批行为不变；`agent_executions` 既有列与 ObservabilityView 行为不变；知识库未连接时 B6 计数降级为 0、B9 只依赖本地 WS，均不阻塞板块 A
