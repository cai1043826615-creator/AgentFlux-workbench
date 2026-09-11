> **梯队定位（主文档 T4）**：交付闭环与运营效率，含 B3（交付物版本对比）、B4（交付包 ZIP 下载）、B5（任务列表视图 + 检索）、B6（关联资料失效告警）、B8（渠道健康检查）、B9（待确认通知）、B12（任务级成本/耗时）。七条目互不耦合，设计上支持 **4-6 路并行**；同一文件不得被两个代理同时改（文件归属见下）。
> **已拍板决策（不得再留作待确认）**：
> ① **B9「浏览器 Notification 推送」与「页面标题闪烁」同时做**——通知已授权且页面不可见时发系统通知；未授权/不支持/开关关闭时靠 `document.title` 交替闪烁降级（第 13 组同时包含两条链路与各自验收项）。
> ② **B12 用可配置单价表做费用估算**——单价数据结构为 `settings.modelPricing`，实际单价数字由开发期查公开计价资料后作为默认值填入 **本地配置**（`backend/data/` 已被 `.gitignore` 排除，不入版本库），不在源码中硬编码任何价目常量。
> **并行文件归属（同一文件只有一个组拥有写权，避免冲突）**：
> - 第 1 组拥有：`backend/src/db/ensure.ts`、`backend/src/db/schema.ts`、`packages/shared/src/types.ts`
> - 第 4 组拥有：`backend/src/routes/tasks.ts`（B4 端点）
> - 第 8 组拥有：`GET /api/tasks` 查询参数与任务列表查询层（`backend/src/routes/tasks.ts` 内独立函数）
> - 第 10 组拥有：`backend/src/routes/tasks.ts` 的任务对象装配处（仅并计数元字段）与 `frontend/src/store/useWorkbench.tsx`（元字段合并）
> - 第 11 组拥有：`backend/src/routes/agents.ts`；第 13 组拥有：`frontend/src/App.tsx` + 新增通知模块
> - 第 14/15 组拥有：`backend/src/agents/llm.ts` 与 3 处调用点（`chat-reply.ts`、`smart-producer.ts`），**必须同组同批改完**
> - 其余组各自拥有新建文件；跨组需要改动他人归属文件时，先在该组任务下留一条「协调记录」再动手
> **边界**：不改 `task_kb_refs` 表结构与其既有读写行为；不新增任何运行时依赖（ZIP 用 `node:zlib`、通知用浏览器原生 `Notification`）；不改 `deliverables` 既有字段与状态机；不改 `agent_executions` 既有列语义。
> **验收纪律**：每条任务都必须实际执行其「验证」后再勾选；验证方式只允许可观测断言（单测断言点、`pnpm` 命令输出、浏览器可见行为、解压 ZIP 的实际内容、`openspec validate` 结果），禁止「体验良好」类表述。

## 1. 前置确认与共享契约（先做，其余组依赖本组产物）

- [ ] 1.1 确认基线现状（不改代码）：核对 `backend/src/delivery/store.ts` 的 `saveDeliverable` 确为原地 `UPDATE ... version = version + 1`（库中只有最新内容）、`backend/src/routes/tasks.ts` 的 `GET /api/tasks` 无 query 参数、`backend/src/agents/llm.ts` 的 `callLlm` 只返回 `content` 字符串且丢弃 `usage`、`frontend/src/store/useWorkbench.tsx` 的 `upsertTask` 会用广播体覆盖本地元字段；验证：四条逐一用阅读/`grep` 复核通过，并把复核结论写入 `openspec/changes/delivery-ops/` 内的验证记录文件（不写入 `docs/`），`openspec validate delivery-ops` 通过
- [ ] 1.2 交付物版本历史表迁移：在 `backend/src/db/ensure.ts` 幂等新增 `deliverable_versions(id, deliverable_id, task_id, stage, kind, version, content, status, created_at)`，建 `(deliverable_id, version)` 唯一索引与 `task_id` 索引，写法沿用既有 `CREATE TABLE IF NOT EXISTS` / `CREATE UNIQUE INDEX IF NOT EXISTS` 模式；验证：单测连续调用 `ensureSchema()` 两次不报错且表结构一致，`INSERT` 同 `(deliverable_id, version)` 两次抛唯一约束错误
- [ ] 1.3 `agent_executions` token 列迁移：幂等加 `input_tokens INTEGER NOT NULL DEFAULT 0`、`output_tokens INTEGER NOT NULL DEFAULT 0`，用 `ALTER TABLE ... ADD COLUMN` 包 try/catch（与既有 `tasks.reference_image` / `tasks.archived` 迁移写法一致），并在 `backend/src/db/schema.ts` 补两列行类型；验证：单测在同一进程连续迁移两次均不报错，既有执行记录行两列为 `0`，`GET /api/executions` 返回结构与改动前一致
- [ ] 1.4 共享类型契约（`packages/shared/src/types.ts` 及既有导出入口）：新增 `DeliverableVersion`、`DeliverableDiff`（含 `addedPoints` / `removedPoints` / `keptPoints` / `titleChanged` / `outlineChanged` / `keywordChanges` / `addedImages` / `removedImages` / `identical` / `hasPrevious` 语义字段）、`TaskCostSummary`（`totalDurationMs` / `runs` / `successRuns` / `failedRuns` / `byStage` / `byAgent` / `models` / `tokens{tokensEstimated}` / `cost|null` / `unpricedModels` / `firstStartedAt` / `lastFinishedAt`）、`ChannelTestResult`、`TaskListQuery`（`platform`/`owner`/`from`/`to`/`q`/`sort`/`order`）、`DeliverableSearchHit`；验证：`pnpm --filter @workbench/shared build` 0 error，且既有类型消费者（`frontend/src/lib/api.ts` 的 `parseImages`/`parseCopy`）无需改动即可编译通过
- [ ] 1.5 共享路由与 API 契约登记：在 `frontend/src/lib/api.ts` 增补 8 个新端点的封装壳与类型（`GET /api/tasks` 扩展 query、`GET /api/tasks/:id/deliverables/:kind/versions`、`GET /api/tasks/:id/deliverables/:kind/diff`、`GET /api/tasks/:id/deliverable-package`、`GET /api/deliverables/search`、`GET /api/tasks/:id/cost`、`POST /api/agents/:id/channel-test`），本轮只建签名与类型不做实现；验证：`pnpm typecheck` 0 error，且页面构建不因新增未实现端点而报错
- [ ] 1.6 冻结「新增能力、不动既有语义」的改动白名单：列出本 change 允许触碰的文件清单与不允许触碰的清单（`task_kb_refs` 建表 SQL、板块 B 其它表、`deliverables` 既有列、`agent_executions` 既有列、`buildProducerSystemPrompt` 段序）；验证：白名单写入 `openspec/changes/delivery-ops/` 内的验证记录文件，并在收尾任务 16.6 逐条对照检查

