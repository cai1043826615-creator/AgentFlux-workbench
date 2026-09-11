## Context

`docs/优化方向-2026-09-11-知识库与工作流.md` 是本次四个梯队的**唯一事实来源**。本 change（T3 · `hot-intel`）负责其中 §3.1（边界修订）、§3.2（A4 排版）、§3.3（B10 多源）、§3.4（降噪）四项，验收基线见 §3.5。

现状（已读代码确认）：

- `backend/src/knowledge/hot.ts`：单源硬编码——`fetchJson(baseUrl, '/api/v1/hot-topics')` + `fetchJson(baseUrl, '/api/v1/items?mode=selected&window=24h&limit=20')` 两路 `Promise.all`，再逐条 `Promise.allSettled` 补 `stories/:id` 摘要；`knowledge_hot_cache` 单 key `daily-hot`，15 分钟 TTL；失败时 `stale`（有缓存）/ `unavailable`（无缓存）。
- `backend/src/knowledge/attention.ts`：`DEFAULT_SOURCE_BASE_URL = 'https://aihot.virxact.com'`；5 个电商化关注域；`matchDomains` 是**单关键词子串命中即成立**；`classifyHot` 用「命中关注域 + `sourceCount >= minimumSources`」判 `mustRead`。`发布`/`预售`/`平台` 这类泛词因此把 Apple 发布会、DeepSeek 模型发布判进「竞品动态 → 必看」。
- `backend/src/knowledge/refs.ts`：`buildKnowledgeContext(taskId)` 组装「【关联知识库资料】」段，由 `backend/src/agents/smart-producer.ts` 的 `buildProducerSystemPrompt(agentId, base, taskId)` 追加在挂载技能/文件之后。
- `backend/src/routes/knowledge.ts`：`GET /api/hot`（`?refresh=1`）、`GET/PUT /api/hot/attention`；`task_kb_refs` 的 GET/PUT 在 `/api/tasks/:id/kb-refs`。
- `frontend/src/features/knowledge/HotView.tsx`：单栏卡片列表、一行纯文字计数、卡片只有领域标签、`创建任务` 按钮调用 `openNewTask({title, description})`。
- `frontend/src/App.tsx` / `frontend/src/store/useWorkbench.tsx`：`newTask.prefill` 与 `openNewTask(prefill?)` 构成热点预填链路。
- `packages/shared/src/knowledge.ts`：`HotTier` / `AttentionDomain` / `AttentionConfig` / `HotItem` / `HotPanel` / `TaskKbRef` 等契约。

`knowledge-base` change（26/26 完成、**按用户要求暂不归档**）的 `daily-hot` spec 里存在 `### Requirement: 热点创建任务`，本 change 必须修订其语义（§3.1、§六.4）。

参考页：`http://127.0.0.1:5173/daily-hot`（「个人 AI 工作台」热点页），其排版做法见 §3.2 表格左列。

## Goals / Non-Goals

**Goals:**

- 彻底切断「热点 → 产品任务」的通路（入口、预填链路、可达状态全部移除），并把热点降级为只读情报面板
- 提供正向替代能力：任务详情可**手动**把热点挂为任务背景，注入段与「产品事实」严格区分并声明不可作为产品主体依据
- 热点页达到参考页排版水平：三枚统计药丸 + 信息条（新鲜度 + 上游日报外链）+ 序号 + 证据等级 + 双层内容 + 响应式多栏 + 衬线大标题；三态降级提示更可读
- 建立可插拔多源框架，至少接入 2 个非 AI 行业源，覆盖平台规则/促销节点/品类趋势/竞品动态；单源失败不影响其他源
- 用可配置的三条降噪规则把假阳性压下去，并以**固定样本回归**证明「必看」层不再出现与电商无关的条目
- 不改板块 A 状态机、不改 `task_kb_refs` 表结构、不引重型依赖

**Non-Goals:**

