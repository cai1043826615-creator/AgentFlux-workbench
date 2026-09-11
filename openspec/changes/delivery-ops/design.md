## Context

板块 A（多 Agent 电商工作台：`frontend/` + `backend/` + `packages/shared/`，Fastify + `node:sqlite` + WebSocket + Quiet Signal UI）已完成「新建 → 确认 → 6 阶段产出 → 3 个人工拍板点 → 归档」的真实链路。本 change 是 `docs/优化方向-2026-09-11-知识库与工作流.md` 的 **T4 · `delivery-ops`** 梯队，只依赖已完成的 `knowledge-base`，与 T1/T2/T3 无代码依赖，可完全并行。

落地前已核对代码现状，若干关键事实决定了下面的设计（均为**必须**据实处理，不是假设）：

1. `backend/src/delivery/store.ts` 的 `saveDeliverable` 在重复产出时执行 `UPDATE deliverables SET content = ? ... version = version + 1` —— **旧内容被原地覆盖**。doc 中「v1/v2 都在库里」并不成立，库里只有最新内容 + 一个自增的 `version` 数字。因此 B3 的差异对比**必须先补一层版本留档**，这是本 change 唯一需要新增表的地方。
2. `backend/src/routes/tasks.ts` 的 `GET /api/tasks` 无任何 query 参数，前端 `BoardView.tsx` 全量渲染 4 列。
3. 失效判定逻辑位于板块 B 的 `backend/src/knowledge/refs.ts`（`listTaskKbRefs` → `isDocAvailable`），单任务粒度；`task_kb_refs` 属板块 B 表域（`backend/src/knowledge/schema.ts`），`knowledge-base` design D1 明确规定**板块 A 代码不得读写板块 B 表**。
4. `backend/src/agents/llm.ts` 的 `callLlm` 只返回 `content` 字符串，**丢弃了渠道响应里的 `usage`**；`agent_executions`（`backend/src/db/ensure.ts`）无 token 列。`callLlm` 共 3 处调用点：`backend/src/agents/chat-reply.ts`、`backend/src/agents/smart-producer.ts`（2 处）。
5. `frontend/src/ws/broadcast.ts` 已有 `approval:prompt` 广播（payload 仅 `taskId` + `stage`，无标题）；前端 `useWorkbench.tsx` 已据此维护 `approvalQueue`，`components/Toast.tsx` 已消费它做页面内 Toast。
6. 仓库零 zip 依赖（`backend/package.json` 只有 fastify/ws/@fastify/websocket）；`docs/…` §0.4 明确「不引入重型运行时依赖」。
7. `frontend/src/store/useWorkbench.tsx` 的 `upsertTask` 在收到 `task:update` 广播时会用 `{...task, ownerName: '', stageLabel: task.stage}` 覆盖本地元字段 —— 既有行为下 WS 推送会清空 `ownerName`；新增的失效计数元字段必须显式保留，否则角标会随任一阶段推送闪失。

## Goals / Non-Goals

**Goals:**

- B3：交付物每次重新产出都留档，用户能对照相邻版本，**至少**看得出新增/删除了哪些卖点行
- B4：归档任务的交付包可下载为 ZIP，解压即得文案 + 全部**已采纳**图片原图，零新增运行时依赖
- B5：任务可按平台 / 负责人 / 时间 / 关键字筛选 + 排序（服务端单一口径），交付物可全局搜索并按内容定位到任务
- B6：失效关联资料在看板卡片 / 列表行 / 任务详情三处可见角标，且**不碰 `task_kb_refs` 表结构**、不越板块边界
- B8：设置面板能一键测渠道，红/绿 + 实测延迟 + **归属明确**的失败原因，测试不留痕（不污染 `agent_executions`、不改 Agent 状态）
- B9：任务进待确认时，页面不可见则发浏览器本地通知；未授权/不支持时静默降级不报错
- B12：任务级汇总（阶段耗时合计、执行次数、模型、token 实测/估算），只在有单价表时给估算费用
- 全流程不改板块 A 状态机语义、不改板块 B 表域与行为；既有看板 / 交付 / 审批 / 归档行为零回归

**Non-Goals:**