## 2. B3 交付物版本历史留档（deliverable-package · Requirement「交付物版本历史留档」）

- [ ] 2.1 版本历史读写模块（落点：`backend/src/delivery/versions.ts`）：实现 `archivePreviousVersion(deliverableId, taskId, stage, kind, version, content, status)`（写前判定是否已存在同版本，存在则跳过）与 `listVersions(deliverableId)`（按版本号升序）；验证：单测断言同一版本重复写入只落 1 行、按版本升序返回、`content` 原样保留（不做 JSON 重排以外的改写）
- [ ] 2.2 接入 `saveDeliverable` 覆盖前留档（`backend/src/delivery/store.ts`）：在 UPDATE/UPDATE-version 分支**之前**把 `existing.content` + `existing.status` + `existing.version` 写入 `deliverable_versions`，首次产出同时写 v1，全部与交付物写入放在**同一事务**内；验证：单测断言「第一次产出 1 次 → 历史 1 条 v1」「再产出 1 次 → 交付物 version=2 且历史含 v1(旧内容) 与 v2(新内容)」，并在留档后人为让交付物写入失败（mock 抛错）时断言历史无新增行（同事务）
- [ ] 2.3 文案打回重做后两版都在（对应 Scenario「文案打回重做后两个版本都在库里」）：跑通「文案 v1 产出 → 打回 → 文案 v2 产出」链路后调用 `GET /api/tasks/:id/deliverables/copy/versions`；验证：返回至少 v1 与 v2 两条，且 v1 的 `content` 与首次产出的完整文案包逐字段一致（含 `title` / `points` / `outline` / `keywords`），v2 的 `content` 与当前交付物一致
- [ ] 2.4 版本号一致性与「首次产出不留多余历史」（对应 Scenario「版本号与当前交付物一致」「首次产出不留多余历史」）：实现读取端校验接口约定（历史最大版本号 === `deliverables.version`）；验证：单测断言 `version = 3` 的交付物历史最多 3 条、最大版本号恰为 3；`version = 1` 的交付物历史恰为 1 条（v1），不产生空记录或重复记录
- [ ] 2.5 图片交付物重产出留档（对应 Scenario「图片重产出同样留档」）：`main-image` 阶段重产出后读取该交付物历史；验证：单测断言历史中存在重产出前的图片条目快照，每张图含 `id` 与 `status`，且 `id` 集合与重产出前一致
- [ ] 2.6 既有数据幂等回填（对应 Scenario「历史表幂等建表与既有数据回填」）：在 `ensureSchema()` 之后对每个缺失「当前版本记录」的 `deliverables` 行写入一条 `version = deliverables.version`、内容为当前 `content` 的基线记录；验证：单测在同一进程连续执行回填两次，第二次新增行数为 0（幂等）；对已有 v3 交付物断言回填后历史含且仅含 v3 一条
- [ ] 2.7 版本保留上限：每个交付物只保留最近 20 版（常量集中定义，便于调整），超出时删除最旧记录；验证：单测构造 21 次重产出后断言历史条数为 20、被删的是最小版本号、最新版本仍在且 `content` 正确

## 3. B3 交付物相邻版本差异（deliverable-package · Requirement「相邻版本差异提示」）

- [ ] 3.1 差异计算模块（落点：`backend/src/delivery/diff.ts`）对 `copy` 做卖点行差异：`trim + 折叠内部连续空白` 归一化后按精确串求差集/交集，输出 `addedPoints` / `removedPoints` / `keptPoints`；验证：单测断言 v1 `["30W 快充","磁吸吸附"]` 与 v2 `["30W 快充","航空铝外壳"]` → 新增含 `航空铝外壳`、删除含 `磁吸吸附`、保留含 `30W 快充`（对应 Scenario「卖点行新增与删除被列出」）
- [ ] 3.2 顺序变化不算增删（对应 Scenario「卖点顺序变化不算增删」）：验证：单测断言仅调换顺序的两个版本 → `addedPoints` 与 `removedPoints` 均为空，`keptPoints` 含全部卖点行（长度与原集合一致）；并覆盖「卖点含首尾空格/全角空格差异」时仍判定为同一行
- [ ] 3.3 标题 / 大纲 / 关键词变化标注（对应 Scenario「标题与关键词变化被标注」）：输出 `titleChanged`、`outlineChanged`（含变化前后值）与 `keywordChanges`（`added` / `removed`）；验证：单测断言仅改 `title` 并新增一个 `keyword` 时 `titleChanged = true`、`keywordChanges.added` 含该关键词、`outlineChanged = false`
- [ ] 3.4 两版完全一致（对应 Scenario「两个版本完全一致」）：验证：单测断言内容相同时 `identical = true` 且四个差异数组均为空、函数不抛错，响应体含「与上一版一致」的明确标识字段
- [ ] 3.5 仅一个版本时的无对比态（对应 Scenario「只有一个版本时无可对比对象」）：验证：单测断言仅有 v1 时返回 `hasPrevious = false` 的明确状态对象（非空对象、非 `null`、非 500），且不进入差异计算分支
- [ ] 3.6 图片交付物差异（对应 Scenario「图片交付物版本差异」）：按 `ImageItem.id` 集合求差集，输出新增与删除图片的 `id`；验证：单测断言 v2 比 v1 少 1 张多 1 张时 `removedImages` 与 `addedImages` 各含对应 `id` 且长度均为 1
- [ ] 3.7 差异接口：新增 `GET /api/tasks/:id/deliverables/:kind/diff`（支持 `from` / `to` 版本参数，默认「当前版本 vs 上一版本」）；验证：后端测试断言默认返回 v2-vs-v1 的差异、指定 `from=v1&to=v3` 时返回 v3-vs-v1、`kind` 非法时返回 400 与中文说明、任务或交付物不存在时返回 404
- [ ] 3.8 内容交付页版本切换与差异对照（`frontend/src/features/content/ContentDeliveryView.tsx`）：新增版本下拉（含版本号与产出时间）+「与上一版对比」面板，展示新增/删除/保留卖点行分组、标题与关键词变化；验证：浏览器打开一个被打回重做过的文案交付物，切到 v1/v2 可见内容不同，「与上一版对比」列出的新增与删除卖点行与 `GET .../diff` 返回逐条一致；仅有 v1 时显示「无上一版可对比」，页面无报错、不承诺「可回溯任意历史版本」

