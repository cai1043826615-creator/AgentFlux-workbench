# hot-intel 实施验证记录（2026-09-11）

> 本文件由 T3 `hot-intel` 开发 agent 维护：记录每个任务的验证结论、待端到端浏览器验证清单、
> 组1 边界修订涉及文件清单、实现偏差。验证命令按「并行纪律」只做后端测试/typecheck（只读），
> 不启动 dev server、不做浏览器操作；浏览器类验证统一列入「待端到端浏览器验证」清单，由协调者执行。
> 后端单文件测试一律用 `node src/...` 直跑（沙箱下 tsx/esbuild spawn EPERM，后端 test 脚本即用 node 直跑 TS）。

---

## 一、任务完成进度

| 任务 | 标题 | 状态 | 验证结论 |
| --- | --- | --- | --- |
| 1.1 | 移除前端入口 | ✅ | `grep "创建任务\|toTask" frontend/src/features/knowledge/` 无热点相关残留（残留 2 处为事件标签/提示文案，与热点无关） |
| 1.2 | 拆除预填链路 | ✅ | `grep "prefill" frontend/src` 无结果；`pnpm --filter ./frontend typecheck` EXIT=0 |
| 1.3 | 后端语义收口 | ✅ | `POST /api/tasks` 入参仅 `title/description/platforms/referenceImage/workflowId/kbRefs`（routes/tasks.ts:21-39），多余字段被忽略；`hot.ts` 导出仅 `loadHotPanel`/`clearHotCache`；热点路由仅 GET/PUT |
| 1.4 | 边界回归测试 | ✅ | `backend/src/knowledge/__tests__/hot-boundary.test.ts`，4/4 pass（node 直跑） |
| 1.5 | 交互回归 | ⏳ 待浏览器 | 见待端到端浏览器验证清单 #1 |
| 2.1 | 共享契约 | ✅ | `packages/shared/src/knowledge.ts` 追加 `TaskHotRef`/`TaskHotRefInput`/`HOT_HOT_REF_LIMIT=6`（追加式，未动 T2 区域）；`pnpm --filter @workbench/shared typecheck` EXIT=0；被前后端 import 成功 |
| 2.2 | 数据表 | ✅ | `schema.ts` 新增独立表 `task_hot_refs`（task_id/hot_id/title/source_id/source_name/evidence/url/latest_at/created_at/valid + `UNIQUE(task_id,hot_id)` + `INDEX(task_id)`）+ `idx_task_hot_refs_task`；`task_kb_refs` 表结构未动（`ensureKnowledgeSchema` 幂等，同库 `task_kb_refs` 建表语句逐列未改） |
| 2.3 | 存储层 | ✅ | `refs.ts` 追加 `setTaskHotRefs`（去重+上限校验）/`listTaskHotRefs`/`clearTaskHotRefs`/`hasTaskHotRefs`/`buildHotContext`；`hot-refs.test.ts` 12/12 pass（去重只留 1 条、超限抛错、移除、kb 表不受影响） |
| 2.4 | 路由 | ✅ | `routes/knowledge.ts` 新增 `GET/PUT /api/tasks/:id/hot-refs`（PUT 全量替换；超限/非法 → 400 可读文案）；`hot-refs.test.ts` 覆盖 GET 空列表 / PUT+GET 往返 / 重复去重 / 超额 400 / kb 表不变 |
| 2.5 | 注入通道 | ✅ | `refs.ts` `buildHotContext` 输出「【任务背景 · 外部环境情报】」段（含「不得作为产品品类/主体/功能规格依据」「仅用于合规、话术与时点参考」+ 逐条来源/证据等级/数据时间/原文链接）；`hot-inject.test.ts` 7/7 pass（无背景时与改动前逐字节一致 / 两段并存可区分 / 约束语句 / 源不可用仍快照注入） |
| 2.6 | 与 T1 分工核对 | ✅ | `smart-producer.ts` 的 `buildProducerSystemPrompt` 既有块顺序未动，仅追加热点段（在知识库段之后、返工意见之前）；测试断言知识库段与热点段并存且热点段位置在知识库段之后（git diff 由协调者在提交时核对） |
| 2.7 | 前端任务详情 | ✅ | `TaskDetailView.tsx` 新增 `HotRefsPanel`（列表+移除+失效标记+原文外链+「与知识库资料视觉可区分」的紫色信号色块）；`api.ts` 新增 `taskHotRefs`/`saveTaskHotRefs`；前端 typecheck 我的文件 0 error。浏览器操作项入清单 #3 |
| 2.8 | 热点卡片入口 | ✅ | `HotView.tsx` HotCard 新增「挂为任务背景」→ `AttachModal`（选择**已存在**任务下拉，无新建入口，不产生新任务；GET 现有 refs → PUT 追加））。浏览器验证入清单 #4 |
| 2.9 | 独立性回归 | ✅ | `hot-inject.test.ts` 板块独立性回归 2 用例（未关联任何背景时 prompt 与改动前一致；空库不抛错）pass；后端既有 `workflow-context.test.ts`/`api.smoke.ts` 适配后全绿（见偏差 #2） |
| 3.1 | 共享契约 | ✅ | shared 扩展 `HotItem`（sourceId/sourceName/vertical/evidence/latest）/`HotPanel`（sources/daily/counts.selected24h）/`HotSourceConfig`/`HotSourceStatus`/`HotEvidenceLevel`；全部可选或带默认；shared typecheck EXIT=0 |
| 3.2 | 适配器框架 | ✅ | `hot-sources/types.ts`（HotSourceAdapter 接口）+ `index.ts` 注册表/按 `sources[]` 实例化/未知 adapter 忽略；`hot-intel-core.test.ts` 3.2 用例 pass |
| 3.3 | 迁移 aihot | ✅ | `hot-sources/aihot.ts`：两路 fetchJson（hot-topics + items?mode=selected&window=24h&limit=20）+ selected 内嵌 story 摘要索引补全 + 去重；story 索引条目不重复计入输出（本次修复：`/stor(y|ies)/` 过滤）；`hot.ts` 不再残留 aihot 字段解析；`hot-intel-core.test.ts` 3.3 用 fixture 断言归一化输出逐条等值 |
| 3.4 | 接入 ≥2 非 AI 源 | ✅ | 新增 `pai-news`（电商派快讯）、`100ec-24h`（网经社 24h 播报）、`stats-sjjd`（国家统计局数据解读）3 个适配器 + `aihot`（AI 行业聚合）；默认源列表 4 源。实测证据见 §五（HTTP 200 + 耗时 + 结构确认）；非 AI 源 capability 覆盖 ≥2 类关注域（平台规则/促销节点/品类趋势/竞品动态 4 类齐备） |
| 3.5 | 源配置可编辑 | ✅ | `attention.ts` `normalizeAttention`/`loadAttentionConfig`/`saveAttentionConfig` 支持 `sources[]`（含 enabled/enterpriseCredentialRequired/tierCap）；旧 `sourceBaseUrl` 映射为「仅启用 aihot」；`HotView` 配置弹窗支持增删改源与启停（含 adapter/endpoint/vertical/tierCap/enterpriseCredentialRequired 展示）；`hot-intel-core.test.ts` 4.1 用例（缺省回退）+ 3.5 UI 待浏览器（清单 #7） |
| 3.6 | 聚合与单源降级 | ✅ | `hot.ts` `loadHotPanel` 按启用源 `Promise.allSettled` 并发；每源独立归一化、全局去重（id+标题）、聚合 counts/sources[]；单源失败仅标 degraded，全部失败才 stale/unavailable；`hot-intel-core.test.ts` 3.6 用例（3 源 1 失败 → live + 其余 2 源 + degraded 原因；全失败+缓存 → stale；全失败无缓存 → unavailable；upstream=去重后总数） |
| 3.7 | 证据等级判定 | ✅ | 归一化阶段 `evidenceOf`：≥2 信源 → multi-source；1 信源且有 url → traceable；否则 single-source；面板与注入透出（HotItem.evidence / TaskHotRef.evidence）；`hot-intel-core.test.ts` 3.7 判定边界用例 |
| 3.8 | 源状态可见 | ✅ | `HotPanel.sources[]`（id/label/status/error/itemCount）面板 InfoBar 展示「源状态 ok/n 可用 + 降级原因」；与整体 live/stale/unavailable 不冲突；`hot-intel-core.test.ts` 3.8 + `api.smoke` 步骤6（sourceName/sources[] 断言） |
| 4.1 | 共享契约与配置 | ✅ | `AttentionDomain` 增 excludeKeywords/minKeywordHits；`tierCap?: HotTier`；normalizeAttention 缺省回退（排除词空、阈值 2、非电商垂直 tierCap browse）；`hot-intel-core.test.ts` 4.1（旧配置回退/非法值回退/显式保留） |
| 4.2 | 匹配逻辑 | ✅ | `matchDomains`：排除词命中 → 该域作废；同一域命中不同关键词数 ≥ minKeywordHits 才成立（同词重复计 1）；`hot-noise.test.ts` 4.2 四类边界用例 |
| 4.3 | 分层逻辑 | ✅ | `classifyHot` 应用 tierCap：非电商垂直源最高进 browse；mustRead = 域成立 + sourceCount≥minimumSources + tierCap 允许；`hot-intel-core.test.ts` 4.3（AI 源 sourceCount=5 → browse；电商源 sourceCount=2 → mustRead；截断）+ `hot-noise.test.ts`（清空排除词等价旧逻辑回归） |
| 4.4 | 默认配置落排除词 | ✅ | `DEFAULT_ATTENTION`：competitor excludeKeywords=[Apple,iPhone,大模型,模型发布,开源模型]、promo excludeKeywords=[发布会,开发者大会,技术发布会]、minKeywordHits=2；`hot-noise.test.ts` 4.4（清空 competitor 排除词 → Apple 发布会条目重回 browse） |
| 4.5 | 固定样本回归 | ✅ | `fixtures/hot-noise-corpus.ts` 20 条固定语料（含实证反例：Apple 折叠屏 iPhone/DeepSeek 新模型/真·平台规则/真·促销节点/真·品类趋势），每条写死期望；`hot-noise.test.ts` 逐条断言 |
| 4.6 | 噪音下降量化 | ✅ | 量化输出：旧逻辑 mustRead 噪音=6，新逻辑=0；新逻辑 mustRead 共 6 条（全为电商相关）。见 §六 |
| 4.7 | 配置 UI 与生效链路 | ✅ | `HotView` 配置弹窗支持编辑排除词与多词命中阈值（+ 源管理增删改启停）；保存 → `api.hotSaveAttention` → 重新拉取生效；浏览器链路入清单 #7 |
| 5.1 | 顶部统计药丸 | ✅ | `HotView` 三枚 bordered pill（多源热点=counts.upstream / 今日必看=counts.mustRead / 24H 精选=counts.selected24h，前端不重算）；DOM 断言用 `data-hot-pill`；浏览器截图入清单 #8 |
| 5.2 | 信息条 | ✅ | `InfoBar`：数据时间/缓存至/源状态摘要 + 上游日报外链（daily.title · count · publishedAt +「打开日报 ↗」`target="_blank" rel="noreferrer"`）；无 daily 退化为仅新鲜度不报错（`hasDaily` 条件渲染）；浏览器入清单 #8 |
| 5.3 | 卡片序号 | ✅ | `HotCard` 每层按展示顺序 `String(index+1).padStart(2,'0')`（等宽 `font-variant-numeric: tabular-nums` + mono 字体）；DOM 断言 `data-hot-seq` |
| 5.4 | 证据等级+领域标签 | ✅ | `EVIDENCE_LABEL` 映射（multi-source→多源事件/single-source→单源/traceable→可回查原文）+ domains `#标签`；DOM 断言 `data-hot-evidence`/`data-hot-domain` |
| 5.5 | 双层内容 | ✅ | 卡片分讯息（summary）与最新进展（latest）两层；无 latest 时整层不渲染（`hasLatest` 条件，不留空容器）；DOM 断言 `data-hot-layer="summary"/"latest"` |
| 5.6 | 响应式多栏+衬线标题 | ✅ | `index.css` 新增 `.hot-grid`：≥1440px 三栏 / 1024–1439 两栏 / <1024 单栏（media query）；标题用 `font-display` 衬线；浏览器三档截图入清单 #8 |
| 5.7 | 三态降级提示 | ✅ | `DegradeNotice`：live 不渲染；stale 显示「展示最近一次缓存内容」+缓存时间+失败原因；unavailable 显示「热点源暂不可用」+原因+可重试刷新+「不影响知识库其他功能与工作流板块」；色调 warn/danger 区分；DOM 断言 `data-hot-degrade` |
| 5.8 | 可读性比对 | ✅（待浏览器） | 五项逐项确认清单已写入 §七；并排比对截图由协调者在参考页 `http://127.0.0.1:5173/daily-hot` 执行，入清单 #8 |
| 6.1 | 后端全量测试 | ⏳ 部分 | 本 change 涉及用例全部绿：hot-boundary 4/4、hot-intel-core 29/29、hot-noise 6/6、hot-refs 12/12、hot-inject 7/7、workflow-context 30/30（适配后）、api.smoke 13/13（适配后）、knowledge.test 38/38、health（既有）。**全量 `pnpm --filter ./backend test` 暂被 T1/T4 中间状态文件阻塞**（见偏差 #1） |
| 6.2 | typecheck+build | ⏳ 部分 | shared EXIT=0；frontend 我的文件（HotView/TaskDetailView/api.ts）0 error（残余 1 处为 T4 `ContentDeliveryView.tsx:255` `review` 未定义，中间状态）；backend 我的文件 0 error（残余为 T1 `channel-test.ts`/`versions.ts`/`service.ts`/`rework-integration.test.ts`/`package.test.ts`/`llm-usage.test.ts` 中间状态） |
| 6.3 | OpenSpec 校验 | 待做 | 由协调者在提交后执行 |
| 6.4 | 端到端联调 | 待做 | 入清单 #9（热点页→任务详情挂背景→Agent 执行→prompt 含外部环境情报段→无法从热点建任务） |
| 6.5 | 板块独立性回归 | ⏳ 部分 | 2.9 独立性用例（无背景/空库）pass；`task_kb_refs` 表结构未动（§二 2.2）；全源不可用场景由 `hot-inject.test.ts` ④ + `workflow-context` stale/unavailable 用例覆盖 |
| 6.6 | 提交粒度 | 待做 | 协调者执行；组1 文件清单见 §二 |

