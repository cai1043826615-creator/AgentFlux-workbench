> **change 边界（用户已确认）**：热点只是「环境情报」，**绝不决定「做什么产品」**（`docs/优化方向-2026-09-11-知识库与工作流.md` §0.1）。本清单**第 1 组（边界修订）必须最先完成且单独提交**——它改的是既有能力语义（移除「热点创建任务」）；第 2–5 组在其之上并行推进（§3.6）。
> **前置核实（已做）**：`docs/相关设计文件/热点多信息源调研.md` **不存在** → 第 3 组只做「可插拔框架 + 至少 2 个非 AI 行业源」的**接入机制**，具体端点留待调研报告/用户指定（见 design.md OQ-1、OQ-2），**不得编造端点**。
> **不做**：改板块 A 状态机、改 `task_kb_refs` 表结构、修改 `openspec/changes/knowledge-base/` 下任何文件、引重型依赖。

## 1. 边界修订：移除「热点创建任务」，热点降为只读情报（**必须最先、单独提交**）

- [ ] 1.1 移除前端入口：删除 `frontend/src/features/knowledge/HotView.tsx` 中 `HotCard` 的「创建任务」按钮与 `toTask`（含 `openNewTask` 引用），热点卡片只保留查看类操作
  - 验证：`grep -rn "创建任务" frontend/src/features/knowledge/` 无结果；在浏览器打开热点页，任意层任意卡片上不存在「创建任务」按钮（截图留证）
- [ ] 1.2 拆除预填链路：`frontend/src/store/useWorkbench.tsx` 删除 `newTask.prefill` 字段与 `openNewTask` 的 `prefill` 形参；`frontend/src/App.tsx` 删除 `NewTaskModal` 中对 `newTask.prefill` 的应用（含 `useEffect` 依赖与重置分支）
  - 验证：`grep -rn "prefill" frontend/src` 无结果；`pnpm -C frontend typecheck`（或既有 typecheck 脚本）0 error，构建通过
- [ ] 1.3 后端语义收口：核对 `backend/src/routes/knowledge.ts` / `hot.ts` 不提供任何「热点 → 任务」的写入端点；`POST /api/tasks` 的入参不含热点字段
  - 验证：`curl` / `app.inject` 遍历热点相关路由（`GET /api/hot`、`GET/PUT /api/hot/attention`），确认无任何响应字段或端点可用于派生任务；`POST /api/tasks` 提交含 `hot`/`hotRefs` 字段体不改变任务语义（被忽略而非落库）
- [ ] 1.4 边界回归测试：新增后端测试断言「热点面板 → 任务」通路不存在
  - 验证：测试用例断言 ① 热点模块导出的函数集合中不存在创建任务的函数；② 调用 `POST /api/tasks` 只接受 `title/description/platforms/referenceImage/workflowId/kbRefs`，传入热点形状的额外字段后任务数与内容不变；测试在全量 `pnpm -C backend test` 中通过
- [ ] 1.5 交互回归：从热点页走到新建任务，确认表单为空且不含热点内容
  - 验证：浏览器操作序列（热点页 → 左侧栏/看板「新建任务」）后，标题与描述输入框为空；对 `#7` 型的「Apple 发布首款折叠屏 iPhone Duo」条目重复该序列，表单不出现该热点内容（截图留证）

## 2. 热点背景（hot-context）：手动挂为任务背景 + 注入标注

- [ ] 2.1 共享契约：`packages/shared/src/knowledge.ts` 新增 `TaskHotRef` / `TaskHotRefInput`（含 `hotId/title/sourceId/sourceName/evidence/url/latestAt/createdAt/valid`）与 `HOT_HOT_REF_LIMIT`（参照 `KB_REF_LIMIT`）
  - 验证：`pnpm -C packages/shared typecheck` / 构建 0 error；类型被前后端 import 成功
- [ ] 2.2 数据表：`backend/src/knowledge/schema.ts` 新增独立表 `task_hot_refs`（`task_id`, `hot_id`, `title`, `source_id`, `source_name`, `evidence`, `url`, `latest_at`, `created_at`，`UNIQUE(task_id, hot_id)`，`INDEX(task_id)`），沿用幂等 `ensureSchema`
  - 验证：启动后端两次不报错（幂等）；`PRAGMA table_info(task_hot_refs)` 与设计一致；`PRAGMA table_info(task_kb_refs)` 与改动前**逐列一致**（未被动过）