- 不做版本回滚/回退到历史版本（只做「留档 + 对比」，回滚涉及状态机语义，留待后续）
- 不做版本历史的全局搜索（B5 的交付物全局搜索只覆盖当前交付物，见 Open Questions）
- 不做交付物云端上传 / 对象存储 / 分享链接（B4 只做本地 ZIP 下载）
- 不做服务端推送通知（Web Push / 邮件 / 短信）；B9 明确为纯前端本地通知
- 不做真实计费对账、不做用量配额与告警；B12 的费用是**估算**，不是账单
- 不改 `task_kb_refs` 表结构，不为热点/知识库引入任何新的板块 B 表
- 不为单张图片做压缩/裁剪/水印（ZIP 内是原图字节）
- v1 不做**生图渠道**的健康检查（Agent 设置面板当前只有 LLM 渠道 UI，见 Open Questions）

## Decisions

### D1. 版本留档独立建表 `deliverable_versions`，而不是往 `deliverables` 塞历史 JSON

- **选择**：`backend/src/db/ensure.ts` 新增 `deliverable_versions(id, deliverable_id, task_id, stage, kind, version, content, status, created_at)`，`(deliverable_id, version)` 建唯一索引；`saveDeliverable` 在 UPDATE/INSERT 前先把**上一版**（`existing.content` + `existing.status` + `existing.version`）写入历史，首次产出写 v1，全部放在同一 `tx` 内保证不留档不覆盖。
- **理由**：`deliverables` 是热路径表，塞历史 JSON 会让每次读取交付物都反序列化全部历史，且 `listDeliverables` / `hasTaskKbRefs` 式调用会增加无谓开销；独立表可按 `(deliverable_id, version)` 精确取版本、便于索引与清理。
- **备选**：(a) `deliverables.history` JSON 列 —— 改动面最小但热路径变重、SQL 难查；(b) 每次产出插新行 + `is_latest` 标记 —— 会破坏既有 `getRow` 的「按 (task,stage,kind) 唯一定位」与全部审批读写路径，回归风险最高，否决。
- **边界**：只新增表，`deliverables` 的列、`version` 语义、`status` 状态机、逐张图片决策行为**一律不变**。

### D2. 版本历史只在「重新产出」时留档，决策状态变化不回写历史

- **选择**：留档触发点仅为 `saveDeliverable`（copy 产出 / image 产出）。`updateDeliverableStatus` 造成的 `status` 变化只改 `deliverables` 当前行，历史行保留产出时刻的 `status` 快照。
- **理由**：B3 要回答的是「这版内容比上版改了什么」；把每次逐张采纳/打回都算作新版本会让 `version` 语义爆炸（现在 `version` 就等于产出次数），并让差异视图充满无意义的「内容未变」版本。
- **代价**：历史上看不到「当时这张图是被采纳还是被打回」的完整轨迹 —— 该信息在 `task_events` / 交付物当前行可查，不必在版本表重复。

### D3. 既有交付物回填一条基线历史，并如实声明「本次上线前的中间版本不可恢复」

- **选择**：`ensureSchema()` 后执行幂等回填：对每个在 `deliverable_versions` 中缺失当前 `version` 记录的 `deliverables` 行，以其当前 `content` 写入一条 `version = deliverables.version` 的基线记录。
- **理由**：不回填会让既有任务打开差异视图时报「无历史」，体验断层；回填至少给出一个可用对比基点。
- **诚实声明（写入 Risks 与验收）**：回填内容是**当前最新内容**，不是真正的 v1；本次上线前已被覆盖的中间版本在物理上已丢失，无法恢复。因此 B3 的验收只针对「上线后新产生的重做」链路。

### D4. 差异计算用归一化文本对齐卖点行，不做语义/模糊匹配

- **选择**：`backend/src/delivery/diff.ts` 对 `CopyPackage.points` 做 `trim + 折叠空白` 归一化后按精确串相等求 差集/交集，得到 added / removed / kept；标题、`outline`、`keywords` 只做「是否变化 + 变化前后值」布尔/值对比；`image` 交付物按 `ImageItem.id` 集合求差集。
- **理由**：可确定性单测（spec 里「卖点顺序变化不算增删」这条 scenario 只有在归一化 + 集合比对下才成立）；不引 diff/相似度库（§0.4 约束）；用户诉求是「至少列出新增/删除的卖点行」。
- **备选**：字符级 diff / 编辑距离高亮 —— 词级差异信息量大但噪点多、实现与验收都更复杂，本轮不做。

### D5. ZIP 自实现（`node:zlib` deflate + 手写 CRC32），零新增依赖

