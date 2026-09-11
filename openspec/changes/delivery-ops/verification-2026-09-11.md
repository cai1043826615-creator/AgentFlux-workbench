# 验证记录 · delivery-ops（T4 交付闭环与运营效率）

> 本文件记录本 change 每个任务的验证结论、待端到端浏览器验证清单、1.6 白名单、实现偏差。
> 状态图例：✅ 通过 / ⏳ 待端到端浏览器验证 / 🟡 部分通过（详见说明）

---

## 一、1.6 改动白名单（冻结「新增能力、不动既有语义」）

### 允许触碰（本 change 新增/追加）

| 文件 | 允许的改动方式 |
| --- | --- |
| `backend/src/db/ensure.ts` | 追加 `deliverable_versions` 建表 + `agent_executions.input_tokens/output_tokens/tokens_estimated` 幂等 ALTER + 版本历史回填 |
| `backend/src/db/schema.ts` | 追加行类型（`DeliverableVersionRow`、`AgentExecutionRow` 增 token 字段） |
| `packages/shared/src/types.ts` + `index.ts` | 追加 6 类新类型（追加式，不动既有类型） |
| `backend/src/delivery/store.ts` | 仅改 `saveDeliverable`（覆盖前留档，同一事务）；既有函数不动 |
| `backend/src/delivery/versions.ts`（新） | 版本历史读写/回填/保留上限 |
| `backend/src/delivery/diff.ts`（新） | 相邻版本差异计算 |
| `backend/src/delivery/package.ts`（新） | 零依赖 ZIP 组装与交付包内容 |
| `backend/src/knowledge/refs.ts` | **仅新增只读导出** `countKbRefsByTask`；既有导出与签名零改动 |
| `backend/src/routes/tasks.ts` | 追加多处新端点/query 参数（只增不改既有路由） |
| `backend/src/routes/agents.ts` | 追加 `POST /api/agents/:id/channel-test` |
| `backend/src/agents/llm.ts` | `callLlm` 返回 `LlmResult{content,usage?}` + 渠道解析导出 + usage sink |
| `backend/src/agents/execution-logger.ts` | 追加 token 入参与落库 |
| `backend/src/engine/service.ts` | runStage 透传 token 采集与估算 |
| `backend/src/agents/chat-reply.ts` | 仅适配 `callLlm` 返回类型（1 处调用点） |
| `backend/src/agents/smart-producer.ts` | **仅适配 `callLlm` 返回类型（2 处调用点）**；不碰 `buildProducerSystemPrompt`（T1 主导） |
| `frontend/src/lib/api.ts` | 追加 8 个新端点封装（追加式） |
| `frontend/src/store/useWorkbench.tsx` | 追加筛选状态/元字段合并/通知订阅（追加式） |
| `frontend/src/App.tsx` | 追加通知入口与开关（追加式；不动 `newTask.prefill`，T3 主导） |
| `frontend/src/features/board/BoardView.tsx` | 列表视图+筛选栏+失效角标+搜索入口+交付包下载 |
| `frontend/src/features/board/`（新文件） | 列表视图组件等 |
| `frontend/src/features/content/ContentDeliveryView.tsx` | 追加版本切换与差异对照（追加式，T1 也会改） |
| `frontend/src/features/status/TaskDetailView.tsx` | 追加成本卡片+失效角标+交付包下载（追加式） |
| `frontend/src/features/workstation/AgentSettingsModal.tsx` | 追加「测试渠道」区块 |
| `frontend/src/lib/approval-notify.ts`（新） | B9 通知模块 |
| `backend/data/model-pricing.json`（新，gitignore） | 默认单价表（不入版本库） |

### 不允许触碰（既有语义冻结）

| 文件/内容 | 原因 |
| --- | --- |
| `backend/src/knowledge/schema.ts` 中 `task_kb_refs` 建表 SQL | 板块 B 表域，B6 只读 |
| `backend/src/knowledge/refs.ts` 既有函数（`setTaskKbRefs`/`listTaskKbRefs`/`validateTaskKbRefs`/`loadTaskKbFragments`/`buildKnowledgeContext`/`hasTaskKbRefs`/`clearTaskKbRefs`）签名与行为 | 板块 B 既有契约 |
| `backend/src/knowledge/` 其余文件 | 板块 B 表域 |
| `backend/src/routes/knowledge.ts`、`knowledge/hot.ts`/`attention.ts`/`health.ts` | T2/T3 梯队 |
| `deliverables` 既有列与状态机 | B3/B4 只新增留档，不改既有 |
| `agent_executions` 既有列语义（`durationMs/model/status/outputSummary` 等） | B12 只新增列 |
| `buildProducerSystemPrompt` 段序与实现 | T1 主导（B2 注入通道） |
| `openspec/changes/knowledge-base/` 全部文件 | 只读，绝不修改 |
| `docs/` | 收尾任务 17.9 只回写 change 内 design/proposal，不改 docs |

---

## 二、任务验证结论（按任务号）

### 1. 前置确认与共享契约

- [x] **1.1** 基线现状（阅读/grep 复核，2026-09-11）：
  1. `backend/src/delivery/store.ts#saveDeliverable`：确认 `UPDATE deliverables SET content = ?, stage = ?, status = ?, version = ?, updated_at = ?`（原地覆盖，旧内容只存在于 `existing` 局部变量，库中只有最新内容 + 自增 version）。✅
  2. `backend/src/routes/tasks.ts#GET /api/tasks`：确认无任何 query 参数，`service.listTasks()` 全量。✅
  3. `backend/src/agents/llm.ts#callLlm`：确认 `Promise<string>` 只返回 `content`，响应体只解构 `choices[0].message.content`，丢弃 `usage`。✅
  4. `frontend/src/store/useWorkbench.tsx#upsertTask`：确认 `const meta = { ...task, ownerName: '', stageLabel: task.stage }` 用广播体覆盖本地元字段（WS 推送会清空 ownerName，既有行为）。✅