## 4. B4 交付包 ZIP 打包下载（deliverable-package · Requirement「交付包 ZIP 打包下载」「交付包内容清单」）

- [ ] 4.1 零依赖 ZIP 组装器（落点：`backend/src/delivery/package.ts`）：手写本地文件头 + `deflateRaw` 数据 + 中央目录 + EOCD，CRC32 查表实现，文件名 UTF-8 并置 UTF-8 标志位；验证：单测对固定文本条目断言：①本地头签名 `PK\x03\x04`、EOCD 签名 `PK\x05\x06` 存在；②中央目录条目数与输入条目数一致；③CRC32 与 `zlib.crc32` 对同一 Buffer 的取值一致（无该 API 时用已知向量 `"123456789" → 0xCBF43926` 断言）
- [ ] 4.2 写出的 ZIP 必须能被真实解压工具打开：把单测产出的 zip 落盘为临时文件，用 `Expand-Archive`（Windows）或 `unzip -t`（可用时）校验；验证：解压命令 0 错误、解出的每个文件字节与输入 Buffer **逐字节一致**（比对 SHA256），此条不得用「接口返回 200 且有字节」替代
- [ ] 4.3 组装交付包内容：从 `deliver` 阶段采用的上架资料包交付物取文案（同时写 `文案.md` 与人读文本、`文案.json` 为原始 `CopyPackage`），从**全部**图片交付物取 `status = 'approved'` 的图片，`rejected` 与 `failed` 一律不入包；验证：单测构造含 `approved` / `rejected` / `failed` 三种状态的图片交付物，断言 zip 内只出现 `approved` 图（对应 Scenario「只含已采纳图片」）
- [ ] 4.4 三类图片来源入包（对应 Scenario「dataURL 与 http URL 两种图片来源都能入包」）：`data:image/...;base64,` 直接 base64 解码、`/uploads/xxx.png` 读 `backend/data/uploads/` 本地文件（与 `routes/tasks.ts` 的 `UPLOAD_DIR` 同源）、`http(s)://` 带超时 `fetch` 取回；按实际类型定扩展名（png/jpg/webp 靠魔数或 dataURL mime 判定）；验证：单测对三类来源各断言解出的字节与原始 Buffer 一致且扩展名正确（例如 dataURL 声明 `image/png` 时条目名为 `.png`）
- [ ] 4.5 单张图片失败降级（对应 Scenario「单张图片无法获取时不整体失败」）：取回失败（超时 / 404 / 解码失败）时写同名 `.txt` 说明文件（含失败原因），并在 `manifest.json` 与响应头 `X-Deliverable-Missing` 标注缺失数量；验证：单测注入一个必失败的 http URL，断言 zip 仍生成成功、缺失位置存在 `.txt`、`X-Deliverable-Missing` 值为 1，且该失败的 `.txt` 内容含失败原因字符串
- [ ] 4.6 ZIP 内命名体现阶段与图片名（对应 Requirement「ZIP 内文件命名 SHALL 体现阶段与图片名称」）：采用 `<阶段键>/<图片名或序号>-<短id>.<ext>` 形式，图片名缺失时回退为有序序号，重名自动追加后缀避免覆盖；验证：单测构造同阶段两张同名图片，断言 zip 内两条目名不同且均含阶段键与图片名
- [ ] 4.7 交付包下载端点 `GET /api/tasks/:id/deliverable-package`：返回 `application/zip` + `Content-Disposition: attachment`，文件名 `交付包-任务<id>-<标题>.zip`（标题做文件名非法字符清理）；验证：后端测试用轻量 HTTP 客户端断言状态 200、`content-type` 为 `application/zip`、`content-disposition` 含编码后的中文文件名，且落盘后可被解压工具打开（对应 Scenario「下载归档任务的交付包」前半）
- [ ] 4.8 无交付物时返回 409（对应 Scenario「任务无任何已定案交付物」）：请求一个尚未产出任何交付物的任务；验证：后端测试断言状态码为 `409`、响应体含明确中文说明、响应体不是 zip 字节（断言不以 `PK` 开头）、不是 500
- [ ] 4.9 `manifest.json` 清单（对应 Requirement「交付包内容清单」及其两个 Scenario）：含任务 id、标题、目标平台、生成时间、文案文件路径、每张入包图片的名称/来源阶段/状态、被排除图片的数量与原因分类；验证：单测断言 `manifest` 的入包图片条目数 === zip 内实际图片文件数；再构造「只有图片交付物、没有文案交付物」的任务，断言文案字段为 `null` 或空串且 zip 正常生成并含图片
- [ ] 4.10 归档任务交付包入口（看板卡片 / 任务详情）：提供「下载交付包」入口，未归档任务也允许下载（无交付物时展示 409 的中文原因而不是静默失败）；验证：浏览器对一个已归档任务点击「下载交付包」，下载到 `交付包-任务<id>-<标题>.zip`，用 `Expand-Archive` 解压后含文案文件与全部已采纳图片，且图片能正常打开（原图字节一致）

## 5. B5 任务列表视图（task-explorer · Requirement「任务列表视图」）

- [ ] 5.1 视图切换框架：在 `frontend/src/features/board/` 下新增「看板 / 列表」切换（`BoardView.tsx` 增加视图状态与切换控件，列表渲染抽为新组件），两种视图共用同一任务数据源与元字段（`ownerName` / `stageLabel` / `archived` / 关联资料计数）；验证：浏览器点击「列表」出现表格化行视图，每行含 id、标题、状态列、当前阶段、负责人、平台、创建时间（对应 Scenario「切换到列表视图」）
- [ ] 5.2 两视图数据一致（对应 Scenario「列表与看板数据一致」）：验证：同一时刻截图/记录两视图的任务 id 集合与各自计数，断言未归档任务集合与状态完全一致（含列归属一致），计数相同
- [ ] 5.3 从列表打开任务详情并保留视图与筛选（对应 Scenario「从列表打开任务详情」）：验证：浏览器在列表视图设一个筛选条件 → 点某行进入任务详情 → 返回后仍为列表视图，且筛选栏取值与进入前一致
- [ ] 5.4 归档任务不入列表（对应 Scenario「归档任务不入列表」）：验证：浏览器对一个任务执行归档后，列表视图不再出现该任务，且「已归档任务」弹窗（`ArchivedTasksModal.tsx`）中仍可查看与恢复；恢复后重新出现在列表
- [ ] 5.5 看板 4 列渲染与快捷操作不回归：验证：浏览器核对看板仍为既有 4 列、列内卡片顺序与拖拽/快捷操作（如有）行为与改动前一致，切换视图后再切回看板不丢失列状态