---

## 二、组1 边界修订涉及文件清单（协调者按此单独提交）

组1 为独立提交单元，涉及文件（均已被本 change 改动）：

| 文件 | 改动内容 |
| --- | --- |
| `frontend/src/features/knowledge/HotView.tsx` | 删除 `HotCard` 的「创建任务」按钮与 `onToTask` prop；删除 `toTask` 函数与 `openNewTask` 引用；删除 `useWorkbench` import；组件注释改为「只读情报面板」 |
| `frontend/src/store/useWorkbench.tsx` | `NewTaskState` 删除 `prefill` 字段；`openNewTask` 删除 `prefill` 形参；`newTask` 初始值与 `closeNewTask` 删除 prefill 分支 |
| `frontend/src/App.tsx` | `NewTaskModal` 的 `useEffect` 删除 `newTask.prefill` 应用与依赖；表单重置不再预填热点内容 |
| `backend/src/knowledge/__tests__/hot-boundary.test.ts` | 新增：热点模块无创建任务函数 + 热点路由只读 + POST /api/tasks 忽略热点字段（4 断言） |
| `backend/package.json` | test 脚本追加 `hot-boundary.test.ts` |

> 说明：1.3 属后端语义核对（无代码改动——`routes/tasks.ts` 本就只接受已知字段），1.4 以新增测试落实。
>
> **协调者执行注记（2026-09-11）**：组1 的 `useWorkbench.tsx` / `App.tsx` 两文件与 T4（通知/渠道）在同文件交错改动（文件级无法干净拆分），故组1 未单独成 commit；已按「四梯队各自中文 conventional commit」提交，`HotView.tsx`（删创建按钮）随 `feat(hot-intel)` 落地，`useWorkbench/App` 的 prefill 删除随 `feat(delivery-ops)` 落地（两 commit message 均已注明）。提交历史：`feat(quality-loop)` → `feat(knowledge-ux)` → `feat(hot-intel)` → `feat(delivery-ops)` → `chore` 共享收口。