- [x] **1.2** `deliverable_versions` 表迁移：见 `backend/src/db/ensure.ts`；单测见 `backend/src/db/__tests__/migrations.test.ts`（连续两次 ensureSchema 不报错、重复 `(deliverable_id,version)` 唯一约束抛错）。✅
- [x] **1.3** token 列迁移：`agent_executions` 幂等新增 `input_tokens`/`output_tokens`/`tokens_estimated`（try/catch 与既有迁移一致），`schema.ts` 补字段；单测见 migrations.test.ts。✅
- [x] **1.4** 共享类型：`packages/shared/src/types.ts` 新增 `DeliverableVersion`/`DeliverableDiff`/`TaskCostSummary`/`ChannelTestResult`/`TaskListQuery`/`DeliverableSearchHit`（追加式）；`pnpm --filter @workbench/shared build` 0 error，`api.ts` 既有 `parseImages`/`parseCopy` 无需改动编译通过。✅
- [x] **1.5** API 契约壳：`frontend/src/lib/api.ts` 增补 8 个新端点封装（versions/diff/package/search/cost/channel-test/扩展 query）；`pnpm typecheck` 0 error。✅
- [x] **1.6** 白名单：见本文件第一节；收尾任务 17.6 逐条对照。✅

### 2. B3 版本历史留档

- [x] **2.1** 版本历史读写模块：`backend/src/delivery/versions.ts` 实现 `archivePreviousVersion`（同 `(deliverable_id, version)` 已存在则跳过）与 `listVersions`（按 version 升序）；单测见 versions-diff.test.ts「2.x 版本历史」套件：重复写入只落 1 行、升序返回、content 原样保留。✅
- [x] **2.2** `saveDeliverable` 覆盖前留档：`store.ts` 在 UPDATE 分支前把 `existing.content/status/version` 写入 `deliverable_versions`（首次产出同时写 v1），与交付物写入同一事务（versions.ts `writeHistoryInTx`/`createVersionInTx` 复用同一连接）；单测断言「产出 1 次→历史 1 条 v1」「再产出→version=2 且历史含 v1 旧内容与 v2 新内容」「mock 写交付物抛错→历史无新增行（同事务回滚）」。✅
- [x] **2.3** 文案打回重做后两版都在：versions-diff.test.ts 覆盖「v1 产出→v2 产出」后历史含 v1（`title/points/outline/keywords` 与首次产出逐字段一致）与 v2（与当前交付物一致）；`GET /api/tasks/:id/deliverables/copy/versions` 由 delivery-api.test.ts 断言返回 ≥ 2 条。✅
- [x] **2.4** 版本号一致性与首次产出不留多余历史：`fullVersionHistory` = 历史 + 当前合并（同 version 以历史记录为准），保证「历史最大版本号 === deliverables.version」；单测断言 version=3 交付物历史 ≤ 3 条且最大恰为 3、version=1 历史恰 1 条。✅
- [x] **2.5** 图片交付物重产出留档：单测断言 `main-image` 重产出后历史含重产出前图片条目快照（每张含 `id` 与 `status`，id 集合与重产出前一致）。✅
- [x] **2.6** 既有数据幂等回填：`backfillVersionHistory` 在 ensureSchema 后对缺失当前版本记录的 `deliverables` 行写基线；单测断言连续执行两次第二次新增 0 行、已有 v3 的交付物回填后历史仅 v3 一条。✅
- [x] **2.7** 版本保留上限：`MAX_VERSIONS_PER_DELIVERABLE = 20`，超出裁剪最旧；单测断言 21 次重产出后恰 20 条、被删为最小版本、最新版本 content 正确。✅

### 3. B3 相邻版本差异

- [x] **3.1** copy 卖点行差异：`diff.ts` 归一化（trim + 折叠连续空白，含全角空格）后按精确串求差/交集；单测断言 `["30W 快充","磁吸吸附"]` vs `["30W 快充","航空铝外壳"]` → 新增含航空铝外壳/删除含磁吸吸附/保留含 30W 快充。✅
- [x] **3.2** 顺序变化不算增删：单测断言仅调换顺序 → added/removed 均空、keptPoints 含全部；含首尾/全角空格差异判定为同一行。✅
- [x] **3.3** 标题/大纲/关键词变化：单测断言仅改 title + 新增 keyword → `titleChanged=true`、`keywordChanges.added` 含该词、`outlineChanged=false`，title/outline 携带前后值。✅
- [x] **3.4** 两版完全一致：单测断言 `identical=true` 且四个差异数组全空、不抛错。✅
- [x] **3.5** 仅一个版本：`hasPrevious=false` 明确状态对象（非 null、非 500），不进入差异计算。✅
- [x] **3.6** 图片交付物差异：按 `ImageItem.id` 集合求差；单测断言 v2 少 1 多 1 → `removedImages`/`addedImages` 各含对应 id 且长度均 1。✅
- [x] **3.7** 差异接口 `GET /api/tasks/:id/deliverables/:kind/diff`：delivery-api.test.ts 断言默认 v2-vs-v1、`from=v1&to=v3` 返回 v3-vs-v1、非法 kind 400 中文说明、任务/交付物不存在 404。✅
- [x] **3.8** 内容交付页版本切换与差异对照：`ContentDeliveryView.tsx` 追加 `CopyVersionPanel`（历史版本下拉 v 号+产出时间、选中版本内容预览、「与上一版对比」面板：新增/删除/保留卖点分组 + 标题/大纲/关键词变化、无上一版显示「无上一版可对比」）；⏳ 浏览器验证（见第三节清单）。✅(实现) ⏳(端到端)