- 不做热点自动匹配/自动推荐/自动关联（本 change 明确要求「只由用户显式操作产生」）
- 不做 RAG 向量检索、不做热点内容的本地全文索引
- 不做热点正文抓取/正文解析（只消费各源提供的摘要与链接）
- 不自建爬虫绕过源站限制；**允许接入需要企业资质/账号的官方开放平台**（用户已拍板，账号与资质由用户提供；未配置资质时该源自动降级为不可用，不影响其他源）
- 不做热点的写回、不修改 `openspec/changes/knowledge-base/` 下任何文件
- 不改热点以外板块 B 能力（索引/检索/星图/浏览）

## Decisions

### D1. 边界修订用「ADDED 的正向约束」表达，而不是 REMOVED/MODIFIED

`daily-hot` 在主 `openspec/specs/` 中**尚无正式 spec**（它只存在于未归档 change `knowledge-base` 的 delta 中）。若用 `## REMOVED Requirements` / `## MODIFIED Requirements`，本 change 会变成「必须叠加在 `knowledge-base` 之上」的依赖型 delta：违反 §0.3「梯队互不阻塞」，且在主 spec 为空的情况下无法独立校验（`openspec validate` 会因找不到被修改的 requirement 而失败）。

**选择**：`specs/daily-hot/spec.md` 全部用 `## ADDED Requirements`，把「移除热点创建任务」表述为正向 requirement **「热点不派生任务（边界约束）」**（含可执行检查场景：卡片无入口、表单不被预填、前端代码检索为空），并在 proposal 的 Capabilities/关系章节显式写明「本 requirement 取代 `knowledge-base` 中 `Requirement: 热点创建任务` 的全部语义」。

- **理由**：可独立校验、不阻塞、语义不丢（覆盖关系写进文档）
- **备选**：MODIFIED（校验失败/产生依赖）；REMOVED（删了却没有正向约束，无法阻止后续重新长出来）

### D2. 热点背景是**新增能力** `hot-context`，独立表 `task_hot_refs`

`workflow-context`（知识库关联资料，`task_kb_refs`）是既有耦合点，但它表达的是「产品事实」。热点背景性质不同（「外部环境情报」），且 §六.2 明确约定「`task_kb_refs` 只读，不得改表结构；如需扩展字段（如 `hot_refs`），由 T3 新建独立表」（`task_kb_refs` 还被 T1 溯源与 T4 失效告警读取，扩表会冲突）。

**选择**：新建 `task_hot_refs`（`task_id`, `hot_id`, `title`, `source_id`, `source_name`, `evidence`, `url`, `latest_at`, `created_at`），按 `(task_id, hot_id)` 唯一去重；能力命名为 `hot-context`，与 `workflow-context` 并列但**不合并**。

- **理由**：与既有耦合点物理隔离、避免与 T1/T4 抢表结构；语义（情报 vs 事实）在数据层就分开
- **备选**：给 `task_kb_refs` 加 `kind` 列（违反 §六.2、与 T1/T4 冲突）；复用 `task_kb_refs` 存伪 docPath（污染知识库语义、失效判定逻辑错乱）

### D3. 多源用「适配器注册表」，源配置进 `attention.json` 的 `sources[]`

现状的 `fetchJson` / `normalizeHotTopics` / `normalizeSelected` 是写死的 aihot 形状。多源要求「可插拔」+「单源降级」+「每源标注来源与证据等级」。

**选择**：

- 新增目录 `backend/src/knowledge/hot-sources/`：`types.ts`（`HotSourceAdapter` 接口）、`aihot.ts`（把现有 aihot 逻辑下沉为一个适配器）、每个非 AI 行业源一个适配器文件、`index.ts`（注册表 + 按配置实例化）。
- 适配器契约（草案，实现期以类型为准）：`id` / `label` / `vertical` / `capabilities`（覆盖哪些关注类别）/ `fetchAll(timeoutMs)` → `{ items: RawHotItem[], daily?: HotDailyInfo }`；`RawHotItem` 在既有字段上扩展 `latest`（最新进展）、`evidence`、`sourceId`、`vertical`。
- `hot.ts` 的 `loadHotPanel` 改为：按启用源列表并发 `Promise.allSettled` → 逐源归一化 → 全局去重（id + 标题）→ 聚合统计与**每源状态**（`ok` / `degraded` + 原因）→ 分层。
- 源配置写进 `backend/config/attention.json`（本地、不入版本库）的 `sources: HotSourceConfig[]`（`id` / `adapter` / `label` / `endpoint` / `vertical` / `enabled` / `enterpriseCredentialRequired` / `tierCap`）；缺项回退内置默认源列表。旧的 `sourceBaseUrl` 视为「单源遗留配置」，在 `normalizeAttention` 中映射为「仅启用 aihot 适配器」以保证向后兼容不报错。
- **证据等级**在归一化阶段按「独立信源数 + 是否有可访问原文外链」判定，不在 UI 层猜：`multi-source`（≥2 信源）/ `single-source`（1 信源）/ `traceable`（1 信源但有原文外链）。若某源只能给出单源信息，即标 `single-source`。