- [ ] 2.3 存储层：新增 `backend/src/knowledge/hot-refs.ts`——`setTaskHotRefs(taskId, refs)`（去重、上限校验）、`listTaskHotRefs(taskId)`（含 `valid` 失效标记）、`clearTaskHotRefs(taskId)`、`hasTaskHotRefs(taskId)`
  - 验证：单测覆盖 ① 同一 `hot_id` 重复写入只留 1 条；② 超过上限抛业务错误；③ 移除后列表不再包含；④ 操作 `task_hot_refs` 前后 `task_kb_refs` 行数与内容不变
- [ ] 2.4 路由：`backend/src/routes/knowledge.ts` 新增 `GET /api/tasks/:id/hot-refs`、`PUT /api/tasks/:id/hot-refs`（非法 id → 400；上限 → 400 带可读文案）
  - 验证：`app.inject` 用例 ① GET 空任务返回 `{refs: []}`；② PUT 2 条后 GET 返回 2 条且字段完整；③ 重复 PUT 同一条 → 仍 1 条；④ 超额 → 400 且错误信息可读；⑤ 以上请求后 `task_kb_refs` 不变
- [ ] 2.5 注入通道（**共享改动点，只在 `buildKnowledgeContext` 之后追加**）：`backend/src/knowledge/refs.ts` 的热点段组装 —— 标题为「【任务背景 · 外部环境情报】」，含「不得作为产品品类/主体/功能规格依据」「仅用于合规、话术与时点参考」，逐条标注来源/证据等级/数据时间/原文链接；无背景时返回空串
  - 验证：单测断言 ① 无热点背景时 `buildProducerSystemPrompt` 输出与改动前**逐字节一致**；② 有背景时同时存在「关联知识库资料」段与「外部环境情报」段且两段均可区分；③ 热点段含禁用作产品主体的约束语句；④ 热点源不可用（面板 `stale`/`unavailable`）时仍能用持久化快照注入
- [ ] 2.6 与 T1 分工核对：确认 `backend/src/agents/smart-producer.ts` 的 `buildProducerSystemPrompt` 既有块顺序与知识库段未被本 change 改动，热点段为追加
  - 验证：`git diff -- backend/src/agents/smart-producer.ts` 仅出现「追加热点段」的改动；打回意见（T1 B2）+ 知识库段 + 热点段三者在同一 prompt 中共存且互不覆盖（用例断言三段 substrings 均存在）
- [ ] 2.7 前端任务详情：`frontend/src/features/status/TaskDetailView.tsx` 新增「任务背景 · 外部环境情报」区块（列表 + 关联/移除 + 失效标记 + 原文外链），与既有「关联知识库资料」区块并列且视觉可区分；`frontend/src/lib/api.ts` 新增 `taskHotRefs` / `saveTaskHotRefs`
  - 验证：浏览器操作 ① 任务详情关联 2 条热点 → 列表出现 2 条且含来源/证据等级/时间/链接；② 刷新页面后仍在；③ 移除 1 条后列表剩 1 条；④ 未关联任何背景的任务不出现该区块（不占位）
- [ ] 2.8 热点卡片入口：`HotView.tsx` 卡片提供「挂为任务背景」（选择已存在任务），**不产生新任务**
  - 验证：浏览器操作后，目标任务详情出现该热点；操作前后任务总数不变（看板计数一致）
- [ ] 2.9 独立性回归：热点源全部不可用 / 未关联背景时，板块 A 全流程（新建→确认→产出→拍板→归档）与既有行为一致
  - 验证：在 `WORKBENCH_HOT_ALL_FAIL=1`（或等效测试注入，实现期确定）下跑后端全量测试全绿；手动跑一遍板块 A 流程无新增错误

## 3. 多源接入（B10）：可插拔框架 + ≥2 个非 AI 行业源 + 单源降级

- [ ] 3.1 共享契约：`packages/shared/src/knowledge.ts` 扩展 `HotItem`（`sourceId`/`sourceName`/`vertical`/`evidence`/`latest`）与 `HotPanel`（`sources: HotSourceStatus[]`、`daily?: HotDailyInfo`、`counts.selected24h`）；新增 `HotSourceConfig` / `HotSourceStatus` / `HotEvidenceLevel = 'multi-source' | 'single-source' | 'traceable'`
  - 验证：共享包 typecheck/build 0 error；新增字段均为**可选或带默认**，现有前端在未更新前不因缺字段崩溃（临时用例）