## 6. B5 任务筛选与排序（task-explorer · Requirement「任务筛选」「任务排序」）

- [ ] 6.1 `GET /api/tasks` 查询参数实现（服务端单一筛选口径）：支持 `platform`（多值，维度内「或」）、`owner`、`from` / `to`（创建时间闭区间）、`q`（匹配标题或描述）与 `sort`（`created` | `updated` | `progress`）、`order`（`asc` | `desc`），全部用参数化 SQL 拼 `WHERE`，维度之间为「与」；验证：后端测试对固定数据集逐维断言——平台「抖音小店」只返回 `platforms` 含该平台的任务、负责人「美美」只返回 `owner_agent_id` 对应任务、`from=2026-09-01&to=2026-09-11` 只返回该闭区间内任务、`q=磁吸` 返回标题或描述含该词的任务、`q` 为注入式字符串（如 `' OR 1=1 --`）时返回空集且不报错、无参数时返回与改动前完全相同的全量结果（对应 4 个筛选 Scenario）
- [ ] 6.2 多维度组合筛选为「与」（对应 Scenario「多维度组合筛选」）：验证：后端测试断言「平台=天猫 & 负责人=美美」只返回同时满足两者的任务，且结果集是两次单维筛选结果的交集
- [ ] 6.3 多值同维为「或」：验证：后端测试断言 `platform=天猫&platform=抖音小店` 返回两类任务的并集（去重后条数 === 两类条数之和）
- [ ] 6.4 `updated` 排序口径：取 `tasks.created_at`、`deliverables.updated_at`、`task_events.created_at` 的较新者（相关子查询），无交付物与事件时回退 `created_at`；验证：单测断言「仅改过交付物的任务」排在「仅创建时间更早但无变动」的任务之前，且口径与 design D8 描述一致
- [ ] 6.5 排序与筛选叠加（对应 Scenario「排序与筛选叠加」）：验证：后端测试先加平台筛选再切换排序，断言排序只在筛选结果集内生效且筛选参数未被忽略（结果条数同筛选后条数，顺序单调）
- [ ] 6.6 默认排序与进度排序（对应 Scenario「默认排序」「切换为按进度降序」）：未指定排序时按创建时间降序；`sort=progress&order=desc` 时 `progress` 单调不增；验证：后端测试对含不同 `created_at` 与 `progress` 的固定数据集逐条断言返回顺序
- [ ] 6.7 列表视图筛选栏与空态（对应 Scenario「无命中结果」「清除筛选」）：筛选栏含平台/负责人/时间范围/关键字控件、排序选择器、单项清除与「清除筛选」按钮；验证：浏览器逐项操作——平台筛后列表条数与接口一致；组合条件无命中时显示「无匹配任务」空态与「清除筛选」入口且无报错；点「清除筛选」后全部未归档任务重新出现且筛选栏回默认值

## 7. B5 交付物全局搜索（task-explorer · Requirement「交付物全局搜索」）

- [ ] 7.1 搜索接口 `GET /api/deliverables/search?q=&limit=`：在 `deliverables` 上匹配文案包 `title`、`points`（卖点行）、`keywords` 与图片条目名称，返回任务 id、任务标题、`stage`、`kind`、当前 `version`、命中字段名、命中片段（含关键字上下文截取）与跳转信息；验证：后端测试断言按卖点命中（搜索「航空铝外壳」返回该任务且 `hitField` 为卖点、`snippet` 含该词）、按图片名命中（搜索「主图1」返回且 `stage = 'main-image'`）、`q` 为空时返回空数组而非全量（对应 3 个 Scenario：按卖点内容命中 / 按图片名称命中 / 空关键字）
- [ ] 7.2 无命中与上限（对应 Scenario「无命中」「结果上限」）：验证：后端测试断言不存在的关键字返回空数组与明确提示字段、无 5xx；构造命中数 > `limit` 的数据断言返回条数 ≤ `limit` 且响应含 `truncated: true`，`limit` 非法（负数/超大）时回落到安全默认值
- [ ] 7.3 搜索 UI 与结果可跳转（对应 Scenario「结果可跳转」）：在看板/列表页新增交付物搜索入口与结果列表（标注任务标题、阶段、版本、命中字段与片段），点击结果打开该任务详情并停留在「内容交付」tab；验证：浏览器搜索「航空铝外壳」→ 点击结果 → 任务详情打开且停留在内容交付 tab；搜索不存在的词显示「无命中」提示且无报错；未输入关键字时触发搜索显示「请输入关键字」且不返回全量

## 8. B6 关联资料失效的聚合计数（task-alerts · Requirement「关联资料失效的聚合计数」）

- [ ] 8.1 板块 B 只读批量聚合函数（`backend/src/knowledge/refs.ts` 新增 `countKbRefsByTask(taskIds: number[]): Map<number, { total: number; invalid: number }>`）：一条 SQL 取本次全部任务的 refs，复用既有 `isDocAvailable` 判定，并对本次涉及的 `doc_path` 做集合级去重判定 + 文档可用性缓存；验证：单测断言 3 个任务混合有效/失效资料时返回值与逐任务 `listTaskKbRefs` 判定结果完全一致，且同一 `doc_path` 只判定一次（用计数桩断言 `isDocAvailable` 调用次数 === 去重后 `doc_path` 数）
- [ ] 8.2 计数与失效判定一致（对应 Scenario「计数与失效判定一致」「全部有效」「无关联资料」）：验证：单测断言「关联 3 份、1 份被删」→ `{ total: 3, invalid: 1 }` 且与 `GET /api/tasks/:id/kb-refs` 中 `valid: false` 条数一致；「关联 2 份均存在」→ `{ total: 2, invalid: 0 }`；「从未关联」→ `{ total: 0, invalid: 0 }` 且无额外错误
- [ ] 8.3 接入 `GET /api/tasks` 并保证不 N+1（对应 Scenario「批量聚合不逐任务查询」）：在任务列表装配处把 `kbRefsTotal` / `kbRefsInvalid` 并到每条任务上；验证：后端测试用 spy 断言本次请求中批量聚合函数**只被调用 1 次**（与返回任务数 N 无关），并断言每条任务均含两个计数字段
- [ ] 8.4 知识库未连接时降级（对应 Scenario「知识库未连接时降级」）：板块 B 抛错或 Vault 未配置时捕获并让两计数归 0；验证：后端测试 mock 板块 B 抛错，断言 `GET /api/tasks` 状态 200、任务全量返回、两计数均为 0、响应不含 5xx 与未捕获异常日志
- [ ] 8.5 表结构与既有行为不变（不回归）：验证：`grep` 复核 `backend/src/knowledge/schema.ts` 的 `task_kb_refs` 建表 SQL 与 `refs.ts` 既有函数签名/实现未被改动（与 1.6 白名单对照），并对 `listTaskKbRefs` 跑既有知识库测试断言 0 failure