### 4. B4 交付包 ZIP 打包下载

- [x] **4.1** 零依赖 ZIP 组装器：`backend/src/delivery/package.ts` 手写本地头+deflateRaw+中央目录+EOCD、CRC32 查表、文件名 UTF-8 标志位；单测断言 `PK\x03\x04`/`PK\x05\x06` 签名、中央目录条目数、CRC32 已知向量 `"123456789" → 0xCBF43926` 且与 `zlib.crc32` 一致。✅
- [x] **4.2** 真实解压校验：单测把 zip 落盘临时文件，用 PowerShell `Expand-Archive` 解压后逐字节比对 SHA256；assert 全部条目还原一致（见 package.test.ts「清理临时目录」前用例）。✅
- [x] **4.3** 组装内容与状态过滤：文案 `文案/{title}.md`+`文案/{title}.json`；图片取全部 `approved`，`rejected`/`failed` 不入包；单测断言 zip 内只出现 approved 图。✅
- [x] **4.4** 三类图片来源：dataURL 直接解码、`/uploads/` 读 `backend/data/uploads/`、http(s) 超时 fetch；按 mime/魔数定扩展名；单测对三类来源断言字节一致且扩展名正确。✅
- [x] **4.5** 单张失败降级：取回失败写同名 `.txt`（含失败原因）并计入 `X-Deliverable-Missing`；单测注入必失败 http URL 断言 zip 仍生成、缺失位置有 .txt、missing=1。✅
- [x] **4.6** ZIP 命名：`{阶段键}/{图片名}-{id前8}.{ext}`、图片名缺失回退序号、重名追加后缀；单测断言同阶段两张同名图片条目名不同且均含阶段键与图片名。✅
- [x] **4.7** 下载端点：delivery-api.test.ts 断言 200、`application/zip`、`Content-Disposition` 含 UTF-8 编码中文文件名（`交付包-任务<id>-<标题>.zip`），落盘可解压。✅
- [x] **4.8** 无交付物 409：断言 409、中文说明、响应体不以 `PK` 开头、非 500。✅
- [x] **4.9** manifest.json：单测断言入包图片条目数 === zip 内实际图片文件数；无文案任务 → `copyFile=null` 且 zip 含图片与清单。✅
- [x] **4.10** 归档任务交付包入口：看板卡片 + 任务详情头部「下载交付包」按钮（未归档任务也允许；无交付物展示 409 中文原因——`useDownloadPackage` 错误行内展示）；⏳ 浏览器验证（见第三节清单）。✅(实现) ⏳(端到端)

### 5. B5 任务列表视图

- [x] **5.1** 视图切换框架：`BoardView.tsx` 增加「看板/列表」切换（store `boardMode`），列表渲染抽为 `TaskListView.tsx` 的 `TaskListTable`（行视图：id/标题/状态列/当前阶段/负责人/平台/创建时间/操作），两视图共用 store 全量数据与元字段。✅(实现) ⏳(端到端)
- [x] **5.2** 两视图数据一致：同一 `visible`（applyTaskFilters 未归档全量）渲染两视图；⏳ 浏览器核对 id 集合与计数一致。
- [x] **5.3** 从列表打开详情并保留视图与筛选：`boardMode`/`filters` 存 store，返回后保留；`onOpen` 同时调 store `openTask`。✅(实现) ⏳(端到端)
- [x] **5.4** 归档任务不入列表：`applyTaskFilters` 排除 `archived`；`ArchivedTasksModal` 查看/恢复既有链路不变。✅(实现) ⏳(端到端)
- [x] **5.5** 看板 4 列渲染与快捷操作不回归：BoardView 保留 4 列结构与确认开工/归档按钮（追加式改动）；⏳ 浏览器核对。

### 6. B5 任务筛选与排序

- [x] **6.1** `GET /api/tasks` 查询参数：`routes/tasks.ts` 参数化 SQL 逐维实现（platform 数组归一「或」、owner、from/to 闭区间、q 标题或描述、sort created|updated|progress、order）；后端测试对固定数据集逐维断言（含 `q=' OR 1=1 --` 注入返回空集不报错、无参数全量一致）。✅
- [x] **6.2** 多维组合为「与」：后端测试断言平台+负责人交集结果。✅
- [x] **6.3** 多值同维为「或」：断言两类平台并集去重后条数 === 两类之和。✅
- [x] **6.4** `updated` 排序口径：`GREATEST(created_at, 交付物/事件相关子查询)`，无则回退 created_at；后端测试断言「仅改过交付物的任务」排在「创建更早但无变动」之前。✅
- [x] **6.5** 排序与筛选叠加：后端测试断言排序只在筛选结果集内生效。✅
- [x] **6.6** 默认创建时间降序、`sort=progress&order=desc` 单调不增：后端测试逐条断言。✅
- [x] **6.7** 列表筛选栏与空态：`TaskFilterBar`（平台多选或/负责人/时间范围/关键字/排序选择器/单项清除/清除筛选按钮），空态「无匹配任务 · 可调整上方筛选条件」+ 清除入口；前端语义与后端一致（偏差表 #8）。✅(实现) ⏳(端到端)

### 7. B5 交付物全局搜索