---

## 三、实现偏差记录

1. **外部梯队中间状态阻塞（不属本 change 缺陷，不处理）**（截至 2026-09-11 末次核对）
   - 后端 typecheck 残余 7 处（全部为 T1 文件）：`src/agents/__tests__/llm-usage.test.ts`、`src/agents/channel-test.ts`、`src/delivery/__tests__/package.test.ts`、`src/delivery/versions.ts`；T1 的 `service.ts`/`rework-integration.test.ts` 已修复。**本 change 后端文件 typecheck 0 error**。
   - 前端 typecheck 残余 3 处（T1/T4 中间状态）：`src/lib/__tests__/task-merge.test.ts`、`src/store/useWorkbench.tsx:331`（WorkbenchState 缺 boardMode/filters 等，其他梯队并行改动中）。**本 change 前端文件（HotView/TaskDetailView/api.ts）typecheck 0 error**（T4 `ContentDeliveryView.tsx` 已修复）。
   - 待对应梯队完成后，6.1/6.2 全量（`pnpm --filter ./backend test` / 三端 typecheck）即可 0 error；若届时仍残留，此记录即为凭证。

2. **语义修订对既有测试的最小适配（本 change 核心语义的必然结果）**
   - `workflow-context.test.ts`：
     - 「关注域关键词匹配」「各层按限制数截断」两用例 cfg 加 `minKeywordHits: 1`（等价旧逻辑单词命中，聚焦用例本身语义）；
     - 「成功拉取」：h1（aihot 源，tierCap browse）断言由 mustRead 改 browse + 新增「不得进必看」断言（D4 降噪核心）；source 断言改为 `sourceId==='aihot'`；
     - 「缓存过期后重新拉取」：`cache_key='daily-hot'` 直更改为 `clearHotCache()`（D8 缓存 key 版本化后旧 key 无意义）；
     - 「源不可用降级 stale」：`tiers.mustRead.length>0` 改为 `counts.upstream>0`（缓存中无 mustRead 条目）。
     - okFetch 的 `/api/v1/items` 响应内嵌 s1/s2 story 条目（aihot 适配器从 selected 建摘要索引，不再单独请求 stories/:id）。
   - `api.smoke.ts` 步骤6：`panel.sourceUrl.includes('http')` 改为 `sourceName.length>0 && Array.isArray(sources) && sources.length>0`（B10 多源后无单一源 URL）。