- [ ] 3.2 适配器框架：新增 `backend/src/knowledge/hot-sources/types.ts`（`HotSourceAdapter` 接口：`id`/`label`/`vertical`/`capabilities`/`fetchAll(timeoutMs)`）+ `hot-sources/index.ts`（注册表 + 按 `sources[]` 配置实例化 + 未知 adapter 优雅忽略）
  - 验证：单测 ① 注册表能按配置解析出适配器列表；② 配置里出现未知 adapter id 时被忽略且不抛错（面板仍可用）
- [ ] 3.3 迁移既有源为适配器：把 `hot.ts` 现有 aihot 逻辑（`fetchJson` + `/api/v1/hot-topics` + `/api/v1/items?mode=selected&window=24h&limit=20` + `stories/:id` 补摘要）下沉为 `hot-sources/aihot.ts`，`vertical` 标为 AI 行业聚合
  - 验证：单测用固定 JSON fixture 断言 aihot 适配器归一化输出与迁移前 `normalizeHotTopics`/`normalizeSelected` 的结果**逐条等值**（回归护栏）；`hot.ts` 中不再残留 aihot 专用字段解析
- [ ] 3.4 接入 ≥2 个非 AI 行业源（覆盖平台规则/促销节点/品类趋势/竞品动态）：按调研报告或用户指定端点新增 2 个以上适配器文件并加入默认源列表
  - 验证：默认配置下实际拉取结果中，非 AI 行业源贡献的条目数 > 0，且其 `capabilities` 合计覆盖 4 类关注域中的 ≥2 类；**若调研文件仍缺失且用户未指定端点：本任务转为「用本地 fixture + 可配置端点占位」，并在 tasks 备注中标注阻塞原因（见 design.md OQ-1/OQ-2），不得编造真实端点**
- [ ] 3.5 源配置可编辑：`attention.ts` 的 `normalizeAttention`/`loadAttentionConfig`/`saveAttentionConfig` 支持 `sources[]`（`id`/`adapter`/`label`/`endpoint`/`vertical`/`enabled`/`enterpriseCredentialRequired`/`tierCap`）；`HotView` 的关注域配置弹窗可增删改源与启停；旧 `sourceBaseUrl` 映射为「仅启用 aihot」
  - 验证：单测 ① 旧配置（只有 `sourceBaseUrl`）加载后可正常拉取且不报错；② 禁用某源后该源条目消失；③ 新增源配置后无需改聚合代码即生效
- [ ] 3.6 聚合与单源降级：`hot.ts` 的 `loadHotPanel` 改为按启用源并发 `Promise.allSettled`，每源独立归一化、全局去重（id + 标题）、聚合 `counts`（`upstream`/`mustRead`/`browse`/`other`/`selected24h`）与 `sources[]` 状态；单源失败仅标降级，全部失败才走 `stale`/`unavailable`
  - 验证：单测（注入 mock 适配器）① 3 源中 1 源抛错/超时 → 面板 `status === 'live'`、其余 2 源条目存在、失败源状态为 `degraded` 且含原因；② 全部源失败 + 有缓存 → `stale`；③ 全部失败 + 无缓存 → `unavailable`；④ `counts.upstream` 等于去重后条目总数
- [ ] 3.7 证据等级判定：归一化阶段按「独立信源数 + 是否有可访问原文外链」判定 `evidence`（≥2 信源 → `multi-source`；1 信源且有外链 → `traceable`；否则 `single-source`），并在面板与注入中透出
  - 验证：单测用构造条目断言三种等级的判定边界（`sourceCount=2/1` × `url` 有/无）；前端卡片上等级标签可用于断言（DOM 断言或快照）
- [ ] 3.8 源状态可见：面板展示 `sources[]`（源名 + 状态 + 降级原因），与整体 `live`/`stale`/`unavailable` 状态不冲突
  - 验证：人为让 1 源失败后截图，源状态区可见「该源降级 + 原因」且整体仍为实时；四类状态（`ok`/`degraded` × 面板 `live`/`stale`）各有一张留证截图

## 4. 降噪规则（排除词 / 多词命中 / 源权重）