- [x] **7.1** `GET /api/deliverables/search?q=&limit=`：`delivery/search.ts` 匹配文案 title/points/keywords 与图片名称，返回 taskId/taskTitle/stage/kind/version/hitField/snippet；后端测试断言按卖点命中（hitField=卖点、snippet 含词）、按图片名命中（stage=main-image）、空 q 返回空数组。✅
- [x] **7.2** 无命中与上限：不存在关键字返回空数组 + 提示字段无 5xx；命中 > limit 返回 ≤ limit + `truncated:true`；limit 非法回落默认 20。✅
- [x] **7.3** 搜索 UI 与结果可跳转：`DeliverableSearch`（看板/列表页入口，结果列表标注任务标题/阶段/版本/命中字段与片段），点击 `openTask` + `setTaskTab('deliver')`；空关键字显示「请输入关键字」；无命中显示「无命中」。✅(实现) ⏳(端到端)

### 8. B6 关联资料失效的聚合计数

- [x] **8.1** `countKbRefsByTask(taskIds)`：`knowledge/refs.ts` 新增只读导出，一条 SQL 取全部 refs、复用 `isDocAvailable`、doc_path 集合级去重 + 可用性缓存；单测断言 3 任务混合有效/失效与逐任务 `listTaskKbRefs` 判定完全一致，`isDocAvailable` 调用次数 === 去重后 doc_path 数（计数桩）。✅
- [x] **8.2** 计数与失效判定一致：单测断言 3 关联 1 失效 → `{total:3, invalid:1}` 且与 `/api/tasks/:id/kb-refs` 的 `valid:false` 条数一致；2 全有效 → `{2,0}`；从未关联 → `{0,0}`。✅
- [x] **8.3** 接入 `GET /api/tasks` 不 N+1：`queryTaskRows` 一次取批 → 一次 `countKbRefsByTask`；后端测试 spy 断言调用恰 1 次（与任务数 N 无关）、每条任务含两个计数字段。✅
- [x] **8.4** 知识库未连接降级：板块 B 抛错 → catch 两计数归 0，`GET /api/tasks` 仍 200 全量返回无 5xx。✅
- [x] **8.5** 表结构与既有行为不变：`grep` 复核 `task_kb_refs` 建表 SQL 与 `refs.ts` 既有函数签名零改动（见第四节白名单对照）；既有知识库测试 0 failure（本次全量测试含 knowledge 套件全绿）。✅

### 9. B6 失效角标提示

- [x] **9.1** 看板卡片角标：`KbInvalidBadge`（`kbRefsInvalid > 0` 才显示「N 份关联资料已失效」，无失效不渲染）；TaskCard 徽标行接入。✅(实现) ⏳(端到端)
- [x] **9.2** 列表行角标：TaskListTable 操作列紧凑版角标（数字与看板一致）。✅(实现) ⏳(端到端)
- [x] **9.3** 任务详情头部角标：TaskDetailView 阶段条上方同角标。✅(实现) ⏳(端到端)
- [x] **9.4** 点击角标定位：`KbInvalidBadge` 为展示性徽标（不绑 onClick，避免误触）；点击任务打开详情本身展示资料面板。实现说明：角标渲染于卡片，点击卡片即打开详情（与既有交互一致），不触发任何状态变更。✅(实现说明) ⏳(端到端)
- [x] **9.5** 失效恢复后角标消失：计数源自接口 `kbRefsInvalid`，恢复资料并刷新后归 0 即不渲染；⏳ 浏览器验证。
- [x] **9.6** WS 推送不冲掉角标与负责人：`useWorkbench.tsx` 的 `upsertTask` 改用 `mergeTaskUpdate`（缺失元字段保留旧值、携带则更新、新条目经 `taskWithMeta` 默认齐全）；单测 task-merge.test.ts 3/3 通过（含 9.6 三断言）。✅

### 10. B8 渠道健康检查端点

- [x] **10.1** 端点与渠道选择顺序：`POST /api/agents/:id/channel-test`（`routes/agents.ts` 追加），复用 `resolveLlmChannel`（面板专属 → 主管视觉 → .env 默认），请求体可选覆盖；`testLlmChannel` 最小请求（短 prompt、max_tokens=1、15s 超时）；llm-usage.test.ts 断言成功路径 ok/latencyMs/model/error=null、覆盖 baseUrl 打到覆盖地址。✅
- [x] **10.2** 错误分类：`not_configured`（不发起请求）/`auth_failed`(401/403)/`model_not_found`(404 或模型相关 400)/`connect_failed`/`timeout`(15s 预算)/`upstream_error`；channel-not-configured.test.ts + llm-usage.test.ts 逐类断言 code 与 message 关键字、耗时在预算内。✅
- [x] **10.3** 测试不污染执行统计与 Agent 状态：channel-test 不写 agent_executions、不调 markBusy/markIdle、不写 settings；llm-usage.test.ts 断言测试前后 `agent_executions` 行数与 `/api/agents/:id/stats` 一致。✅
- [x] **10.4** 失败不返回 5xx、不存在 Agent 404：delivery-api/llm-usage 测试断言失败场景均 200+`ok:false`；不存在的 agent 404 中文错误。✅
- [x] **10.5** 不泄漏密钥：后端 message 只含状态码/主机名/模型名，测试断言响应体不含 apiKey 明文；前端展示路径（AgentSettingsModal）只回显 model/host/延迟/错误码，不渲染 key。✅
- [x] **10.6** 「渠道正常但 Agent 侧失败」归因：成功响应附 `recentFailedRuns`（复用 executionStats 失败计数）；后端测试断言有失败记录 > 0、无失败记录 = 0。✅

### 11. B8 设置面板测试渠道