3. **aihot 适配器修正（实现期发现并修复）**：selected 响应中内嵌的 story 索引条目原先会被当作精选条目重复输出（upstream 虚高）→ 过滤 `url`/`links.story` 含 `/stor(y|ies)/` 的条目，仅作摘要索引。`hot-intel-core.test.ts` 与 `workflow-context.test.ts` 均回归通过。

4. **实现载体合并**：2.2 数据表与 2.3 存储层合并落地——表结构在 `schema.ts`（KT.hotTaskRefs），存储函数按任务描述实现于 `refs.ts`（与 `buildKnowledgeContext` 同文件，注入通道 2.5 复用同一文件，避免新增 `hot-refs.ts` 与 T2 文件命名冲突）。2.4 路由在 `routes/knowledge.ts` 追加。

5. **证据标签中文映射在前后端各维护一份**（前端 `EVIDENCE_LABEL` / 后端 `buildHotContext` evidenceLabel）——均为纯展示映射，未引入共享常量（避免触碰 T2 共享文件区域）。

6. **3.4 源垂直标注**：`pai-news`/`100ec-24h` 垂直为 `ecommerce-news`（电商垂直，tierCap mustRead）；`stats-sjjd` 垂直 `gov-stats`（tierCap browse）；`aihot` 垂直 `AI 行业聚合`（tierCap browse）。企业资质源未接入，`enterpriseCredentialRequired` 仅配置项预留。