- [ ] 4.1 共享契约与配置：`AttentionDomain` 增加 `excludeKeywords?: string[]`、`minKeywordHits?: number`；`AttentionConfig.sources[].tierCap?: HotTier`；`normalizeAttention` 缺省回退（排除词空、阈值默认 2、tierCap 默认 `browse` 用于非电商垂直源）
  - 验证：单测 ① 旧配置加载后 `minKeywordHits === 2`、`excludeKeywords` 为空数组；② 非法值（0、负数、非数字）回退默认；③ 显式配置被保留
- [ ] 4.2 匹配逻辑：`matchDomains` 落实「排除词命中 → 该域直接不成立」与「同一关注域命中不同关键词数 ≥ `minKeywordHits` 才成立」（同一关键词重复出现只计 1 次）
  - 验证：单测 ① 文本含排除词 + 命中 2 个关键词 → 该域不成立；② 只命中 1 个关键词（阈值 2）→ 不成立；③ 命中 2 个不同关键词 → 成立；④ 同一关键词出现 3 次且阈值为 2 → 不成立
- [ ] 4.3 分层逻辑：`classifyHot` 应用源 `tierCap`——非电商垂直源条目**最高只进「浏览」**，电商垂直源条目才允许进「必看」；`mustRead` 条件为「域成立 + `sourceCount >= minimumSources` + tierCap 允许 mustRead」
  - 验证：单测 ① AI 行业聚合源条目（域成立、`sourceCount=5`）落入 `browse`，不在 `mustRead`；② 电商垂直源条目（域成立、`sourceCount=2`）落入 `mustRead`；③ 每层仍按 `mustReadLimit`/`browseLimit`/`otherLimit` 截断；④ 阈值/排除词清空后行为等价于旧逻辑（回归等价用例）
- [ ] 4.4 默认配置落排除词：`DEFAULT_ATTENTION` 为噪声最重的域配置 `excludeKeywords`（`competitor`：至少含 `Apple`/`iPhone`/`大模型`/`模型发布`；`promo`：至少含 `发布会`/`开发者大会`）与 `minKeywordHits: 2`
  - 验证：默认配置下 4.5 的 corpus 用例全部通过；把 `competitor.excludeKeywords` 清空后，Apple 发布会条目**重新**进入必看/浏览（证明规则真的在生效，而非样本本身不命中）
- [ ] 4.5 固定样本回归（用户明确要求）：新增固定语料 `backend/src/knowledge/__tests__/fixtures/hot-noise-corpus.ts`（≥20 条，必含实证反例：`Apple 发布首款折叠屏 iPhone Duo，$1,999`、`DeepSeek 发布新模型`、`某平台发布新规（真·平台规则）`、`双11 预售开启（真·促销节点）`、`某品类销量同比增长（真·品类趋势）`），为每条标注期望层级
  - 验证：新增测试用该 corpus 跑 `classifyHot` 并断言**逐条**层级等于期望值（写死期望，不许按当前输出反向填）；语料与期望同文件提交，供后续回归复用
- [ ] 4.6 噪音下降的可量化结论：断言「今日必看」层不再出现与电商无关的条目，并记录下降幅度
  - 验证：测试输出新旧对比（改动前 vs 改动后，同一 corpus 下 `mustRead` 中噪音条目数从 N 降到 0），把数值写入 `docs/测试文件/` 之外的 change 内说明（本节 tasks 完成备注）；`pnpm -C backend test` 该用例断言噪音条目数 === 0
- [ ] 4.7 配置 UI 与生效链路：`HotView` 的关注域配置弹窗支持编辑排除词与多词命中阈值，保存后重新拉取即生效
  - 验证：浏览器操作 ① 在弹窗中为某域填排除词并保存；② 刷新热点 → 对应条目从必看/浏览消失；③ `backend/config/attention.json` 中出现该字段（本地文件，不入版本库）

## 5. 排版重做（A4）：统计药丸 / 信息条 / 序号 / 证据等级 / 双层内容 / 响应式多栏 / 三态

- [ ] 5.1 顶部三枚统计药丸：`HotView.tsx` 用「多源热点 / 今日必看 / 24H 精选」三枚 bordered pill 替代一行纯文字计数（数值取 `counts.upstream` / `counts.mustRead` / `counts.selected24h`，前端不重算）
  - 验证：浏览器截图可见三枚药丸与数值；DOM/快照断言三枚药丸存在且数值等于接口 `counts` 对应字段