- **理由**：新增源只需加一个文件 + 一行配置；单源降级天然由 `allSettled` 隔离；源与证据等级在数据层就带着，面板与注入都能直接用
- **备选**：在 `hot.ts` 里写 `if (sourceId === 'x')`（不可插拔）；配置写在数据库 settings 表（本地配置文件已是既有约定，且不入版本库）

### D4. 降噪三规则：`excludeKeywords` + `minKeywordHits` + `SourceVerticalTierCap`

**选择**（全部可配置，缺省向后兼容）：

1. `AttentionDomain.excludeKeywords?: string[]`：热点文本（标题 + 摘要 + 来源）**命中任一排除词** → 该关注域**直接不成立**（不是降一层，而是该域作废，不得因该域进入必看或浏览）。
   默认给噪声最重的域配排除词，例如 `competitor` 域排除 `Apple`/`iPhone`/`大模型`/`模型发布`/`开源模型`，`promo` 域排除 `发布会`/`开发者大会`/`技术发布会`。
2. `AttentionDomain.minKeywordHits?: number`（默认 **2**）：同一关注域需命中 ≥ 阈值个**不同**关键词才成立（同一关键词重复出现只算 1 次命中）。这样「仅出现『预售』」不再判成「促销节点」。
3. `AttentionConfig.sources[].vertical` + `tierCap`：非电商垂直源（AI 行业聚合源等）的条目 `tierCap` 默认 `browse`，即**最高只进「浏览」**；只有电商垂直源（`vertical: 'ecommerce-*'`）的条目才允许进 `mustRead`。源权重以「垂直类别 + tierCap」表达，不引入数值打分（避免不可解释的权重调参）。

`classifyHot` 的新判定顺序（草案）：

```
对每条热点：
  文本 = title + summary + latest + source
  对每个启用的关注域：
    若任一 excludeKeywords 命中 → 该域不成立
    否则数出命中的不同关键词数 hits
    若 hits < (minKeywordHits ?? 2) → 该域不成立
  若 s = 该条目所属源的 tierCap，则 tier ≤ s
  mustRead  条件：≥1 个域成立 且 sourceCount ≥ minimumSources 且 tierCap 允许 mustRead
  browse    条件：≥1 个域成立 且未被 mustRead 取走 且 tierCap 允许 browse
  other     条件：其余（含命中排除词、关键词数不足、tierCap 为 other 的条目）
```

- **理由**：三条规则各自可解释、可单独关闭（排除词清空 / 阈值设 1 / tierCap 设 mustRead 即为旧行为），满足「可配置」且可回归
- **备选**：关键词权重打分 + 阈值（调参黑箱、难解释）；黑名单硬编码（不可配置，违反 requirement）

### D5. 「最新进展」字段与上游日报信息条

`latest`（最新进展）不在现有 `HotItem` 上。aihot 源已有可用素材：`hot-topics` 的 `stories/:id` 返回 `digest`（现用作 `summary`）与 `latest`（可用作「最新进展」）；其他源若结构上没有独立进展字段，则**不给该条 `latest`**，前端据此隐藏该层（requirement 要求「无进展则隐藏该层」，不是造一个字段）。

上游日报外链（信息条）由适配器可选返回 `daily?: { date, count, publishedAt, url, title }`（aihot 的日报条目可提供）；无该信息的源不产出，信息条退化为仅新鲜度。

- **理由**：不许诺源没有的数据；requirement 用「若无则隐藏 / 退化」表达而非强制填充
- **备选**：用摘要重复填充「最新进展」（假信息，违反情报可信度）