- **选择**：`backend/src/delivery/package.ts` 手写 ZIP：本地文件头 + deflateRaw 数据 + 中央目录 + EOCD，文件名 UTF-8 且置 UTF-8 标志位，CRC32 用查表实现。
- **理由**：`archiver` / `jszip` / `yazl` 均需新增运行时依赖，违反 §0.4；ZIP 的 store/deflate 子集格式固定、实现量可控，且**可单测**（写出的 zip 用 `Expand-Archive` / `unzip` 真实解开校验）。
- **备选**：`store` 方式（不压缩）实现更短，但图片已压缩、文案文本不压缩会让包偏大；仍保留 fallback：若 deflate 失败则按 store 写该条目，保证包一定能生成。
- **边界**：打包只读 `deliverables`（文案取 `deliver` 阶段资料包，图片取 `status = 'approved'`），不写库、不改状态。ZIP 内命名：文案 `文案/{sanitizedTitle}.md`（人读）+ `文案/{sanitizedTitle}.json`（原始 `CopyPackage`），图片 `{阶段键}/{图片名}-{id前8}.{ext}`、重名追加后缀；**SVG 占位图视为「非最终成图」不入包**（写同名 `.txt` 降级并计入 `X-Deliverable-Missing`，实现回写，见验证记录偏差 #4/#5）。

### D6. 图片入包：dataURL 解码 + 站内 `/uploads` 走本地文件 + 外链 http 走 fetch，单张失败降级

- **选择**：`data:image/...;base64,` 直接 base64 解码；`/uploads/xxx.png` 读 `backend/data/uploads/` 下的对应文件（与 `routes/tasks.ts` 的 `UPLOAD_DIR` 同源）；`http(s)://` 用带超时的 `fetch` 取回并落盘到 zip。单张失败时写同目录同名 `.txt` 说明文件（含失败原因），并通过 `manifest.json` 与响应头 `X-Deliverable-Missing` 标注缺失数量。
- **理由**：三类来源在现有数据里都真实存在（`imagegen.ts` 可能返回 `data:image/png;base64,...` 或原始 `url`；参考图路径形如 `/uploads/<uuid>.png`）；「单张失败不整体失败」保证渠道运营至少拿到部分物料。
- **备选**：取不到就整体 500 —— 直接把「打包下载」变成不可靠功能，否决。

### D7. B6 的批量失效计数放在板块 B 侧，以只读函数暴露给板块 A

- **选择**：在 `backend/src/knowledge/refs.ts` 新增**只读**导出 `countKbRefsByTask(taskIds: number[]): Map<number, { total: number; invalid: number }>`（一条 SQL 取本次全部任务的 refs，再用既有 `isDocAvailable` 判定 + 文档可用性集合缓存）；`backend/src/routes/tasks.ts` 的 `GET /api/tasks` 调用它并把结果并到任务对象上。
- **理由**：`knowledge-base` design D1 要求「板块 A 代码不得读写板块 B 表」；`task_kb_refs` 的失效判定知识本就属于板块 B（依赖 Vault 配置与索引），放在板块 A 会形成跨域直连。
- **边界**：**只新增函数**，`task_kb_refs` 建表 SQL、既有函数签名与行为、板块 B 其它表一律不动；板块 B 抛错时 `GET /api/tasks` 捕获后计数归 0（降级，不阻塞板块 A）。
- **备选**：前端对每个任务调 `GET /api/tasks/:id/kb-refs` —— N 个任务 N 次请求，正是要避免的 N+1，否决。

### D8. B5 筛选与排序收敛到 `GET /api/tasks` 的 query 参数，交付物搜索独立端点

- **选择**：`GET /api/tasks` 支持 `platform` / `owner` / `from` / `to` / `q` / `sort`（`created` | `updated` | `progress`）/ `order`（`asc` | `desc`），服务端用参数化 SQL 拼接 `WHERE`；交付物搜索新增 `GET /api/deliverables/search?q=&limit=`，在 `deliverables` 上做 `LIKE` 匹配并对命中字段做片段截取。
- **理由**：筛选口径必须唯一，否则「看板页筛出来的数」和别处不一致；参数化 SQL 天然可测；`LIKE` 对本项目交付物体量足够（数百行 JSON），不值得引 FTS。
- **实现注意**：`updated` 排序需要「最近一次变动时间」，取 `tasks.created_at` 与 `deliverables.updated_at`/`task_events.created_at` 的较新者，用一个相关子查询实现；不复用板块 B 的 `knowledge_fts`（跨域）。
- **备选**：纯前端过滤 —— 与「任务一多翻不动」的初衷相悖，且无法测服务端口径，否决。