## 9. B6 失效角标提示（task-alerts · Requirement「失效角标提示」）

- [ ] 9.1 看板卡片角标（对应 Scenario「看板卡片显示角标」）：`kbRefsInvalid > 0` 时在卡片上显示「N 份关联资料已失效」（N 为实际失效份数），无失效不显示；验证：浏览器制造一个含 2 份失效资料的任务，断言该卡片角标文案为「2 份关联资料已失效」，同列其他任务不显示该角标
- [ ] 9.2 任务列表行角标：验证：浏览器在列表视图断言同一任务的失效角标文案与数字与看板一致，且无失效任务不显示
- [ ] 9.3 任务详情头部角标（对应 Scenario「任务详情头部显示角标」）：在阶段条以上区域显示同样角标；验证：浏览器打开该任务详情，头部角标数字与看板一致
- [ ] 9.4 点击角标定位（对应 Scenario「点击角标定位」）：点击后打开任务详情并滚动/切换到「关联知识库资料」面板；验证：浏览器点击看板卡片角标，断言详情打开且资料面板进入可见区域，同时断言任务 `column` / `stage` / 状态与点击前完全一致（不触发状态变更）
- [ ] 9.5 失效恢复后角标消失（对应 Scenario「失效恢复后角标消失」）：把被删除的资料放回 Vault 并重建索引后刷新列表；验证：浏览器断言角标消失且该任务 `kbRefsInvalid` 变为 0（用接口响应核对）
- [ ] 9.6 WS 推送不冲掉角标与负责人（对应 Scenario「WebSocket 推送不冲掉角标」）：在 `frontend/src/store/useWorkbench.tsx` 的 `upsertTask` 合并推送体时，对推送体缺失的 `ownerName` / `kbRefsTotal` / `kbRefsInvalid` 显式保留旧值；验证：单测对 `upsertTask` 传入不含这三个字段的 `task:update` 体，断言合并结果保留旧值；浏览器侧制造一次阶段推进广播，断言卡片角标与负责人名仍在（不闪失）

## 10. B8 渠道健康检查端点（channel-health · Requirement「渠道健康检查端点」）

- [ ] 10.1 端点与渠道选择顺序：新增 `POST /api/agents/:id/channel-test`，复用 `callLlm` 的渠道选择顺序（面板 `llmChannels[id]` → 主管视觉渠道（仅主管）→ `.env` 默认），请求体支持可选覆盖 `baseUrl` / `apiKey` / `model`；发起最小请求（固定短 prompt、`max_tokens` ≤ 16、`temperature = 0`、超时 15s）；响应恒为 `{ ok, latencyMs, model, baseUrlHost, error: { code, message } | null }`；验证：后端测试用假 LLM 服务器断言成功路径 `ok = true`、`latencyMs` 为大于 0 的整数、`model` 为生效模型、`error = null`（对应 Scenario「渠道正确返回绿色与延迟」）；并用请求体覆盖 `baseUrl` 断言实际请求打到覆盖地址（对应「测完再保存」的服务端前提）
- [ ] 10.2 错误分类：`not_configured`（无可用 apiKey，且**不发起外部请求**）/ `auth_failed`（401/403，message 含状态码与「apiKey 无效或已过期」）/ `model_not_found`（404 或模型相关 400，message 含被请求模型名）/ `connect_failed`（不可达，message 含「无法连接」与主机名）/ `timeout`（15s 预算，message 说明「请求超时（15s）」）/ `upstream_error` / `agent_error`；验证：后端测试逐类构造假服务器响应或不可达地址，断言 `error.code` 与 message 关键字，且不可达/超时用例的耗时在超时预算内（≤ 约 16s）（对应 4 个 Scenario：apiKey 填错 / 未配置渠道 / 连接不上 / 模型不存在 / 渠道超时）
- [ ] 10.3 测试不污染执行统计与 Agent 状态（对应 Scenario「测试不污染执行统计」「测试不改变 Agent 状态」）：健康检查不写 `agent_executions`、不调 `markBusy` / `markIdle`、不写 settings；验证：后端测试在测试前后分别统计 `agent_executions` 行数与 `GET /api/agents/:id/stats` 的 `runs`，断言完全一致；并断言 `online_status` / `activity` / `last_active_at` 与配置字段前后无变化
- [ ] 10.4 失败不返回 5xx、不存在的 Agent 返回 404（对应 Scenario「测试失败不返回 5xx」「不存在的 Agent」）：验证：后端测试断言所有失败场景均 HTTP 200 + `ok = false`；请求不存在的 Agent id 断言 404 与明确错误信息
- [ ] 10.5 不泄漏密钥（对应 Scenario「不泄漏密钥」）：验证：后端测试对全部错误场景断言响应体字符串不含 apiKey 明文或其任意 ≥ 6 字符片段（只允许出现主机名与模型名）；前端展示文本用同一断言规则复核 `AgentSettingsModal.tsx` 渲染路径
- [ ] 10.6 「渠道正常但 Agent 侧失败」的归因数据：健康检查成功时附带该 Agent 近期失败执行计数（复用 `executionStats` 的失败计数，不新增表），供面板展示「渠道正常，失败原因在 Agent 侧（见执行日志）」；验证：后端测试对「有失败执行记录」的 Agent 断言响应含失败计数 > 0，对无失败记录的 Agent 断言计数为 0

## 11. B8 设置面板测试渠道（channel-health · Requirement「设置面板测试渠道」）