---

## 四、待端到端浏览器验证清单（协调者统一执行）

| # | 任务 | 验证点 | 验收标准引用 |
| --- | --- | --- | --- |
| 1 | 1.5 | 从热点页（任意层任意卡片）检查不存在「创建任务」按钮；从热点页经左侧栏/看板「新建任务」进入表单，标题与描述为空且不含热点内容；对 `#7` 型「Apple 发布首款折叠屏 iPhone Duo」条目重复序列，表单不出现该热点内容（截图留证） | tasks.md 1.5；specs/daily-hot「热点无法预填新建任务表单」 |
| 2 | 3.8 | 人为让 1 源失败（如临时禁用/断网）后截图：源状态区可见「该源降级 + 原因」且整体仍为实时；四类状态（ok/degraded × live/stale）各一张截图 | tasks.md 3.8 |
| 3 | 2.7 | 任务详情：关联 2 条热点 → 列表出现 2 条且含来源/证据等级/时间/链接；刷新页面后仍在；移除 1 条后剩 1 条；未关联背景的任务不出现该区块（不占位） | tasks.md 2.7 |
| 4 | 2.8 | 热点卡片「挂为任务背景」→ 选择已存在任务 → 目标任务详情出现该热点；操作前后任务总数不变（看板计数一致）；弹窗无「新建任务」入口 | tasks.md 2.8 |
| 5 | 4.7 | 配置弹窗为某域填排除词并保存 → 刷新热点 → 对应条目从必看/浏览消失；`backend/config/attention.json` 出现该字段（本地文件不入版本库） | tasks.md 4.7 |
| 6 | 5.4/5.5 | 构造三种证据等级条目各出现一次并截图；有 latest 与无 latest 两种卡片同屏截图（无 latest 卡片无「最新进展」标题/空容器） | tasks.md 5.4/5.5 |
| 7 | 3.5/5.1-5.3 | 配置弹窗增删改源与启停后保存生效；三枚药丸数值等于接口 counts；第一层序号序列 01/02/03 | tasks.md 3.5/5.1/5.3 |
| 8 | 5.6/5.7/5.8 | 三档视口（1440/1024/640）截图各一张（grid-template-columns 列数 3/2/1，标题 font-family 含衬线）；三态各构造一次截图（live 无提示条、stale/unavailable 含规定文案）；与参考页 `http://127.0.0.1:5173/daily-hot` 并排比对截图 + 五项逐项确认（统计药丸/信息条/序号/标签/双层/多栏） | tasks.md 5.6/5.7/5.8 |
| 9 | 6.4 | 端到端：热点页（多源+降噪分层+排版）→ 任务详情手动挂热点背景 → Agent 执行 → 最终 system prompt 含「外部环境情报」段；同时确认从热点无法创建任务 | tasks.md 6.4 |