### D9. B9 通知的授权与降级：显式申请 + 页面不可见才发 + 显式开关

- **选择**：
  - 权限**不自动索取**（不在 `useEffect` 里调 `requestPermission`）：在 `frontend/src/App.tsx` 的 TopBar「任务」按钮附近提供「开启通知」入口，仅当 `Notification.permission === 'default'` 时显示，点击后申请；
  - 仅在 `Notification.permission === 'granted'` **且** `document.visibilityState === 'hidden'` **且**用户开关为开时发送；
  - 以 `` `${taskId}:${stage}` `` 为去重键，同一 (任务, 阶段) 只发一次；
  - 不支持 `Notification`（`typeof Notification === 'undefined'`）或授权被拒时**静默 return**，不 `throw`、不 `console.error`、不弹提示；
  - 开关状态存 `localStorage`（纯本地，不落库）。
- **理由**：Chrome 对非用户手势触发的 `requestPermission` 会直接忽略/降级，自动索取等于申请无效还打扰用户；「可见时不发通知」避免与 TopBar 角标 + Toast 三重打扰；把 `approval:prompt` 当唯一信源，**零服务端改动**（该广播已存在）。
- **备选**：(a) 页面加载即申请权限 —— 会被浏览器拦截且体验差；(b) 服务端 Web Push —— 需要 VAPID/订阅存储，与「纯本地、无需服务端」的明确要求冲突，否决。

### D10. B12 采集真实 usage，缺失时按字符估算并**显式标注**

- **选择**：`backend/src/agents/llm.ts` 的 `callLlm` 改为返回 `{ content, usage? }`（`LlmResult`），解析 `usage.prompt_tokens` / `usage.completion_tokens`；3 处调用点（`chat-reply.ts`、`smart-producer.ts` ×2）同步适配并向下透传到 `logExecution`；`agent_executions` 新增 `input_tokens` / `output_tokens` / `tokens_estimated`（幂等 `ALTER TABLE ... ADD COLUMN`，既有行默认 0，第三列为估算标记；实现回写，见验证记录偏差 #1）；`usage` 缺失时按 `Math.ceil(字符数 / 4)` 估算写入并把 `tokens_estimated` 置 1，汇总响应以 `tokensEstimated: true` 标注。
- **理由**：DeepSeek / OpenAI 兼容接口默认返回 `usage`，真实值可拿到；生图阶段不产生 LLM token（该阶段执行记录 token 为 0），口径必须写清避免把生图算进文本 token。
- **备选**：(a) 只估不算 —— 明明能拿真实值却报估算，浪费且不诚实；(b) 用 `tiktoken` 类库精确计数 —— 新增依赖且各家模型 tokenizer 不同，违反 §0.4，否决。

### D11. B12 用「本地默认单价表 + 设置覆盖」做估算，未覆盖的模型一律不给金额

- **选择**：单价来源两级——① **本地默认单价表**（配置文件落在 `backend/data/` 下，已被 `.gitignore` 覆盖，不入版本库；价目数值由开发期查渠道公开计价页填入）；② 设置项 `settings.modelPricing` 覆盖（沿用 `backend/src/agents/channel-settings.ts` 的 `getSetting` 读写），设置优先。逐模型命中才计费，未命中模型列入 `unpricedModels`；全部模型未命中 ⇒ `cost = null`。
- **理由**：用户已拍板「用单价表做估算」（doc §八.3）。但**价目是易变事实**，硬编码进源码会随上游调价过期、且无法解释来源，故把价目数据挪出源码：源码只含读取逻辑，数据在本地配置。源码零价目字面量用 grep 断言固化。同时保留「宁可少给数字，也不给错数字」的准则——`cost = null` 是「不知道」，`0 元` 是「不花钱」，两者语义完全不同。
- **备选**：① 源码内硬编码价目表 —— 随上游调价过期、无法解释来源、违反「源码零价目」，否决；② 只展示 token 不给金额 —— 用户明确要估算，否决；③ 引入 `tiktoken` 等库精确计数 —— 新增依赖且各家 tokenizer 不同，违反 §0.4，否决。

### D12. B8 健康检查用最小请求，且完全不落痕迹