- [ ] 11.1 面板按钮与结果展示（`frontend/src/features/workstation/AgentSettingsModal.tsx` 的「模型与 API」区块）：新增「测试渠道」按钮，绿色结果展示「延迟 812ms · 模型 deepseek-chat」类文案，红色结果展示失败原因与建议；验证：浏览器在设置面板点击「测试渠道」，渠道正常时按钮旁出现含实测延迟与生效模型的绿色文案，且表单字段内容与点击前逐字一致（对应 Scenario「面板展示绿色结果」）
- [ ] 11.2 红色结果与建议（对应 Scenario「面板展示红色结果与建议」）：鉴权失败时展示「渠道配置错误：apiKey 无效或已过期（HTTP 401）」类文案并给出「请检查 API Key 是否复制完整」建议；验证：浏览器把 apiKey 改为错误值后点击测试，断言出现红色文案且同时含「配置错误」「401」「建议」三要素
- [ ] 11.3 区分配置问题与 Agent 问题（对应 Scenario「区分配置问题与 Agent 问题」）：配置域错误（`auth_failed` / `connect_failed` / `not_configured` / `model_not_found`）文案归因「渠道配置错误」；测试成功但存在近期失败执行时提示「渠道正常，失败原因在 Agent 侧（见执行日志）」；验证：浏览器分别制造「apiKey 错误」与「渠道正常但该 Agent 有失败执行」两种情况，断言两种文案互斥出现且归属正确
- [ ] 11.4 未保存的改动不被测试改写（对应 Scenario「未保存的改动不被测试改写」）：验证：浏览器在表单填入新 apiKey（不保存）→ 测试 → 关闭弹窗重开，断言表单回到已保存配置；并断言 `GET /api/settings` 的 `llmChannels` 在测试前后完全相同（测试过程未写 settings）
- [ ] 11.5 测完再保存一致（对应 Scenario「测完再保存」）：验证：浏览器填入新 apiKey → 测试成功 → 点保存 → 断言保存后 `settings.llmChannels[agentId]` 与测试所用渠道一致（baseUrl/apiKey/model 三项）
- [ ] 11.6 测试进行中防重复（对应 Scenario「测试进行中防重复」）：进行中按钮为禁用/加载态，不并发发请求；验证：浏览器连续快速点击「测试渠道」，断言按钮处于禁用/加载态、网络面板中该端点请求数为 1；接口不可用时展示可见错误而不是静默
- [ ] 11.7 面板文案写明「测试不写入执行记录」：验证：浏览器断言设置面板测试区域存在该说明文案，且执行测试后 ObservabilityView 中不出现任何新增执行记录

## 12. B9 待确认浏览器通知（task-alerts · Requirement「待确认浏览器通知」+ 已拍板：标题闪烁降级）

- [ ] 12.1 通知模块（新建 `frontend/src/lib/approval-notify.ts` 或等价文件）：基于既有 WS `approval:prompt`（payload 含 `taskId` / `stage`）实现发送判定——`Notification.permission === 'granted'` **且** `document.visibilityState === 'hidden'` **且**用户开关为开才发送；以 `` `${taskId}:${stage}` `` 为去重键（同一 `(taskId, stage)` 只发一次）；验证：单测（jsdom 桩 `window.Notification` 与 `document.visibilityState`）覆盖四组：可见时不发、隐藏且已授权时发、重复广播只发 1 次、开关关闭时不发；并断言该模块不自动调用 `requestPermission`
- [ ] 12.2 通知内容与点击跳转（对应 Scenario「授权后收到通知」「点击通知跳转」）：通知标题含任务 `#id` 与阶段中文名（任务标题可得时一并带上），`onclick` 聚焦窗口并打开该任务详情；验证：浏览器已授权后切到其他标签页，令某任务进入待确认，断言系统通知出现且标题含 `#<id>` 与该阶段中文名；点击通知断言窗口被聚焦且展示该任务详情
- [ ] 12.3 页面可见时不打扰（对应 Scenario「页面可见时不打扰」）：验证：浏览器保持页面可见并聚焦，令任务进入待确认，断言只更新 TopBar 角标与既有 Toast、未产生浏览器通知
- [ ] 12.4 未授权/不支持静默降级（对应 Scenario「未授权静默降级」）：`typeof Notification === 'undefined'` 或授权被拒时静默 `return`，不 `throw`、不 `console.error`、不弹提示，页面角标与 Toast 照常；验证：浏览器（或以桩环境）分别模拟「未注册 Notification」「permission = denied」，断言控制台无 `error` 级别输出、无报错提示、待确认角标数值正确递增
- [ ] 12.5 权限不由页面自动索取（对应 Scenario「通知权限不由页面自动索取」）：仅在用户显式点击「开启通知」入口时调用 `Notification.requestPermission()`，入口仅当 `permission === 'default'` 时显示（`frontend/src/App.tsx` TopBar「任务」按钮附近）；验证：浏览器首次打开工作台时断言无权限弹窗且 Console 无 `requestPermission` 调用（可用桩计数器断言调用次数为 0），点击入口后授权弹窗出现
- [ ] 12.6 授权后立即生效（对应 Scenario「授权后立即生效」）：授权成功后无需刷新即可在后续待确认广播时发通知；验证：浏览器点击「开启通知」并允许 → 不刷新页面 → 切走标签页 → 令任务进入待确认 → 断言通知出现
- [ ] 12.7 标题闪烁降级（已拍板决策 ① 的第二条链路）：在通知不可用路径（未授权 / 不支持 `Notification` / 用户开关关闭）改为 `document.title` 交替闪烁（携待确认数量，如 `(1) 待确认 · <原名>`），并在窗口获得焦点时复位为原名；验证：浏览器在 `permission = denied`（或关闭开关）条件下令任务进入待确认，断言 `document.title` 在 ≥1s 内发生交替变化且含待确认条数；点击回窗口后断言标题复位为原始文案
- [ ] 12.8 标题闪烁不产生副作用：闪烁定时器在全部待确认项清空或窗口聚焦时停止（用句柄断言无泄漏），不叠加多个定时器；验证：连续触发 3 次待确认后聚焦窗口，断言定时器已清空（桩计数为 0）、标题为原名、控制台无 `error`

## 13. B9 通知开关可关闭（task-alerts · Requirement「通知开关可关闭」）

- [ ] 13.1 开关 UI 与状态：在 `frontend/src/App.tsx` 的 TopBar 区域提供通知开关（含当前权限状态展示），状态存 `localStorage`（纯本地，不落库、不走接口）；验证：浏览器打开工作台，存在可见开关且初始取值来自 `localStorage`；断言未向服务端新增任何设置键（对比 `GET /api/settings` 键集合前后一致）
- [ ] 13.2 关闭后不再推送（对应 Scenario「关闭通知后不再推送」）：验证：浏览器把开关切到关闭 → 切走标签页 → 令任务进入待确认 → 断言不发浏览器通知，且页面角标照常更新、既有 Toast 照常
- [ ] 13.3 开关状态持久化（对应 Scenario「开关状态持久化」）：验证：关闭后刷新页面，断言开关仍为关闭（读自 `localStorage`），并断言此时触发待确认为静默 + 标题闪烁降级路径