---

## 八、协调者浏览器执行结果（2026-09-11 回填）

> 验证环境：后端 4312 + 示例 Vault；热点页多源 4/4 实时（pai-news/100ec-24h/stats-sjjd/aihot）；浏览器 DOM 断言为主（本会话无视觉桥，截图像素比对未做）。

| 清单 # | 结果 |
| --- | --- |
| 1（1.5） | ✅ 热点页（多源/浏览/其他各层）无「创建任务」按钮；经左栏/看板「新建任务」进入表单标题与描述为空（不含热点内容）；任务 `#7`（旧热点创建）仅保留既有，无新建入口 |
| 2（3.8） | ✅ 临时禁用 pai-news → 强制刷新 → 源状态区「多源热点（3/3 源可用）」「源状态 3/3 可用」，counts 同步降（多源 99→78、24H 精选 15→13），pai 条目从列表消失；恢复后 4/4 实时、counts 复原（98/15）。四态截图未做（无视觉桥），DOM 断言覆盖 ok/degraded 两态 |
| 3（2.7） | ✅ 挂背景 1 条到任务 8 → 详情「外部环境情报」区块出现该热点（含来源/证据等级/时间/链接）+ 声明「外部环境情报仅作背景参考，不作为产品品类/主体/功能规格依据」；刷新仍在；移除后区块消失；未关联任务（任务 9/10）不出现该区块（不占位）。「关联 2 条列表 2 条」场景未造（挂 1 条增删闭环已验证） |
| 4（2.8） | ✅ 「挂为任务背景」弹窗选择已存在任务（任务 8），弹窗无「新建任务」入口、含「不产生新任务」提示；操作前后任务总数不变（8→8，看板计数一致） |
| 5（4.7） | ✅ 配置面板为「品类趋势」填排除词「食品」保存 → `GET /api/hot/attention` 返回 domains[0].excludeKeywords=["食品"]（落库成功）；刷新热点后排除词生效（条目过滤）；验收后已恢复清空（excludeKeywords=[] 实测） |
| 6（5.4/5.5） | 🟡 双层证据标签（层级+「可回查原文」）、信息条（「命中关注域『平台规则』，信源较少，供浏览」）验证可见；三种证据等级 + latest/无 latest 卡片同屏构造未做（依赖源数据形态） |
| 7（3.5/5.1-5.3） | ✅ 三枚药丸（0 必看 / 3 浏览 / 12 其他）与接口 counts（mustRead/browse/other）一致；第一层序号 01/02/03 递增；源启停（enabled=false）生效即 #2 降级链路；配置弹窗增删改源未单独造数据（源配置 GET/PUT 契约正常） |
| 8（5.6/5.7/5.8） | 🟡 响应式：375px 视口无横向溢出、1280px 双栏 grid 正常（DOM 断言）；1440/1024/640 三档截图与参考页并排比对未做（无视觉桥，参考页 5173 未起） |
| 9（6.4） | 🟡 「挂背景 → Agent 执行 → prompt 含外部环境情报段」：挂背景任务 8 时文案已产出（未重跑 LLM）；prompt 组装含背景段的逻辑由 hot-refs 注入代码 + 单测覆盖，真实 prompt 未抓取 |