- **选择**：`POST /api/agents/:id/channel-test` 复用 `callLlm` 的渠道选择顺序（面板 `llmChannels[id]` → 主管视觉渠道 → `.env` 默认），请求体 `max_tokens` 取最小可用值（≤ 16）、`temperature: 0`、固定 prompt（如「ping」）、超时 15s（明显短于正常调用 120s）；**不写 `agent_executions`、不调用 `markBusy`/`markIdle`、不写 settings**；错误按 `not_configured` / `auth_failed`(401/403) / `model_not_found`(404 或模型相关 400) / `connect_failed` / `timeout` / `upstream_error` / `agent_error` 分类，响应恒为 200 + `ok:false`。
- **理由**：写执行日志会让「测试一下」污染 `executionStats`（`backend/src/routes/agents.ts` 的 successRate / avgDurationMs），这与 B12 的汇总统计直接冲突；`ok:false` + 200 让前端无需区分 HTTP 错误分支即可渲染红/绿。
- **「区分配置问题与 Agent 问题」的落地**：`error.code` 属配置域时面板文案归因「渠道配置错误」；当健康检查成功但该 Agent 近期存在 `agent_executions.status = 'failed'` 时，面板文案提示「渠道正常，失败原因在 Agent 侧」——后者需要一次轻量查询（复用 `executionStats` 的失败计数，不新增表）。
- **备选**：在设置面板里用真实产物跑一次（如生成一张图）验证 —— 慢、花钱、可能改状态，否决。

## Risks / Trade-offs

- **[B3 回填的基线不是真 v1]**：上线前被 `saveDeliverable` 覆盖掉的中间版本物理上已丢失，回填只能写入「当前内容」作为对比基点 → 在 tasks 验收里明确只验「上线后新产生的重做」，并在 UI 文案上不承诺「可回溯任意历史版本」。
- **[版本表无限增长]**：每次重做留一行，长跑任务可能积累数十版 → 每个交付物只保留最近 N 版（默认 20）并在超出时删除最旧记录；N 作为常量集中定义，便于调整。
- **[ZIP 手写实现有格式风险]**：CRC32 / 中央目录偏移算错会导致部分解压器打不开 → 必须用真实解压工具（`Expand-Archive` 或 `unzip -t`）做验收断言，而不是只断言「接口返回 200 且有字节」。
- **[大包内存占用]**：图片为 base64 dataURL，一次打包可能几十 MB → 全流程在内存组装 Buffer（当前单任务图片量级为个位数 MB，可接受）；若后续要支持大包，需改成流式写临时文件（记为后续优化，不在本 change 范围）。
- **[外链图片取不回]**：`http(s)` 图片可能超时/失效 → 单张降级为 `.txt` 说明 + `manifest.json` 标注缺失，不让整包失败。
- **[B6 批量聚合的 Vault 判定开销]**：`isDocAvailable` 会走索引查询并可能落到文件系统 `vaultFileExists` → 在批量函数内对本次涉及的 `doc_path` 做一次集合判定（同一文档只判一次）+ 文档可用性缓存，避免 N 个任务 × M 份资料的重复 I/O。
- **[B6 角标被 WS 推送冲掉]**：`useWorkbench.upsertTask` 会用广播体覆盖本地元字段（既有行为已导致 `ownerName` 被清空）→ 合并时对推送体缺失的 `ownerName` / `kbRefsTotal` / `kbRefsInvalid` 显式保留旧值；这条要在验收里用「阶段推进后角标仍在」的浏览器检查确认。
- **[B5 `updated` 排序口径模糊]**：`tasks` 表无 `updated_at` 列 → 用 `deliverables.updated_at` 与 `task_events.created_at` 的相关子查询取较新者；若任务既无交付物也无事件，则回退 `created_at`。口径写进 spec/tasks 以免实现漂移。
- **[B12 改 `callLlm` 返回类型是跨文件改动]**：3 处调用点必须同步适配，否则 typecheck 直接失败 → 该条任务单独成组、先改签名再改调用点，用 `pnpm -r typecheck` 作为即时验证。
- **[B12 估算 token 被误读为账单]**：所有展示路径必须带「估算」字样 → spec 里以 scenario 固化（`tokensEstimated = true` 时文案必须含「估算」），验收时用浏览器检查断言页面上出现该字样。
- **[B8 健康检查可能被当成真实用量统计]**：测试请求不落库，因此 ObservabilityView 看不到它 → 这是有意为之（spec 已固化为 scenario）；需在面板文案上写明「测试不写入执行记录」以免用户困惑。
- **[B9 通知在部分环境不可用]**：HTTP（非 localhost）下 `Notification` 可能被浏览器禁用 → 静默降级是硬要求；验收必须包含「未授权/禁用时不报错」这一条（含 `console` 无 error）。