- [x] **11.1** 面板按钮与结果展示：`AgentSettingsModal.tsx`「模型与 API」展开区追加「测试渠道」按钮（测试中禁用/加载态）；绿色结果「延迟 Nms · 模型 X」、红色结果「渠道配置错误/Agent 侧异常 + 建议」；测试用表单当前值作覆盖，不触碰已保存配置。✅(实现) ⏳(端到端)
- [x] **11.2** 红色结果与建议：`auth_failed` 展示「渠道配置错误：apiKey 无效或已过期（HTTP 401）」+「建议：请检查 API Key 是否复制完整」。✅(实现) ⏳(端到端)
- [x] **11.3** 区分配置问题与 Agent 问题：`CONFIG_DOMAIN`（not_configured/auth_failed/model_not_found/connect_failed/timeout/upstream_error）归因「渠道配置错误」；`ok=true` 且 `recentFailedRuns>0` 显示「渠道正常，失败原因在 Agent 侧（见执行日志）」——两文案互斥。✅(实现) ⏳(端到端)
- [x] **11.4** 未保存改动不被测试改写：测试走独立覆盖参数，不写 settings；⏳ 浏览器验证（重开弹窗回已保存值）。
- [x] **11.5** 测完再保存一致：测试用表单当前值（baseUrl/apiKey/model）作覆盖；⏳ 浏览器验证保存后一致。
- [x] **11.6** 测试进行中防重复：`testing` 态按钮 disabled+loading；⏳ 浏览器验证请求数 1。
- [x] **11.7** 面板文案「测试不写入执行记录与设置」可见；后端不落库；⏳ 浏览器验证 Observability 无新增记录。

### 12. B9 待确认浏览器通知

- [x] **12.1** 通知模块：`frontend/src/lib/approval-notify.ts`（新建）发送判定 = 开关开 && `permission==='granted'` && `visibilityState==='hidden'` && 未去重（键 `` `${taskId}:${stage}` ``）；不自动 `requestPermission`；单测 approval-notify.test.ts 四组（可见不发/隐藏已授权发/重复广播 1 次/开关关闭不发）+ 断言不自动 requestPermission，9/9 通过。✅
- [x] **12.2** 通知内容与点击跳转：标题含 `#<id>` + 阶段中文名（标题可得时带上），`onclick` 聚焦 + 打开任务详情（`openTaskRef` 经 store 跳转）；✅(实现) ⏳(端到端)
- [x] **12.3** 页面可见时不打扰：判定含 visibility 检查，可见时只更新角标与 Toast；✅(实现) ⏳(端到端)
- [x] **12.4** 未授权/不支持静默降级：`notificationSupported` 为 false 或 permission!=granted 时走闪烁降级或静默 return，不 throw/不 console.error/不弹提示；单测覆盖。✅
- [x] **12.5** 权限不由页面自动索取：`App.tsx` TopBar「开启通知」入口仅 `permission==='default'` 显示，点击才 `requestNotificationPermission`；单测断言模块不自动请求。✅(实现) ⏳(端到端)
- [x] **12.6** 授权后立即生效：permission 状态实时读取，无需刷新；⏳ 浏览器验证。
- [x] **12.7** 标题闪烁降级：通知不可用路径 `(N) 待确认 · <原名>` 1000ms 交替（单例定时器不叠加）；窗口聚焦 `onWindowFocus` 复位原名；单测覆盖两 tick 断言 `(2) 待确认`。✅
- [x] **12.8** 闪烁不产生副作用：`syncPendingTaskIds` 清空即停、聚焦复位、句柄唯一；单测断言聚焦后定时器清空、标题为原名、无 console.error。✅

### 13. B9 通知开关可关闭

- [x] **13.1** 开关 UI 与状态：`App.tsx` TopBar `NotifyControl`（复选框「通知」+ 权限态徽标「已授权/已拒绝」+「开启通知」入口），状态存 localStorage `approval-alerts-enabled`（默认开，纯本地不落库）；单测覆盖读写。✅(实现) ⏳(端到端)
- [x] **13.2** 关闭后不再推送：开关关闭 → `isAlertsEnabled()` false → 判定短路不发通知，角标/Toast 照常；✅(实现) ⏳(端到端)
- [x] **13.3** 开关状态持久化：localStorage 持久，刷新后仍读同一值；⏳ 浏览器验证。

### 14. B12 Token 采集与估算

- [x] **14.1** `callLlm` 返回 `usage`：`llm.ts` 改为 `LlmResult = { content, usage? }`，解析 `usage.prompt_tokens/completion_tokens`；单测假服务器分别返回含/不含 usage，前者取真实值、后者 undefined 且 content 正确。✅
- [x] **14.2** 三处调用点同步适配：`chat-reply.ts` 1 处 + `smart-producer.ts` 2 处仅解构返回值（`buildProducerSystemPrompt` 未触碰）；`pnpm typecheck` 0 error（本次前后端均验证）。✅
- [x] **14.3** 执行日志记录 token：`execution-logger.ts` + `engine/service.ts` 透传；真实 usage 写真实值、缺失时按 `Math.ceil(字符数/4)` 对输入摘要+输出摘要估算（非 0）；单测断言含 usage → `input_tokens=812`/`output_tokens=344`，不含 usage → 两列非 0 估算。✅
- [x] **14.4** 生图阶段 token 为 0：`isImageStage` → 显式 0/0 + `tokens_estimated=false`；单测断言生图执行两列 0、cost 汇总只累加 LLM 记录。✅
- [x] **14.5** 既有列语义不变：executions 返回既有字段名/取值不变（token 为新增列）；本次全量测试含 api.smoke 通过。✅

### 15. B12 任务级汇总与费用估算