---

## 五、3.4 多源实测证据（2026-09-11，node fetch 直连探测）

| 源 | 端点 | HTTP | 耗时 | 响应体长度 | 结构确认 |
| --- | --- | --- | --- | --- | --- |
| 电商派（pai-news） | `https://www.pai.com.cn/news/` | 200 | 458ms | 92081 | 内嵌 ApolloSSRDataTransport JSON（slug 正则 `/"[slug]":"([0-9a-z]{20,30})"/` + 附近 title/summary/published_at），兜底 `<a href="/news/<26位slug>">` 正则 |
| 国家统计局（stats-sjjd） | `https://www.stats.gov.cn/sj/sjjd/` | 200 | 833ms | 68306 | `<a href="(?:\./|\.\./)?(\d{6}/t(\d{8})_\d+\.html)">标题</a>`；`new URL(href, LIST_URL)`；路径 `t20260909` → latestAt `2026-09-09T00:00:00.000Z` |
| 网经社（100ec-24h） | `https://www.100ec.cn/list.html` | 200 | 873ms | 137529 | `<dl>` 块内 `detail--(\d+).html` + `<span>` 时间；URL 拼 `https://www.100ec.cn/detail--<id>.html` |
| AI HOT（aihot，既有） | `/api/v1/hot-topics` + `/api/v1/items?mode=selected&window=24h&limit=20` | — | — | — | 两路 fetchJson + selected 内嵌 story 摘要索引补全 + 去重 |

- 3.4 验收：默认配置下非 AI 行业源（pai/100ec/stats）实际拉取条目数 > 0；capabilities 合计覆盖 4 类关注域（平台规则/促销节点/品类趋势/竞品动态）≥2 类（默认域命中验证见 `hot-noise-corpus.ts` 与 `hot-intel-core.test.ts`）。
- 端点均来自 `docs/相关设计文件/热点多信息源调研.md` P0/P1 公开源清单，未接入任何需企业资质/合规高风险源。

---

## 六、4.6 噪音下降量化结论

固定语料 `hot-noise-corpus.ts`（20 条）下：

| 指标 | 旧逻辑（单源 aihot、单词命中、无排除词） | 新逻辑（多源 + 排除词 + 多词命中 + tierCap） |
| --- | --- | --- |
| mustRead 中噪音条目数（与电商无关） | **6** | **0** |
| mustRead 总条数 | 6（全为噪音） | 6（全为电商相关：平台规则/促销节点/品类趋势/竞品动态） |

量化输出由 `hot-noise.test.ts` 打印；断言噪音条目数 === 0。

---

## 七、5.8 可读性比对五项逐项清单（供协调者截图后打勾）

| 项 | 标准 | 状态 |
| --- | --- | --- |
| 统计药丸 | 顶部三枚 bordered pill（多源热点/今日必看/24H 精选），数值=counts | 代码完成，待并排截图确认 |
| 信息条 | 数据时间/缓存至/源状态摘要 + 日报外链「打开日报 ↗」（_blank+noreferrer） | 代码完成，待并排截图确认 |
| 序号 | 每层 01/02/03… 等宽两位补零 | 代码完成，待并排截图确认 |
| 标签 | 证据等级（多源事件/单源/可回查原文）+ 领域标签 | 代码完成，待并排截图确认 |
| 双层/多栏 | 讯息+最新进展双层；≥1440 三栏 / 1024-1439 两栏 / <1024 单栏 | 代码完成，待并排截图确认 |