### D6. 排版重做用「既有 Quiet Signal 变量 + 纯 CSS 网格」，不引组件库

参考页做法映射：三枚统计药丸 = 既有 `qs-card` 风格上的 bordered inline-flex；信息条 = 一行 meta + `打开日报 ↗`；序号 = 卡片左上角等宽数字；证据等级/领域标签 = 既有 `Badge` 组件 + `--color-signal` 色；双层内容 = `讯息` 与 `最新进展` 两个小节标题（与配色区分）；响应式多栏 = CSS Grid `repeat(1/2/3, minmax(0,1fr))` + 媒体查询（`≥1440px` 三栏 / `1024–1439px` 两栏 / `<1024px` 单栏），衬线大标题复用既有 `font-display`。

- **理由**：§0.4 约束「不引重型依赖，UI 沿用 Quiet Signal」；纯 CSS Grid 即可满足三档
- **备选**：引 Tailwind 响应式工具类（已有 Tailwind，但多栏断点仍要落到自定义类，收益不大——实现期可择优，只要断点行为可验证）

### D7. 「24H 精选」与「多源热点」口径落到 `counts`

三枚药丸需要可验证的口径：`counts.upstream` = 聚合去重后的**多源热点**总数；`counts.mustRead` = 今日必看层条数；新增 `counts.selected24h` = 数据时间在最近 24 小时内的条目数（**24H 精选**）。三者都在 `HotPanel.counts` 里，前端只渲染，不在前端重算（保证口径唯一、可后端断言）。

- **理由**：可测（后端断言 counts 与 tiers 一致）；避免前后端口径漂移
- **备选**：前端按 `latestAt` 现算（跨时区/时区漂移风险，且不可后端回归）

### D8. 缓存 key 版本化 + 源集合指纹

多源后 `knowledge_hot_cache` 的单 key `daily-hot` 会与旧结构冲突（旧 payload 没有 `sources`/`evidence` 字段）。**选择**：cache key 改为 `daily-hot:v2:<源集合指纹>`（指纹 = 启用源 id 排序后的短哈希）。旧 key 不删除也不读取（自然过期即废）；`:v2:` 前缀保证结构不兼容的旧缓存不会被解析成半成品面板。源配置变更 → 指纹变化 → 自动重取，避免「配置改了但看的还是旧源缓存」。

- **理由**：零迁移代码（幂等、无需 ALTER/清理脚本）、结构变更天然作废、配置变更自动生效
- **备选**：写迁移脚本清缓存（多写代码，收益相同）

## Risks / Trade-offs

- **边界修订可能误删「有用」的入口**：用户已确认移除，本 change 的替代能力（手动挂背景）更贴近真实用法；风险在于用户找不到新入口 → 任务详情区块标题明确写「任务背景 · 外部环境情报」并在热点卡片提供「挂为任务背景」，同时在 proposal/验收里说明入口变更。
- **非 AI 行业源可用性不可控**（公开源限流、改版、下线）：→ 单源降级隔离 + 每源状态标注 + 源可配置关闭；本 change 不承诺任何单一源长期可用（OQ-1/OQ-2）。
- **多源使条目量膨胀**：→ 每源单独 limit + 全局去重 + 分层 limit（`mustReadLimit` / `browseLimit` / `otherLimit` 既有配置沿用）。
- **降噪阈值调过头会漏掉真热点**：→ 阈值可配置且默认值保守（2 个关键词）；排除词按域配而不是全局；用**固定样本回归**（D4 的 corpus）同时断言「噪音条目不进必看」与「已知真热点仍在必看/浏览」，防单向调参。
- **`buildProducerSystemPrompt` 是 T1 的共享改动点**（§六.3）：→ 本 change 只**追加**热点段，不改既有块的顺序与内容；tasks 中排一条「与 T1 的分工核对」检查。
- **`HotView.tsx` 与 T2 的空态文案重叠**：→ 以本 change 的降级三态结构为准，T2 只补文案（已在 proposal 的关系章节写明）。
- **多源接入可能触碰平台 ToS**：→ 只接公开可访问源 / 用户自有授权源 / **用户已获资质的官方开放平台**；`enterpriseCredentialRequired` 标记为需凭据的源，凭据缺失或失效时该源单独降级为不可用（不阻塞其他源），界面标注该源「未配置凭据」；绝不绕过源站限制或使用未授权抓取。