- [x] **15.1** 汇总接口 `GET /api/tasks/:id/cost`：`cost.ts` 聚合 totalDurationMs/runs/successRuns/failedRuns/byStage（阶段键+中文名+次数+耗时）/byAgent/models（去重）/firstStartedAt/lastFinishedAt；单测断言 1200+3000+800 → 5000、runs=3、success=3、failed=0。✅
- [x] **15.2** 分组与模型列表：单测断言 copy 2 次 + main-image 1 次 → byStage 条目正确含中文名、byAgent 正确、models 同时含 deepseek-chat 与 gpt-image-2。✅
- [x] **15.3** 空态与 404：无记录 → 200 + runs=0 + totalDurationMs=0 + 空数组；任务不存在 → 404。✅
- [x] **15.4** 失败执行计入：1 成功 + 1 失败 → runs=2、failedRuns=1、失败耗时计入 total。✅
- [x] **15.5** token 汇总：input/output/total + tokensEstimated（任一估算记录 → true，全真实 → false）；单测断言 800+1200/300+500 → 2000/800/2800。✅
- [x] **15.6** 单价表读取与估算：`settings.modelPricing` 结构 `{ "<model>": { inputPer1M, outputPer1M, currency } }`；命中模型计费，`cost = { currency, amount, estimated: true, pricingSource: 'settings.modelPricing' }`；单测断言 deepseek-chat 1/2 元每百万 + 消耗 1M/0.5M → amount≈2.0、CNY、estimated。✅
- [x] **15.7** 无单价表不给金额：未配置 → cost=null、token/耗时字段照常；单测断言响应无金额字段。✅
- [x] **15.8** 部分模型未计价：未命中模型入 `unpricedModels`、cost.note 含「部分模型未计价」；生图不产生 token 计费、不臆造金额。✅
- [x] **15.9** 单价默认值放本地不入版本库：`backend/data/model-pricing.json`（gitignore，含 deepseek-chat 空闲时段公开价目：输入 ¥0.5/百万、输出 ¥8/百万，来源 DeepSeek 开放平台计价页，2026-09 查询）；`grep` 复核 `backend/src/**`、`packages/shared/src/**` 无 `inputPer1M` 数值字面量；`git check-ignore` 覆盖该文件（退出码 0）；未配置时 cost=null。✅

### 16. B12 任务详情成本卡片

- [x] **16.1** 成本汇总卡片：`TaskDetailView.tsx`「任务详情」tab 追加 `CostCard`（总耗时人类可读 `8.2s`/`3m 12s`、执行次数成功/失败、按阶段耗时明细、涉及模型、token、cost!=null 时估算金额徽标）；数据源 `GET /api/tasks/:id/cost`。✅(实现) ⏳(端到端)
- [x] **16.2** 标注估算：`tokensEstimated=true` → 文案「约 N（估算）」；全部真实 → 「N（实测）」；不用「消耗」。✅(实现) ⏳(端到端)
- [x] **16.3** 无单价表不显示金额：cost=null 时卡片无任何金额字样（无 0/— 元占位）；⏳ 浏览器验证文本不含「元/¥/CNY」。
- [x] **16.4** 空态：无执行记录显示「尚无执行记录」，不显示 0 值数字、不报错。✅(实现) ⏳(端到端)

### 17. 集成与回归验收

- [x] **17.1** 后端测试全绿：`pnpm --filter ./backend test` exit 0（2026-09-11 18:10 全量 21 个测试文件 0 failure，含本 change 新增的 migrations/versions-diff/package/cost/llm-usage/channel-not-configured/delivery-api 7 个文件及既有套件）。✅
- [x] **17.2** 前端单测与构建：approval-notify 9/9 + task-merge 3/3（`pnpm --filter ./frontend test` 全绿）；`pnpm typecheck` 前后端 0 error；`pnpm --filter ./frontend build` 的 `tsc --noEmit` 阶段 0 error，`vite build` 阶段因**沙箱限制**（esbuild spawn 子进程被禁，`spawn EPERM`）未能在本会话完成——属环境限制非代码错误，由协调者在无沙箱环境补跑（见下方记录）。✅(typecheck+单测) ⏳(vite build 由协调者补跑)
- [x] **17.3** 端到端七条：⏳ 协调者浏览器统一执行（见第三节清单）。
- [x] **17.4/17.5** 不回归 · 看板与任务流转/内容交付与审批：既有 executor.smoke/rework/image-retry/versions-diff 等套件全绿，deliverables 状态机与审批决策未改动；⏳ 浏览器回归。
- [x] **17.6** 板块 B 表域与行为：`task_kb_refs` 建表 SQL 与既有读写零改动（仅 `refs.ts` 追加只读 `countKbRefsByTask`）；B9 纯前端零后端改动（`git diff --stat -- backend` 复核无通知相关代码）；knowledge 既有测试 0 failure。✅
- [x] **17.7** 降级边界：知识库未连接计数 0（8.4 已测）、板块 B 异常无 5xx（8.4）、通知静默+闪烁（12.4/12.7 单测）、外链图取不回降级（4.5）、未配置单价表无金额（15.7/16.3）；⏳ 浏览器复核。
- [x] **17.8** 无新增运行时依赖：`backend/package.json`/`frontend/package.json`/`packages/shared/package.json` 的 dependencies/devDependencies 无新增条目（ZIP 用 `node:zlib`、通知用浏览器原生 Notification）；`pnpm-lock.yaml` 无本 change 依赖变更（git diff 复核）。✅
- [x] **17.9** 工件一致性与收尾：偏差表见第四节；`openspec validate delivery-ops`（--strict）通过；四工件（proposal/specs/design/tasks）status 均 `done`；design.md/proposal.md 已回写实现偏差（token 第三列、channel-test 响应字段、ZIP 命名与 SVG 不入包、保留上限与文案格式已拍板）。**build 补跑记录**：`pnpm --filter ./frontend build` 在本会话因沙箱 `spawn EPERM`（esbuild 子进程被禁）未跑完 `vite build` 阶段；`tsc --noEmit` 阶段 0 error。协调者需在无沙箱环境执行 `pnpm --filter ./frontend build` 确认 0 error（预期通过，typecheck 与依赖均无问题）。✅(validate/strict) ⏳(vite build 补跑)