## 14. B12 Token 采集与估算（task-cost · Requirement「Token 采集与估算」）

- [ ] 14.1 `callLlm` 返回 `usage`（`backend/src/agents/llm.ts`）：签名改为返回 `LlmResult = { content: string; usage?: { promptTokens: number; completionTokens: number } }`，解析响应 `usage.prompt_tokens` / `usage.completion_tokens`；验证：单测用假 LLM 服务器分别返回「含 usage」与「不含 usage」两种响应，断言前者取到真实值、后者 `usage` 为 `undefined` 且 `content` 正确
- [ ] 14.2 三处调用点同步适配（`backend/src/agents/chat-reply.ts`、`backend/src/agents/smart-producer.ts` ×2）：必须与 14.1 同批完成；验证：`pnpm -r typecheck` 与 `pnpm build` 0 error（含既有多模态视觉审阅路径不受影响），且既有单测 0 failure
- [ ] 14.3 执行日志记录 token（`backend/src/agents/execution-logger.ts` + `backend/src/engine/service.ts` 透传）：真实 usage 存在时写真实值，缺失时按 `Math.ceil(字符数 / 4)` 对「输入摘要 + 输出摘要」估算写入（非 0）；验证：单测断言含 usage 时 `input_tokens = 812`、`output_tokens = 344`（对应 Scenario「渠道回传真实 usage」）；不含 usage 时两列均为非 0 估算值（对应 Scenario「渠道未回传 usage 时估算」）
- [ ] 14.4 生图阶段 token 为 0 且不影响口径（对应 Scenario「图片类执行不产生 token」）：验证：单测断言生图阶段执行记录两列均为 0，且 `GET /api/tasks/:id/cost` 的 token 汇总只累加 LLM 调用记录（构造 1 条 LLM + 1 条生图，断言汇总等于 LLM 那一条）
- [ ] 14.5 既有列语义不变（对应 Scenario「既有列语义不变」）：验证：后端测试断言 `GET /api/executions` 返回的 `durationMs` / `model` / `status` / `outputSummary` 等既有字段名称与取值与改动前一致（token 为新增字段），并对改动前的固定数据集做一次快照比对

## 15. B12 任务级汇总与费用估算（task-cost · Requirement「任务级执行汇总接口」「费用估算（有单价表才算）」）

- [ ] 15.1 汇总接口 `GET /api/tasks/:id/cost`：基于 `agent_executions` 中 `task_id = <id>` 的记录聚合 `totalDurationMs` / `runs` / `successRuns` / `failedRuns` / `byStage`（阶段键 + 中文阶段名 + 次数 + 耗时合计）/ `byAgent`（agentId + Agent 名 + 次数 + 耗时合计）/ `models`（去重）/ `firstStartedAt` / `lastFinishedAt`；纯只读；验证：后端测试断言 3 次成功执行（1200/3000/800）→ `totalDurationMs = 5000`、`runs = 3`、`successRuns = 3`、`failedRuns = 0`（对应 Scenario「聚合阶段耗时合计」）
- [ ] 15.2 分组与模型列表（对应 Scenario「按阶段与按 Agent 分组」「模型列表」）：验证：后端测试断言 `copy` 阶段 2 次 + `main-image` 阶段 1 次时 `byStage` 含对应条目且耗时合计正确、阶段键带中文名，`byAgent` 各 Agent 次数正确；执行中出现 `deepseek-chat` 与 `gpt-image-2` 时 `models` 同时含两者
- [ ] 15.3 空态与 404（对应 Scenario「无执行记录」「任务不存在」）：验证：后端测试断言无执行记录任务返回 200 + `runs = 0` + `totalDurationMs = 0` + `byStage`/`byAgent`/`models` 均为空数组；不存在任务返回 404 与明确错误信息
- [ ] 15.4 失败执行也计入（对应 Scenario「失败执行也计入」）：验证：后端测试断言 1 次成功 + 1 次失败 → `runs = 2`、`failedRuns = 1`、`successRuns = 1`，且失败执行耗时被计入 `totalDurationMs`
- [ ] 15.5 token 汇总（对应 Scenario「token 汇总」「渠道未回传 usage 时估算（tokensEstimated）」）：汇总响应含 `tokens.input` / `tokens.output` / `tokens.total` 与 `tokensEstimated`；验证：后端测试断言输入 800+1200、输出 300+500 → `input = 2000`、`output = 800`、`total = 2800`；存在任一估算记录时 `tokensEstimated = true`，全部为真实 usage 时为 `false`
- [ ] 15.6 单价表读取与估算（`settings.modelPricing`，沿用 `getSetting`）：单价表结构 `{ "<model>": { inputPer1M, outputPer1M, currency } }`；仅当模型命中条目时计费并按货币汇总为 `cost = { currency, amount, estimated: true, pricingSource: 'settings.modelPricing' }`；验证：后端测试配置 `deepseek-chat` 输入 1 元/百万、输出 2 元/百万 + 消耗输入 1,000,000 / 输出 500,000，断言 `amount ≈ 2.0`、`currency = 'CNY'`、`estimated = true`（对应 Scenario「有单价表时给出估算费用」）
- [ ] 15.7 无单价表不给金额（对应 Scenario「无单价表时不给金额」）：`settings.modelPricing` 未配置时 `cost = null`，token 与耗时字段照常返回；验证：后端测试断言 `cost === null` 且 `tokens` / `totalDurationMs` 字段齐全，响应中不出现任何金额数值字段
- [ ] 15.8 部分模型未计价（对应 Scenario「单价表缺该模型」「截图/生图费用不臆造」）：只对覆盖模型计费，未命中模型列入 `unpricedModels`，`cost` 说明体现「部分模型未计价」；生图不产生 token 计费、不臆造单价或金额；验证：后端测试对「单价表只配 `deepseek-chat` 但任务还用了 `gpt-image-2`」断言 `unpricedModels` 含 `gpt-image-2`、`cost` 说明字段含「部分模型未计价」；对纯生图任务断言 token 计费为 0 且 `cost` 不为生图臆造金额
- [ ] 15.9 单价默认值放本地、不入版本库（已拍板决策 ②）：开发期查公开计价资料（DeepSeek 等）整理默认单价，写入**本地配置**（`backend/data/` 下已被 `.gitignore` 排除的位置，或经 `PUT /api/settings` 落到本地 `settings` 表），源码中不硬编码任何价目常量；验证：`grep` 断言源码（`backend/src/**`、`packages/shared/src/**`）内不存在 `inputPer1M` 数值字面量/价目表常量；`.gitignore` 覆盖该本地配置文件（`git check-ignore` 退出码为 0）；未配置时接口返回 `cost = null`（与 15.7 一致）；查询来源与填入的默认值记录到 `openspec/changes/delivery-ops/` 内的验证记录文件