## Migration Plan

- **无数据库迁移**：新增 `task_hot_refs` 走既有幂等 `ensureSchema`（`backend/src/knowledge/schema.ts`），首版建表即用；不改 `task_kb_refs`、不改板块 A 任何表。
- **配置向后兼容**：`attention.json` 新增字段全部缺省回退（`excludeKeywords` 空、`minKeywordHits` 默认 2、`sources` 缺省用内置默认源列表）；旧 `sourceBaseUrl` 映射为「仅启用 aihot 适配器」，保证旧配置文件不报错、行为可预期。
- **缓存作废**：cache key 版本化（D8），旧缓存不再被读取；无需清理脚本（TTL 15 分钟后自然无用）。
- **前端入口变更的用户可见影响**：热点卡片「创建任务」消失、新建任务弹窗不再被预填——属**有意的破坏性行为变更**（安全边界修订），在 `proposal.md` 的 Why 与验收标准 1 中说明。
- **回滚**：本 change 全部为增量（新目录/新表/新字段），回滚只需还原 `HotView.tsx` / `App.tsx` / `useWorkbench.tsx` / `hot.ts` / `attention.ts` / `refs.ts` / `routes/knowledge.ts` / `packages/shared/src/knowledge.ts`；`task_hot_refs` 表可保留不用（无外键级联风险）。
- **与 `knowledge-base` 归档的关系**：`knowledge-base` 归档时，其 `specs/daily-hot/spec.md` 的 `Requirement: 热点创建任务` 必须按本 change 覆盖后的语义合入主 spec（若两者同时归档，以本 change 的 `daily-hot` spec 为准）；`knowledge-base` 未归档期间，以本 change 的 spec 为热点能力的现行事实来源。见 OQ-3。

## Open Questions

- ~~OQ-1（已拍板，2026-09-11）~~：用户确认**允许**接入需要企业资质/账号的官方开放平台。落地要求：① 源的凭据（appKey/secret 等）走本地配置（不入版本库）；② 凭据缺失或失效时**该源单独降级为不可用**，界面标注「未配置凭据」，不影响其他源；③ 端点范围以用户实际获批的接口为准，实现期按 `sources[]` 配置填入，不改 spec。**待用户提供**：具体平台与获批的接口清单。
- **OQ-2（已更新）**：候选源清单已产出 → **`docs/相关设计文件/热点多信息源调研.md`**（2026-09-11，含可达性实测与合规风险分级）。本 change 的 requirement 仍只写「可插拔多源框架 + 至少 2 个非 AI 行业源 + 覆盖 4 类关注域」，具体端点由实现期读取该报告后按 `sources[]` 配置填入（不需改 spec）。
- **OQ-3（归档顺序）**：`knowledge-base` 按用户要求暂不归档。其 `daily-hot` spec 与本 change 的 `daily-hot` spec 存在语义覆盖关系，需要确定归档顺序与合并规则（建议：先归档 `knowledge-base` 的其余 capability，`daily-hot` 以本 change 为准；或两者同时归档时以本 change 覆盖）。**本 change 不修改 `openspec/changes/knowledge-base/` 下任何文件**。
- **OQ-4（口径确认）**：「24H 精选」是否就是「数据时间在最近 24 小时内的条目数」（D7 的选择），还是需要按参考页理解为「上游 24h window 的精选条目」？两者在有缓存/多源时数值不同。
- **OQ-5（失效背景的留存）**：任务已关联的热点从面板消失时，当前设计是**标记失效并保留标题/链接**。是否需要额外落一份「热点背景快照」（摘要 + 进展正文）以便长期追溯？会带来存储增长，默认不做。
- **OQ-6（源权重表达）**：源权重用「垂直类别 + tierCap」表达（D4）。是否还需要显式的数值权重（如 0–1 打分）参与排序？默认不引入（避免不可解释的调参），如需请用户给出期望的排序语义。