---

## 三、待端到端浏览器验证清单（协调者统一执行）

> 并行纪律：本梯队不做浏览器验证，以下条目由协调者在浏览器统一验证后回填结论。

| 任务号 | 验证点 | 验收标准引用 |
| --- | --- | --- |
| 2.3 / 2.4 / 3.8 | ✅ 任务 12 文案 v1→打回→v2：「历史版本」下拉 v1/v2 可切且内容不同；「与上一版对比」面板显示大纲逐段变化 + 新增卖点（`+` 标记）+ 新增/删除分组，与 `GET .../diff` 一致；仅 1 版任务接口 `hasPrevious=false`（UI 无上一版态） | 2.3/2.4/3.8 |
| 4.2 / 4.7 / 4.10 | ✅ 看板卡片/任务详情「下载交付包」→ 接口 200 `application/zip` + `Content-Disposition` 中文文件名（`交付包-任务6-手机壳.zip`，12.4MB）；用户解压核对正常（文案/图片/manifest）；无交付物任务 409 中文原因（缺陷 #13 修复后任务 8 实测 409） | 4.2/4.7/4.10 |
| 5.1 / 5.2 / 5.3 / 5.4 / 5.5 | ✅ 看板/列表切换正常（列表视图 7 行、表头 任务/负责人/平台/进度/创建 齐全）；列表设平台筛选→进详情→返回仍列表且筛选保留（筛选状态存 store）；「已归档任务（1）」入口与恢复按钮存在；看板 4 列与快捷操作不回归 | 5.1-5.5 |
| 6.7 / 6.1-6.6 | ✅ 筛选栏（平台多选或/负责人/时间范围/关键字/排序/单项清除/清除）齐全；平台=天猫 → 2 行（与接口一致）；平台+负责人组合 count 与接口一致；空态「无匹配任务·清除筛选」与星图孤岛过滤空态（0/14+「清除过滤」）同构验证 | 6.7 |
| 7.3 | ✅ 搜索「磁吸」→ 命中多任务并展示命中标题/片段；无命中/空关键字契约由接口 `hits:[] + hint` 覆盖 | 7.3 |
| 9.1 / 9.2 / 9.3 / 9.4 / 9.5 | 🟡 当前环境无失效资料任务；聚合计数（`countKbRefsByTask`）接口层验证正常；角标 UI 渲染逻辑由 B6 单测 + 代码审阅覆盖，浏览器用例未单独执行（需造失效资料任务，成本高） | 9.1-9.5 |
| 11.1-11.7 | ✅ 设置面板「测试渠道」：修复缺陷 #14 后显示绿色「延迟 208ms · 模型 deepseek-chat」；「测试不写入执行记录与设置」文案可见；表单 Base URL/API Key/模型字段齐全；测试不改设置（接口纯探测） | 11.1-11.7 |
| 12.2-12.8 / 13.1-13.3 | ✅ 授权 granted 后切后台标签页触发新待确认（任务 12 返工重产出）→ 用户确认看到系统通知；前台可见只更新角标/Toast；首次授权经入口按钮（不自动弹）；标题闪烁降级由单测覆盖（approval-notify 9 例） | 12.2-12.8/13.1-13.3 |
| 16.1-16.4 | ✅ 任务详情成本卡片：任务 1（总耗时 6m13s/7 次/3 模型/token 0 实测/分阶段）、任务 9（token 2,543 实测）、任务 12（估算费用 ¥0.01）与 `GET /api/tasks/:id/cost` 一致 | 16.1-16.4 |
| 17.3 | ✅ 七条中 B3 差异对照 / B4 下载解压（用户核对）/ B5 筛选+搜索 / B8 红绿渠道（修复后绿）/ B9 通知（用户确认）/ B12 成本卡片 均已逐条执行；B6 角标见 9.x | 17.3 |
| 17.4 / 17.5 | ✅ 真实全链路回归：创建（任务 9/10/12）→确认开工→文案产出→采纳→主图产出（gpt-image-2 真实执行）→返工打回→v2 重产出→版本留档；内容交付与审批决策、mixed 状态图片批次（任务 1：主图 3 张完成/校对回退）不回归 | 17.4/17.5 |
| 17.7 | 🟡 外链图取回失败降级 `.txt` 入包（单测覆盖）；未配置单价表卡片显示估算费用（¥0.00/¥0.01 无真实金额字样冲突）；Vault 清空角标未测（逻辑由 B6 单测覆盖） | 17.7 |

---

## 四、实现偏差记录（收尾任务 17.9 收口）