## Migration Plan

- **建表/加列（幂等，沿用既有 `ensureSchema` 模式）**：
  - 新增表 `deliverable_versions`（含 `(deliverable_id, version)` 唯一索引、`task_id` 索引）
  - `agent_executions` 新增列 `input_tokens INTEGER NOT NULL DEFAULT 0`、`output_tokens INTEGER NOT NULL DEFAULT 0`、`tokens_estimated INTEGER NOT NULL DEFAULT 0`（`ALTER TABLE ... ADD COLUMN` 包 try/catch，与 `tasks.reference_image` / `tasks.archived` 既有迁移写法一致；第三列为实现期追加，见验证记录偏差 #1）
  - `backend/src/db/schema.ts` 同步补行类型字段
- **数据回填**：启动时对缺失当前版本记录的 `deliverables` 行写一条基线历史（见 D3）；幂等，重复启动不重复插入。token 列既有行为 0（不回填、不臆造历史 token）。
- **无破坏性变更**：不删列、不改列语义、不改状态机；`task_kb_refs` 与板块 B 全部表结构零改动。
- **回滚**：本 change 的全部产物都在板块 A 域内且是「新增」——回滚代码即可，多余的表/列对旧代码无影响（旧代码不读它们）；如需彻底回退，删除 `deliverable_versions` 表并忽略两个 token 列即可，SQLite 单文件可直接备份恢复（`backend/data/workbench.db.ts`）。
- **发布顺序建议**：先合 D10（`callLlm` 签名 + 加列 + 3 处调用点适配），再合 B12 汇总与卡片 —— 这样 token 数据从合入起开始积累，避免先上卡片却没有数据。

## Open Questions

1. ~~**B9 是否同时做页面标题闪烁？**~~（**已拍板，2026-09-11：要，两者同时做**）落地要求：浏览器 Notification 推送为主路径；在**降级路径**（通知未授权 / 浏览器不支持 / 用户关闭开关）追加 `document.title` 交替闪烁，并在用户聚焦窗口（`visibilitychange` / `focus`）时**立即复位**标题，避免长期污染标题栏。开关状态持久化到本地。对应 tasks 见第 12 组（通知与标题闪烁同组，各自独立验收）。
2. ~~**B12 是否有可用的单价表？**~~（**已拍板，2026-09-11：用可配置单价表做估算**）落地要求：内置一份**默认单价表**（DeepSeek 与生图渠道），单价数值由**开发期查公开计价页填入**；单价表写在本地配置（`backend/data/` 已被 `.gitignore` 覆盖），**源码内不得出现价目字面量**（用 grep 断言）；`settings.modelPricing` 存在时以设置为准。**若某渠道定价不公开**（用户已确认的处理方式）→ 该模型**不进默认单价表**，其费用退化为**只展示 token 数与耗时、不给金额**；仍保留「未命中单价的模型列入 `unpricedModels`、全未命中则 `cost = null`」的既有设计，避免给出错数字。
3. **B5 交付物全局搜索是否需要覆盖历史版本？**当前 spec 只搜「当前交付物」（`deliverables` 行）。B3 引入 `deliverable_versions` 后，历史版本里的卖点同样可搜是有价值的（用户常记得「我上一版写过 XX」）。若需要，扩成「命中历史版本时在结果中标注 `v1`」——需要你确认是否纳入本次范围。
4. **B8 是否需要同时测生图渠道？**当前 `AgentSettingsModal.tsx` 只有 LLM 渠道（`settings.llmChannels[agentId]`）的 UI，`settings.imageChannel` 没有面板入口。本 change 只做 LLM 渠道健康检查。若要连生图一起加，需要先在设置面板补生图渠道 UI（超出 T4 条目描述的范围）。
5. ~~**B3 版本保留策略**~~（**已落地，2026-09-11：默认每交付物只保留最近 20 版**）`MAX_VERSIONS_PER_DELIVERABLE = 20` 常量集中定义，超出裁剪最旧；不做按天保留与可配置化（偏差表 #11）。
6. ~~**B4 交付包内的文案格式**~~（**已落地，2026-09-11：同时给 `文案.md` 与 `文案.json`**）按默认实现（`.md` 人读 + `.json` 机读原始 `CopyPackage`），见验证记录偏差 #4。