- [ ] 5.2 信息条：展示数据源新鲜度（数据时间 / 缓存至 / 源状态摘要）+ **上游日报外链**（形如「AI 日报 2026-09-11 · 16 条 · 北京时间 08:00 发布」+「打开日报 ↗」）；无日报信息时退化为仅新鲜度且不报错
  - 验证：浏览器截图可见信息条与可用外链（`target="_blank"` + `rel="noreferrer"`）；用无 `daily` 字段的 fixture 跑一次，页面无空标题/无报错
- [ ] 5.3 卡片序号：每层卡片按展示顺序渲染 `01`/`02`/`03`…（等宽数字，两位补零）
  - 验证：截图可见序号；DOM 断言第一层序号序列为 `01`,`02`,`03`
- [ ] 5.4 证据等级标签 + 领域标签：卡片同时展示证据等级（多源事件 / 单源 / 可回查原文，映射 `multi-source`/`single-source`/`traceable`）与命中的领域标签
  - 验证：DOM 断言三类证据等级的文案映射正确；构造三种条目各出现一次并截图
- [ ] 5.5 双层内容：卡片分 `讯息`（摘要）与 `最新进展` 两层；**无 `latest` 时隐藏「最新进展」层**（不留空标题/空占位）
  - 验证：DOM 断言「有 latest 的卡片存在『最新进展』标题」「无 latest 的卡片不存在该标题且无空容器」；两种卡片同屏截图
- [ ] 5.6 响应式多栏网格 + 衬线大标题：CSS Grid 三档（`≥1440px` 三栏 / `1024–1439px` 两栏 / `<1024px` 单栏），标题用衬线 Display（既有 `font-display`）
  - 验证：三档视口（1440 / 1024 / 640）各截图一张，肉眼与 DOM 计算样式（`grid-template-columns` 的列数）均符合；标题 `font-family` 含衬线 Display
- [ ] 5.7 三态降级提示强化：`live` 不显示提示条；`stale` 显示「展示最近一次缓存内容」+ 缓存时间 + 失败原因；`unavailable` 显示「热点源暂不可用」+ 原因 + 可重试刷新 + 「不影响知识库其他功能与工作流板块」；三态色调与文字可区分
  - 验证：三态各构造一次并截图；DOM 断言 `live` 无降级提示条、`stale`/`unavailable` 提示条含规定文案与缓存时间
- [ ] 5.8 可读性比对：与参考页 `http://127.0.0.1:5173/daily-hot` 并排比对（统计药丸/信息条/序号/标签/双层/多栏五项逐项打勾）
  - 验证：产出一张并排比对截图 + 五项逐项确认清单（写入本 change 的 tasks 完成备注，不新增 docs 文件）；五项均达标

## 6. 集成、构建与验收

- [ ] 6.1 后端全量测试：`pnpm -C backend test` 全绿（含既有 `executor.smoke` / `knowledge.test` / `workflow-context.test` / `api.smoke` 与新用例）
  - 验证：命令输出无失败；新增用例数可报出
- [ ] 6.2 前后端 typecheck + build：0 error
  - 验证：`pnpm -C backend typecheck`（或 `build`）、`pnpm -C frontend build`（或既有 typecheck/build 脚本）均成功退出
- [ ] 6.3 OpenSpec 校验：`openspec validate hot-intel` 通过
  - 验证：命令输出 `Change 'hot-intel' is valid`；`openspec status --change hot-intel --json` 四个工件（proposal / specs / design / tasks）均为 `done`
- [ ] 6.4 端到端联调：热点页（多源 + 降噪分层 + 排版）→ 任务详情手动挂热点背景 → Agent 执行 → 检查最终 system prompt 含「外部环境情报」段
  - 验证：跑通全链路并留证（接口返回 + prompt 片段 + 截图）；同时确认从热点**无法**创建任何任务
- [ ] 6.5 板块独立性回归：热点全源不可用、知识库未连接两种情况下，板块 A 全流程照常；`task_kb_refs` 未被本 change 改动
  - 验证：两种故障态下跑板块 A 全流程无新增错误；`git diff` 中无 `task_kb_refs` 表结构改动；T4/T1 依赖的 `task_kb_refs` 读取行为不变
- [ ] 6.6 提交粒度：第 1 组单独一个中文 conventional commit，第 2–5 组按条目各自提交（§七.5）
  - 验证：`git log --oneline` 可见至少 5 个提交，第 1 组（边界修订）为其中最早且不含其他条目的改动