## 16. B12 任务详情成本卡片（task-cost · Requirement「任务详情成本卡片」）

- [ ] 16.1 成本汇总卡片（`frontend/src/features/status/TaskDetailView.tsx` 的「任务详情」tab）：展示人类可读的阶段耗时合计（如 `8.2s` / `3m 12s`）、执行次数（成功/失败）、按阶段耗时明细、涉及模型、token 数与（`cost != null` 时）估算金额；验证：浏览器打开一个已开工任务的「任务详情」tab，断言卡片上的总耗时、执行次数与阶段明细数字与 `GET /api/tasks/:id/cost` 返回值逐项一致（对应 Scenario「展示耗时合计与阶段明细」）
- [ ] 16.2 标注估算（对应 Scenario「标注估算」）：`tokensEstimated = true` 时 token 文案必须含「估算」字样且不使用「消耗」等确定性措辞；验证：浏览器构造一次无 usage 的调用后断言卡片 token 文案含「估算」、不含「消耗」；构造真实 usage 时断言标注为「实测」
- [ ] 16.3 无单价表时不显示金额（对应 Scenario「无单价表时不显示金额」）：`cost = null` 时卡片内不出现任何金额（含 `0` / `—` 元之类占位）；验证：浏览器在未配置 `settings.modelPricing` 时打开卡片，断言页面文本中不含「元」「¥」「CNY」等金额相关字样，只显示耗时与 token
- [ ] 16.4 空态（对应 Scenario「空态」）：无执行记录时显示「尚无执行记录」空态文案，不显示 0 值数字、不报错；验证：浏览器打开一个尚未开工的任务的「任务详情」tab，断言出现该文案、页面无 `0s`/`0 次` 类数字、Console 无 error

## 17. 集成与回归验收（跨条目，必须全绿）

- [ ] 17.1 后端测试全绿：`pnpm --filter ./backend test` 0 failure，新增用例覆盖 2.1-2.7、3.1-3.8、4.1-4.9、6.1-6.6、7.1-7.2、8.1-8.4、10.1-10.6、14.1-14.5、15.1-15.8 的全部断言点
- [ ] 17.2 前端单测与构建：前端新增单测（12.1、12.7、9.6）全部通过，`pnpm typecheck` 与 `pnpm build` 均 0 error（对应主文档 T4 验收标准 8 前半）
- [ ] 17.3 端到端实测（对应主文档 T4 验收标准 1-7）：① B3 同一交付物两版本可差异对照且差异项明确；② B4 归档任务交付包可下载且解压含文案与全部已采纳图片；③ B5 四个维度筛选均生效 + 交付物全局搜索可用；④ B6 存在失效关联资料的任务看板角标可见且数量正确；⑤ B8 填错 apiKey → 红色 + 失败原因，填对 → 绿色 + 延迟；⑥ B9 授权后任务进待确认时收到系统通知（未授权时静默降级不报错）；⑦ B12 任务详情可见阶段耗时合计与估算成本；验证：七条逐条在浏览器中执行通过，并把截图/接口响应记录到 `openspec/changes/delivery-ops/` 内的验证记录文件
- [ ] 17.4 不回归 · 看板与任务流转：跑一遍「确认开工 → 文案采纳 → 主图逐张采纳 → 详情图采纳 → 校对放行 → 归档 → 恢复」，验证：看板 4 列渲染、归档过滤、Approve/Reject 决策链路、任务状态与阶段推进行为与改动前完全一致；归档任务不出现在列表视图但可在「已归档任务」中查看与恢复
- [ ] 17.5 不回归 · 内容交付与审批决策：验证：既有 copy/image 交付物展示、逐张采纳/打回、`allImagesDecided` 判定、`deliverables` 既有字段与状态机行为不变（跑既有相关单测 0 failure，并浏览器核对一个含 mixed 状态图片批次的任务详情）；B3 的版本留档不影响当前交付物读写（同一任务连续产出两次后，当前交付物字段与只产出一次的结果结构一致）
- [ ] 17.6 不回归 · 板块 B 表域与行为：验证：`task_kb_refs` 建表 SQL 与既有读写函数**零改动**（与 1.6 白名单逐条对照 + `git diff --stat` 复核仅新增只读导出函数），知识库索引/搜索/星图/详情既有测试 0 failure；B6 计数与 `GET /api/tasks/:id/kb-refs` 判定一致；B9 通知不依赖任何服务端改动（`backend/` 侧无新增通知相关代码）
- [ ] 17.7 降级边界复核：① 知识库未连接（Vault 清空）→ `GET /api/tasks` 照常返回、计数为 0、角标不出现；② 板块 B 读取异常 → 同上且无 5xx；③ 通知未授权/不支持/开关关闭 → 静默降级 + 标题闪烁，Console 无 error；④ 外链图片取不回 → 交付包仍可下载且标注缺失数量；⑤ 未配置单价表 → 成本卡片无任何金额；验证：五条逐项在浏览器/接口层执行通过
- [ ] 17.8 无新增运行时依赖：验证：`git diff` 复核 `backend/package.json`、`frontend/package.json`、`packages/shared/package.json` 的 `dependencies` / `devDependencies` 无新增条目（ZIP 用 `node:zlib`、通知用浏览器原生 `Notification`），且 `pnpm-lock.yaml` 无因本 change 产生的依赖变更
- [ ] 17.9 工件一致性与收尾：把实现期产生的偏差（最终函数名、接口路径、`X-Deliverable-Missing` 与清单字段名、版本保留上限常量、标题闪烁触发阈值）回写到 `design.md` / `proposal.md` 的对应描述（只改与本 change 实现不一致处），并在 `openspec/changes/delivery-ops/` 内记录已知偏差（含 design D3 声明的「上线前中间版本不可恢复」）；验证：`openspec validate delivery-ops` 通过（`--strict` 亦通过），`openspec status --change delivery-ops --json` 四个工件（proposal / specs / design / tasks）均为 `done`