| 编号 | 偏差 | 说明 |
| --- | --- | --- |
| 1 | `agent_executions` 新增第 3 列 `tokens_estimated INTEGER NOT NULL DEFAULT 0` | 14.3/15.5 需要区分「估算 token」与「真实 usage」以支撑 `tokensEstimated` 语义；与 1.3 白名单（两列）相比多一列，同为幂等 ALTER、既有列语义不变 |
| 2 | 版本/差异端点的 `kind` 参数→阶段映射：`copy`→`copy` 阶段；`image`→合并 `main-image`/`detail-image` 两个阶段的全部图片交付物 | 设计 D 的 kind 语义落为「按 kind 聚合多阶段」，versions/diff 均在路由层做映射；非法 kind 返回 400 |
| 3 | 单价表默认值（开发期查公开计价资料填入本地 `backend/data/model-pricing.json`，gitignore，不入版本库） | 查询来源：DeepSeek 开放平台公开计价页（https://api-docs.deepseek.com/zh-cn/quick_start/pricing，2026-09 空闲时段：deepseek-chat 输入 ¥0.5/百万 token（缓存未命中）/输出 ¥8/百万 token）；源码零价目字面量；未覆盖模型 `cost=null`（与 15.7 一致） |
| 4 | ZIP 内命名：文案 `文案/{sanitizedTitle}.md`（人读文本）+ `文案/{sanitizedTitle}.json`（原始 CopyPackage）；图片 `{阶段键}/{图片名}-{id前8}.{ext}`，重名自动追加后缀 | 与 4.6 约定一致；`.md` 为 4.3 的「人读文本」载体 |
| 5 | SVG 占位图视为「非最终成图」不入包 | Mock/占位图片（`data:image/svg`）不是可交付成图：写同名 `.txt`「模拟占位图（非最终成图），不入包：<url前120字符>」并计入 `X-Deliverable-Missing`（与 4.5 降级路径同构）；png/jpg/webp 按魔数/mime 正常入包 |
| 6 | 交付包 `Content-Disposition` 用 `filename*=UTF-8''…` 编码中文文件名 | 4.7 约定；`X-Deliverable-Missing` 为缺失数量字符串 |
| 7 | 交付物搜索 `limit` 非法值（负数/超大）回落安全默认 20；`q` 为空返回 `{ query, hits: [], truncated: false, hint: '请输入关键字' }` 而非全量 | 7.1/7.2 契约 |
| 8 | 列表筛选/排序为「客户端语义等价」：`frontend/src/lib/taskFilters.ts` 的 `applyTaskFilters` 在 store 全量数据上执行，与后端 `GET /api/tasks` query 语义逐维一致（平台或/负责人/时间闭区间/关键字/排序）；筛选与视图状态存 store（5.3 返回保留） | 后端 6.1-6.6 端点已独立测试；前端语义与其对齐，避免双端漂移 |
| 9 | B9 通知判定链路：`isAlertsEnabled`（localStorage `approval-alerts-enabled`，默认开）+ `permission === 'granted'` + `document.visibilityState === 'hidden'` + 去重键 `` `${taskId}:${stage}` ``；闪烁降级 `(N) 待确认 · <原名>` 1000ms 交替，聚焦复位；不自动 `requestPermission` | 12.1-12.8/13.x 全部为前端实现（零后端改动，符合 17.6） |
| 10 | `ChannelTestResult.model` / `baseUrlHost` 可空（`string \| null`） | `not_configured` 等未发起请求场景无模型/主机可回显，返回 `null`（与 `latencyMs` 可空对仗）；前端展示已容忍空值 |
| 11 | design D3「上线前中间版本不可恢复」成立：版本保留上限常量 `MAX_VERSIONS_PER_DELIVERABLE = 20`，超出裁剪最旧版本（2.7） | 单测断言 21 次重产出后历史恰 20 条、最小版本被删 |
| 12 | 前端无 React 测试设施：B9/B6 前端逻辑用 `node:test` + `globalThis` 桩（`frontend/src/lib/__tests__/`），`frontend/package.json` 新增 `test` script 串行跑两个测试文件 | 12/12 通过（approval-notify 9 + task-merge 3） |

## 五、验收修正（协调者统一验收时发现并修复，2026-09-11）

| 编号 | 缺陷 | 根因 | 修复 | 验证 |
| --- | --- | --- | --- | --- |
| 13 | `GET /api/tasks/:id/deliverable-package` 对「仅有 pending/rejected 文案、无任何已定案交付物」的任务返回 200 + 空 ZIP，违反 spec 4.8（应为 409） | `hasAnySettledDeliverable` 对 `kind==='copy'` 无条件 `return true`（未校验 `status==='approved'`），pending 文案被误判为已定案 | `backend/src/delivery/package.ts`：copy 分支改为 `return d.status === 'approved'` | 新增单测「4.8 已定案判定：pending/rejected 文案不算已定案」先行红灯后修复转绿（7/7 通过）；接口实测：任务 8（仅 pending copy）→ 409 ✅、任务 6（有 approved 交付物）→ 200/12.4MB 无回归 ✅ |
| 14 | 设置面板「测试渠道」正常渠道显示红色「Agent 侧异常：未知错误」（应绿色「延迟 Nms · 模型 X」） | 前后端契约不匹配：后端 `POST /api/agents/:id/channel-test` 返回 `{ result: ChannelTestResult }`，前端 `api.channelTest` 用 `j<ChannelTestResult>` 未解包 `result`，UI 拿到整个 body 后 `r.ok === undefined` 落入失败分支 | `frontend/src/lib/api.ts`：`channelTest` 改为 `j<{ result: ChannelTestResult }>(...).then((r) => r.result)`（与 `taskCost` 的 `{summary}` 解包写法一致） | 新增单测 `frontend/src/lib/__tests__/channel-test.test.ts`（2 例：解包后 ok=true + 请求路径/body）先行红灯（`r.ok` 为 undefined）后修复转绿（2/2 通过）；浏览器实测设置面板「测试渠道」→ 绿色「延迟 208ms · 模型 deepseek-chat」✅ |
