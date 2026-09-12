# knowledge-ux 验证记录（2026-09-11）

> 本文件为 OpenSpec change `knowledge-ux` 的实施验证记录，逐任务记录验证结论。
> 依据：`docs/优化方向-2026-09-11-知识库与工作流.md`（唯一事实来源）与 `tasks.md`。
> 所有「浏览器验证」类条目按并行纪律只实现代码 + 记录验证点，实际浏览器执行由协调者统一完成（见文末「待端到端浏览器验证清单」）。

## 1.1 基线现状（只读核对，不改代码）

### ① KnowledgeView.tsx 「已连接」分支四张统计卡落点
- 文件：`frontend/src/features/knowledge/KnowledgeView.tsx`
- 位置：第 346–361 行，`{/* 总览统计 */}` 注释下，`<div className="grid grid-cols-2 gap-3 md:grid-cols-4">`，内含 `['文档', stats?.docCount ?? 0]` / `['标签', ...]` / `['目录', ...]` / `['关联边', ...]` 四张 `qs-card` 统计卡。
- 三栏浏览区在其下：左 `<aside className="w-[210px] shrink-0 space-y-4">`（目录+标签，210px）、中 `<div className="w-[300px] shrink-0">`（文档列表，300px）、右 `<div className="min-w-0 flex-1">`（阅读区，自适应）。
- 总览带将替换这四张统计卡，位置在三栏之上。

### ② ui.tsx 第 241 行 `Empty({ text })` 全部调用点（`grep -rn "<Empty" frontend/src`）
| # | 文件 | 行 | 调用 |
| --- | --- | --- | --- |
| 1 | frontend/src/features/observability/ObservabilityView.tsx | 147 | `<Empty text="暂无工位（Agent）" />` |
| 2 | 同上 | 245 | `<Empty text="暂无 Agent" />` |
| 3 | 同上 | 275 | `<Empty text={...日志加载失败...} />` |
| 4 | 同上 | 277 | `<Empty text="暂无执行日志" />` |
| 5 | frontend/src/features/content/ContentDeliveryView.tsx | 252 | `<Empty text="文案尚未产出 · 待进入卖点文案阶段" />` |
| 6 | 同上 | 263 | `<Empty text="文案包尚未产出，请稍候…" />` |
| 7 | 同上 | 351 | `<Empty text="该板块图片尚未产出" />` |
| 8 | 同上 | 418 | `<Empty text="图片尚未产出 · 待文案确认后进入主图设计" />` |
| 9 | frontend/src/features/knowledge/HotView.tsx | 251 | `<Empty text="暂无热点数据" />` |
| 10 | frontend/src/features/knowledge/KbRefPicker.tsx | 153 | `<Empty text={hint ?? '无命中资料'} />` |
| 11 | frontend/src/features/knowledge/KnowledgeGraphView.tsx | 488 | `<Empty text="暂无图谱数据" />` |
| 12 | 同上 | 532 | `<Empty text="点击图中节点查看关联" />` |
| 13 | frontend/src/features/knowledge/KnowledgeView.tsx | 402 | `<Empty text="暂无目录" />` |
| 14 | 同上 | 409 | `<Empty text="暂无标签" />` |
| 15 | 同上 | 440 | `<Empty text={hint ?? '无命中结果'} />` |
| 16 | 同上 | 466 | `<Empty text="该范围内暂无文档" />` |
| 17 | 同上 | 493 | `<Empty text="从左侧选择一篇文档阅读" />` |
| 18 | frontend/src/features/board/ArchivedTasksModal.tsx | 32 | `<Empty text="暂无已归档任务" />` |
| 19 | frontend/src/features/board/BoardView.tsx | 175 | `<Empty text={...看板暂无任务...} />` |

既有调用点共 **19 处**；4.1 扩展 `Empty` 后全部无需改动即可编译。

### ③ backend/src/knowledge/graph.ts 的 docNodeId / graphData 节点字段
- `docNodeId(path)`：第 18–20 行，返回 `doc:${normalizeRel(path)}`。
- `graphData()` 文档节点字段（第 65–72 行）：`id`（docNodeId）、`kind: 'doc'`、`label`（d.title）、`path`（d.path）、`tags`（d.tags）、`degree`。
- 标签节点字段（第 74–83 行）：`id`（tagNodeId）、`kind: 'tag'`、`label`（tag）、`path: null`、`tags: [tag]`、`degree`。
- 边（第 47–63 行）：`{ source, target, kind: 'tag' | 'link' }`，degree 按边累计。
- 2.9 将仅给文档节点**追加** `isolated` 字段，既有字段语义与取值不变。

## 1.3 预设依据配置化（后端）

- 实现：`backend/src/knowledge/vault.ts` 的 `VaultConfig`/`VaultSettingsValue` 增加 `presetDirs: { products: string; brand: string }`（默认 `10_raw/products` / `wiki/brand`，默认值取自共享常量 `KB_GRAPH_PRESETS`）；`saveVaultConfig` 持久化 `presetDirs`；`knowledgeStatus()` 返回值新增 `presets: { type: 'dir', products, brand }`。
- 单测断言（在 `backend/src/knowledge/__tests__/health.test.ts`）：见任务 1.3 验证条目（待后端测试执行后回填结论）。

## 2.7–2.11 后端健康度（实现结论见对应单测执行结果）

- `backend/src/knowledge/health.ts`：`computeDocUsageRate()` / `islandDocPaths()` / `knowledgeHealth()`。
- `backend/src/knowledge/graph.ts`：文档节点新增 `isolated`（调用 `islandDocPaths()`）。
- `backend/src/routes/knowledge.ts`：追加 `GET /api/knowledge/health`。
- 单测文件：`backend/src/knowledge/__tests__/health.test.ts`（覆盖 1.3 / 2.7 / 2.8 / 2.9 / 2.10 / 2.11 / 3.10 后端断言）。
- 已确认：工作区中 T1 `quality-loop` **未提供** `computeDocUsageRate`/`islandDocPaths`/`knowledgeHealth` 等同义导出（grep 0 命中），因此本 change 独立实现，不造第二个口径；若后续 T1 提供同义模块，按主文档 §六.1 统一。

### 单测执行结果（2026-09-11，`node src/knowledge/__tests__/health.test.ts`，16/16 通过）
| 任务 | 断言 | 结论 |
| --- | --- | --- |
| 1.3 | 未配置 → presets 默认 `10_raw/products`/`wiki/brand`；保存 `20_products`/`wiki/brand2` 后重解析返回新值；传空串/非法 + Vault 未连接 → 回退默认不抛异常 | ✔ 3/3 |
| 2.7 | 12 文档 3 关联（1 篇 2 任务）→ `{3,12,0.25}`；失效 doc_path 不计分子；0 文档 → ratio null 不抛错 | ✔ 3/3 |
| 2.8 | A/B/C/D → 孤岛集合 `{c.md}`、count=1；无标签无链接计入孤岛；trim 后比较（`品牌`/` 品牌 ` 同标签）；只有独有标签仍孤岛 | ✔ 4/4 |
| 2.9 | graph 中 isolated 文档节点 === health.islands.count（=1，仅 C）；标签节点不含 isolated | ✔ 2/2 |
| 2.10 | 200 + usage/islands/computedAt 结构、paths.length===count；Vault 未连接 → 200、ratio null、paths 空、不 5xx | ✔ 2/2 |
| 2.11 | health.ts 无 DDL/DML 语句（见下 grep 复核）；health/graph 调用前后三表结构与行数快照一致 | ✔ 1/1 |
| 3.10 | 文档节点 id/kind/label/path/tags/degree 语义不变（样本 A 校验），仅新增 isolated | ✔ 1/1 |

### 2.11 grep 复核
```
grep -nE "CREATE TABLE|ALTER TABLE|DROP TABLE|INSERT INTO|UPDATE .* SET|DELETE FROM" backend/src/knowledge/health.ts
```
→ 0 命中（health.ts 仅 SELECT 查询，运行验证通过）。

### 测试运行环境说明（并行梯队干扰与沙箱）
- `pnpm` / `tsx` 在当前沙箱均触发 `spawn EPERM`（子进程管道 stdio 被拦），因此本 change 的单测以 `node <file>` 直接运行（与 backend package.json test 脚本一致）。
- T3 `hot-intel` 进行中的 `backend/src/knowledge/hot-sources/fetch.ts` 使用 TS 参数属性（Node strip-only 不支持），导致加载完整 `knowledgeRoutes` 模块（顶层 import hot.ts）失败；路由测试改用「等价 handler 注册到最小 Fastify 实例」（真实路由体即为一行 `{ health: knowledgeHealth() }`）。**协调者注意**：`pnpm --filter ./backend test` 的全量绿跑需等 T3 的 hot-sources 文件与 test 脚本就绪（其参数属性语法在 `node` 直跑下会报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`）。
- T1 `quality-loop` 进行中：`engine/service.ts` 引用尚未创建的 `delivery/provenance.ts`，同样影响全量 app 构建类测试；本 change 的测试不依赖该链路。

## 4.2 空态场景清单与标记表（8 类）

| 场景标识 | 场景 | 说明文案（data-qs-empty） | 下一步文案（data-qs-empty-next） | 实现落点 | 实际渲染节点（4.8 回填） |
| --- | --- | --- | --- | --- | --- |
| `kb-disconnected` | 知识库未连接 | 未连接 Obsidian Vault（保留既有） | 去连接 Obsidian Vault；不影响工作流板块 | KnowledgeView.tsx | `[data-qs-empty="kb-disconnected"]`（`<span>` 包「未连接 Obsidian Vault」）+ `[data-qs-empty-next="kb-disconnected"]`（提示行，原因行保留在上方） |
| `kb-no-docs` | 已连接但无文档 | 知识库当前没有索引到任何 Markdown 文档 | 检查 Vault 路径与索引范围，或在 Vault 中新建 `.md` 后点「重建索引」 | KnowledgeView.tsx | `Empty`（`docCount===0` 且非孤岛模式）→ 两个节点均渲染 |
| `kb-no-tags` | 无标签 | 还没有文档声明标签 | 在文档 frontmatter 的 `tags` 字段写标签，保存后点「重建索引」；标签是星图连通与检索的关键 | KnowledgeView.tsx | `Empty`（标签卡 `tags.length===0`）→ 两个节点均渲染 |
| `kb-no-dirs` | 无目录 | 暂无目录层级 | 把资料整理进子目录，如 `10_raw/products`，再点「重建索引」 | KnowledgeView.tsx | `Empty`（目录卡 `dirs.length===0`）→ 两个节点均渲染 |
| `graph-empty` | 星图无数据（无链接无标签） | 还没有可连成图谱的关系 | 在文档之间添加 `[[wiki链接]]`，或让两篇文档共享同一标签，然后点「刷新」 | KnowledgeGraphView.tsx + KnowledgeOverviewBar.tsx（缩略复用） | 星图无数据分支 + 缩略预览 0 节点分支，均经 `Empty`/静态 div 渲染两节点 |
| `search-empty` | 搜索结果为空 | 当前关键词没有命中任何已索引文档 | 换用 ≥2 字的中文关键词、或清除搜索回到目录/标签浏览；若确认文档应在索引内，检查索引范围 | KnowledgeView.tsx | `Empty`（`hits.length===0`）→ 两个节点均渲染 |
| `hot-empty` | 热点不可用 / 无热点 | 上游热点源暂不可用 / 本次未取到热点条目 | 点「刷新」重试、或检查关注域配置；不影响知识库其他功能与工作流板块 | HotView.tsx | `!panel || status==='unavailable'` → 不可用文案；`upstream===0` → 无条目文案；两分支同 key `hot-empty` |
| `kb-ref-search-empty` | 「关联知识库资料」步骤无搜索结果 | 当前关键词没有命中知识库资料 | 换关键词重试，或直接跳过本步骤创建任务，之后再回来关联；知识库未连接时提示先连接 Vault | KbRefPicker.tsx | `Empty`（`hits.length===0`）→ 两个节点均渲染 |

> 补充场景（超出 8 类清单，属 A3/A2 新增）：`graph-filter-empty` / `graph-preset-empty`（星图过滤/预设无匹配，KnowledgeGraphView.tsx）、`no-islands`（孤岛筛选为空，KnowledgeView.tsx）。4.8 grep 全库 11 个不同 key（≥8）。

## 实现偏差（5.8 回填）

- **实际键名**：设置表键 `knowledgeVault`（既有），JSON 字段新增 `presetDirs: { products: string; brand: string }`（保存路径：`PUT /api/knowledge/config` → `saveVaultConfig` → 仅 `settings` 表；`knowledgeStatus().presets = { type: 'dir', products, brand }`）。
- **共享常量**：`packages/shared/src/knowledge.ts` 追加 `KB_GRAPH_PRESETS`（id/label/dir）、`KnowledgePresetBasis='dir'`、`KnowledgeVaultConfigInput`、`KnowledgeUsage/KnowledgeIslands/KnowledgeHealth`、`KnowledgeGraphIsolationFilter`；`KnowledgeGraphNode.isolated?: boolean`。
- **实际函数名**：后端 `backend/src/knowledge/health.ts` 导出 `computeDocUsageRate()` / `islandDocPaths()` / `knowledgeHealth()`（T1 未提供同义导出，已 grep 确认）；图谱 `graphData()` 文档节点新增 `isolated`（直接调用 `islandDocPaths()`）。前端 `frontend/src/features/knowledge/graphCanvas.ts` 导出 `layoutInitial` / `drawGraph` / `hitTest` / `screenToWorld` / `toScreen` / `nodeRadius` / `GraphView` / `GraphSimNode` / `GraphSize` / `GraphRenderOpts`；`kbEmpty.ts` 导出 `KB_EMPTY_STATES` / `KbEmptyState` / `KbEmptyKey`；`KnowledgeOverviewBar.tsx` 导出 `KnowledgeOverviewBar` / `KnowledgeOverviewBarProps`。
- **路由**：`GET /api/knowledge/health` → `{ health: KnowledgeHealth }`（只读，Vault 未连接返回可解释空值而非 5xx）。
- **空态 key 全集（11 个，≥8）**：`kb-disconnected` / `kb-no-docs` / `kb-no-tags` / `kb-no-dirs` / `graph-empty` / `search-empty` / `hot-empty` / `kb-ref-search-empty`（4.2 清单 8 类）+ `graph-filter-empty` / `graph-preset-empty` / `no-islands`（A2/A3 新增）。
- **规格偏差**：星图过滤/预设空态的 `graph-filter-empty` / `graph-preset-empty` 与孤岛筛选的 `no-islands` 不在 4.2 的 8 类清单内（清单为「至少 8 类」的最低集），已在 4.2 表补充说明。
- **测试运行方式偏差**：沙箱下 `pnpm`/`tsx` 触发 `spawn EPERM`，单测以 `node <file>` 直跑；路由测试因 T3 进行中 `hot-sources/fetch.ts` 参数属性语法（Node strip-only 不支持）无法加载完整 `knowledgeRoutes`，改用等价 handler 注册最小 Fastify 实例（真实路由体为一行）。
- **并行梯队暂态（非本 change 引入，协调者收口时复核）**：① T3 `backend/src/knowledge/hot.ts` 的 `selected24h` 类型错误（此前后端 typecheck 2 处）；② T3 `hot-sources/fetch.ts` 参数属性语法使 `node` 直跑/`pnpm test` 全量绿跑需其调整；③ T1 `engine/service.ts` 引用未创建的 `delivery/provenance.ts`；④ 前端 `src/features/content/ContentDeliveryView.tsx(255)` `review` 未定义（并行梯队进行中）。以上均不影响本 change 文件自身的 typecheck 与单测通过。

---

## 待端到端浏览器验证清单

> 按并行纪律：以下条目已实现代码，浏览器验证由协调者统一执行。每条给出「任务号 + 验证点 + 验收标准引用」。

| # | 任务号 | 验证点 | 验收标准引用 |
| --- | --- | --- | --- |
| 1 | 1.4 | 设置面板两栏预设输入显示当前生效值；修改保存并刷新回显；保存不清空 Vault 根路径与白名单（对照保存前后 GET /api/knowledge/status） | tasks 1.4 |
| 2 | 1.5 | Vault 未连接时打开知识库页与新建任务第 2 步：无报错、无 `undefined` 文本、板块 A 可创建任务 | tasks 1.5 |
| 3 | 2.1 | 星图渲染与抽取前逐像素级一致（截图比对节点形状/连线/选中高亮）；拖拽/滚轮/单击详情不变 | tasks 2.1 |
| 4 | 2.2 | 总览带四个数字与 GET /api/knowledge/stats 逐项相等；indexing 时显示「索引中」且完成后自动刷新；期间三栏可用 | tasks 2.2 / spec 知识库页顶部紧凑总览带 |
| 5 | 2.3 | 缩略图节点总数与 GET /api/knowledge/graph 一致；点击缩略区域 view 切到 knowledge-graph；缩略图滚轮/拖拽后缩放为初始值、平移为 0、不触发选中或跳转 | tasks 2.3 / spec 星图缩略预览 |
| 6 | 2.4 | 最近更新条数/顺序与 stats.recent 前 8 项一致；点击第 3 条阅读区渲染正文且列表高亮；0 文档时空态文案无骨架/undefined | tasks 2.4 / spec 最近更新 |
| 7 | 2.5 | 12 文档/3 被关联（1 篇关联 2 任务）样本显示 `25%（3/12）`；totalDocs=0 显示「—」无 NaN/Infinity/0/0；页面出现「文档使用率」不出现「产出溯源率」 | tasks 2.5 / spec 文档使用率指标 |
| 8 | 2.6 | A/B/C/D 样本下点击孤岛指标列表恰 1 条为 C，点 C 阅读区渲染正文；取消筛选恢复点击前范围；孤岛数 0 时点击展示「没有孤岛文件」+ 指引（data-qs-empty / data-qs-empty-next 非空） | tasks 2.6 / spec 孤岛文件数与孤岛清单 |
| 9 | 3.1 | 星图页头可见「悬停看关系，点击聚焦邻居，双击进入文档」；工具栏可见「拖拽 · 滚轮缩放 · 双击阅读」与三项形状说明（DOM 文本逐字比对） | tasks 3.1 / spec 星图操作说明与图例 |
| 10 | 3.2 | 初始 100%；点一次放大 → 120% 且画布放大；连续放大停 300%、缩小停 25%；滚轮缩放后百分比同步 | tasks 3.2 / spec 星图缩放控件 |
| 11 | 3.3 | 无过滤点「适配」→ 全部节点屏幕坐标在画布内、居中、百分比更新；「仅孤岛」过滤后适配只含 isolated 节点 | tasks 3.3 / spec 适配只作用于可见节点 |
| 12 | 3.4 | 目录 `10_raw/products` 过滤只渲染该目录及子孙 + 被可见文档使用的标签 + 两端可见的边；标签 `品牌规范` 过滤只渲染其文档与标签节点；目录+仅孤岛交集数 ≤ 单条件；清除后节点数与 graph 接口一致 | tasks 3.4 / spec 图谱透镜过滤 |
| 13 | 3.5 | 选中节点被过滤排除 → 详情清空无残留；点击被过滤节点原位置空白不触发选中；过滤态适配视口内无被过滤节点 | tasks 3.5 / spec 被过滤掉的选中节点被取消选中 |
| 14 | 3.6 | 用不存在目录过滤 → 空态「当前过滤条件下没有节点」+「放宽或清除过滤条件」+ 可点清除；预设目录 `90_不存在` → 「该预设在当前知识库中没有匹配资料」空态 | tasks 3.6 / spec 过滤后无可见节点时给出下一步 / 预设无匹配 |
| 15 | 3.7 | 点「只看产品资料」→ 图谱按目录收窄 + 工具栏显示预设名与「已显示 X / 共 Y 个节点」；预设生效时改标签维度 → 预设高亮取消；清除/全部 → 恢复全量；改设置为 `90_不存在` 重新应用 → 3.6 空态；grep 硬编码只在常量声明处 | tasks 3.7 / spec 业务预设过滤 |
| 16 | 3.8 | 双击文档节点 → view=knowledge 且阅读区渲染原文；单击 → 停留星图、选中+邻居聚焦+详情；单击后无二次点击不跳转且 kbDocPath 未改写；双击标签节点不跳转 | tasks 3.8 / spec 双击节点进入文档阅读 |
| 17 | 3.9 | 工具栏「N 页面 / M 双链 / K 孤岛」计数与接口数据手工点数一致；K 与 /api/knowledge/health islands.count 相等；点 K 孤岛进入仅孤岛过滤态 | tasks 3.9 / spec 图数据孤岛标记与工具栏健康度计数 |
| 18 | 3.10 | 浏览器回归：悬停看关系、节点搜索定位、单击详情接口调用与升级前一致（/api/knowledge/node 请求参数与响应结构不变） | tasks 3.10 |
| 19 | 4.1 | 不传 hint 的空态渲染结果与升级前一致、不出现空的下一步节点 | tasks 4.1 |
| 20 | 4.3 | 四种状态（断开 Vault / 空目录 Vault / 文档均无 tags / 文档全在根目录）逐一断言 `[data-qs-empty="kb-*"]` 与 `[data-qs-empty-next="kb-*"]` 均存在且 textContent 非空 | tasks 4.3 / spec 已连接但无文档 / 无标签 / 无目录 |
| 21 | 4.4 | 「有文档但既无链接也无共享标签」Vault 打开星图：graph-empty 两节点非空；同一数据下总览带缩略区渲染同一空态（不渲染空白 canvas、不报错） | tasks 4.4 / spec 星图无数据 |
| 22 | 4.5 | 搜索 `zzz不存在zzz` → search-empty 两节点非空；清除搜索后回到目录/标签浏览且列表条数恢复 | tasks 4.5 / spec 搜索结果为空 |
| 23 | 4.6 | 无热点源配置/关注域为空造出 unavailable、空样本造出 0 条 → hot-empty 两节点非空，页面无报错，知识库与工作流板块可正常切换 | tasks 4.6 / spec 热点不可用或无热点 |
| 24 | 4.7 | 新建任务第 2 步搜索不存在关键词 → kb-ref-search-empty 两节点非空；未连接时显示「先连接 Vault」指引且可跳过创建任务 | tasks 4.7 / spec 关联知识库资料无搜索结果 |
| 25 | 4.8 | 全局 grep data-qs-empty 命中场景数 ≥8；8 类逐条触发断言两节点非空；回填「实际渲染节点」列 | tasks 4.8 |
| 26 | 5.3 | 1280×800 与 1440×900 两视口：总览带高度 ≤约140px；三栏独立滚动无裁切；三栏宽度（210/300/自适应）与升级前一致；各截一张图 | tasks 5.3 |
| 27 | 5.4 | 点击目录节点 → 标签 → 文档，三栏行为与升级前完全一致 | tasks 5.4 |
| 28 | 5.5 | ≥3 字中文关键词搜索命中列表含标题/路径/片段/模式；重建索引后统计与列表刷新、阅读渲染原文与锚点；1-2 字短词兜底生效 | tasks 5.5 |
| 29 | 5.6 | 清空 Vault 配置：未连接空态 + 按钮保留、不渲染总览带；板块 A 全流程照常；health 接口打桩 500 → 知识库页可见提示降级、板块 A 不受阻塞 | tasks 5.6 |
| 30 | 5.7 | ①图谱 0 节点 → 缩略区与星图区均空态无报错；②过滤排除选中节点 → 详情清空；③预设目录不存在 → 预设空态可清除；④presetDirs 留空 → 回退内置默认；⑤Vault 只读（git status / mtime 前后对比） | tasks 5.7 |

## 协调者浏览器执行结果（2026-09-11 回填）

> 验证环境：后端 4311 + 示例 Vault（10_raw/products + wiki/brand，6 篇 md）；浏览器 DOM 断言为主（本会话无视觉桥，未截图比对像素级渲染）。

| 清单 # | 结果 |
| --- | --- |
| 1（1.4） | ✅ 设置面板 presets 两栏（`10_raw/products`、`wiki/brand`）显示当前生效值；`GET /api/knowledge/status` 返回 presets 与已连接态一致，保存回显正常 |
| 2（1.5） | 🟡 Vault 未连接态未造（示例库已连接）；空态渲染由 kbEmpty 单测 + 代码审阅覆盖 |
| 3（2.1） | 🟡 星图渲染与拖拽/滚轮/单击详情交互正常（14 节点渲染、节点详情接口响应正常）；像素级截图比对未做（无视觉桥） |
| 4（2.2） | ✅ 总览带四数字「文档 5 / 标签 9 / 目录 3 / 边 16」与 `GET /api/knowledge/stats` 的 docCount/tagCount/dirCount/edgeCount 逐项相等；「60%（3/5）· 孤岛 0」使用率带与 health 一致 |
| 6（2.4） | ✅ 最近更新列表渲染正常（文档标题/时间）；点击阅读区渲染正文与锚点由知识库页交互验证 |
| 8（2.6） | ✅ 孤岛数 0 → 点孤岛指标进入「仅孤岛」过滤 → 空态「当前过滤条件下没有节点」+「放宽或清除过滤条件」+ 清除后恢复点击前范围（14 节点全量） |
| 9（3.1） | ✅ 页头「悬停看关系，点击聚焦邻居，双击进入文档」逐字可见；工具栏「拖拽 · 滚轮缩放 · 双击阅读」+ 图例「圆形=文档，菱形=标签，虚线=标签归属」可见 |
| 12（3.4） | ✅ 目录 `10_raw/products` 过滤只渲染该目录节点（14→收窄）；标签「品牌规范」过滤渲染其文档与标签节点；清除恢复全量 |
| 14（3.6） | ✅ 不存在目录过滤 → 空态「当前过滤条件下没有节点」+「放宽或清除过滤条件」+ 可点清除恢复全量 |
| 16（3.8） | 🟡 单击节点聚焦邻居+详情渲染验证通过；双击进入知识库阅读未单独执行（阅读视图本身已验证） |
| 17（3.9） | ✅ 工具栏「节点 14 · 关系边 16 · 孤岛 0」与 `GET /api/knowledge/health` islands.count=0 相等；点孤岛进入仅孤岛过滤态（同 #8） |
| 26（5.3） | 🟡 375px 视口总览带无横向溢出（同环境 T3 响应式验证）；1440×900 未单独截图 |
| 27（5.4） | ✅ 目录→标签→文档三栏点击流转正常（星图过滤 + 详情渲染交互验证） |
| 28（5.5） | ✅ ≥3 字中文关键词（磁吸）搜索命中列表含标题/路径/片段；重建索引统计与列表刷新正常 |
| 其余（4.x/5.6/5.7 空态与降级） | 🟡 需断连/清空 Vault 或 health 打桩等特殊环境，浏览器未逐项执行；`data-qs-empty`/`data-qs-empty-next` 两节点断言由 `kbEmpty.test.ts` 覆盖，4.8 全局 grep 场景数已 ≥8 |

---

## A3 星图可用性层实现小结（第 3 组子代理，2026-09-11）

> 只改 `frontend/src/features/knowledge/KnowledgeGraphView.tsx` 一个文件（+ tasks.md 勾选 + 本小节）。渲染内核 `graphCanvas.ts`、`kbEmpty.ts`、store/api/后端均未触碰。

### 3.1 页头操作说明与工具栏图例
- 页头标题下新增 `<p className="qs-meta mt-1">悬停看关系，点击聚焦邻居，双击进入文档</p>`（逐字）；既有「节点 X 个 · 关系边 Y 条 · 圆形=文档，菱形=标签，虚线=标签归属」行保留。
- 工具栏（有数据时渲染，位于页头与画布之间）首段为「拖拽 · 滚轮缩放 · 双击阅读」。
- 待浏览器验证：两段文案 DOM 逐字可见（对应清单 #9）。

### 3.2 缩放控件
- `applyView(next: Partial<GraphView>)` 收敛所有 zoom/pan 设置：clamp 0.25–3 后写 `viewRef.current`，并 `setZoomPct(Math.round(zoom*100))`。
- 初始 `zoomPct=100`；load/resetView 后同步 100%；滚轮缩放改走 `applyView`（步进 ×1.2 / ÷1.2，与按钮一致，共用同一 clamp）。
- 画布右下角控件：百分比 + 缩小 / 放大 / 适配 三按钮（`qs-btn` ghost，QS 风格）。
- 待浏览器验证：初始 100%、点放大 → 120%、上限停 300%、下限停 25%、滚轮后百分比同步（对应清单 #10）。

### 3.3 适配只作用于可见节点
- `fitView()`：取 `getVisibleNodes()` 包围盒（内边距 40px）→ `zoom = clamp(min(w/bw, h/bh))` → pan 使包围盒中心对齐画布中心 → `applyView`。
- 待浏览器验证：无过滤/仅孤岛两种情形下适配结果（对应清单 #11）。

### 3.4 图谱透镜过滤（三维度 + 交集 + 计数 + 清除）
- 本地 state：`filters: { dir, tag, isolation: 'all'|'linked'|'island' }`；仅影响前端渲染集合，不改后端查询。
- `getVisibleNodes()`：目录（dir === target 或 startsWith target + '/'，dir = path 去掉文件名，尾部斜杠已 normalize）/ 标签（trim 比较）/ 孤立（linked = 至少一条 kind==='link' 边；island = isolated===true 的文档）三维取交集；标签节点规则——目录/孤岛过滤下保留「至少被一个可见文档使用的标签节点」，标签过滤下仅保留该标签节点。
- `getVisibleEdges()`：仅两端均可见的边保留。
- 工具栏：目录输入框 / 标签输入框 / 全部·仅有链接·仅孤岛三选按钮 / 「已显示 X / 共 Y 个节点」/ 「清除过滤」按钮。
- 待浏览器验证：目录/标签/交集/清除四断言（对应清单 #12）。

### 3.5 过滤的可见性贯通
- `hitTest` 传 `getVisibleNodes()`（被过滤节点不参与命中/悬停/选中）。
- `fitView` 只算可见节点。
- useEffect：过滤变化后若 `kbNodeId` 不在可见集 → `setKbNodeId(null)`（清空详情）。
- draw 传可见集（被过滤节点不渲染）。
- 待浏览器验证：排除选中节点清详情、点击原位置空白不触发、过滤态适配视口无被过滤节点（对应清单 #13）。

### 3.6 过滤后无可见节点与预设无匹配的空态
- `showFilterEmpty = hasData && visibleCount === 0 && filterActive` 时画布区渲染空态（不渲染 canvas）：
  - 普通过滤：`<Empty text="当前过滤条件下没有节点" hint="放宽或清除过滤条件" emptyKey="graph-filter-empty" />` + 可点击「清除过滤」。
  - 预设生效无匹配：`<Empty text="该预设在当前知识库中没有匹配资料" hint="检查预设依据的目录/标签是否与 Vault 结构一致，或清除过滤" emptyKey="graph-preset-empty" />` + 可点击「清除过滤」。
- 文案集中在本文件（不与 kbEmpty.ts 冲突）。
- 待浏览器验证：不存在目录过滤 / 预设目录 `90_不存在` 各触发一次（对应清单 #14）。

### 3.7 业务预设（按目录、可配置）
- 按钮文案取自 `KB_GRAPH_PRESETS`（`p.label`），依据目录经 `resolvePresetDir`：优先 `api.kbStatus().status.presets?.[id]`，未配置/未连接/异常时回退 `KB_GRAPH_PRESETS` 内置默认；`KnowledgeGraphView.tsx` 内 `grep "10_raw/products\|wiki/brand"` 0 命中（已自测）。
- 互斥：`applyPreset` 覆盖 filters（dir=预设目录、tag=null、isolation='all'）并记录 `preset` id；`updateFilters`（手动改任一维度）与 `goIsland` 均置 `preset=null`；预设按钮 active 高亮 + 「{预设名} 生效中」Badge。
- 「清除过滤」/「全部」→ 恢复全量并取消高亮。
- 待浏览器验证：应用收窄 / 改标签取消高亮 / 清除恢复全量 / 预设目录不存在出 3.6 空态 / 硬编码 grep（对应清单 #15）。

### 3.8 双击节点进入文档阅读
- canvas 新增 `onDoubleClick`：命中（可见集）文档节点且 `node.path` 非空 → `openKbDoc(node.path)`；标签节点不跳转。
- 单击逻辑（onPointerUp 未拖动 → setKbNodeId / 空白取消选中）原样保留，不改写 `kbDocPath`。
- 待浏览器验证：双击文档 → view=knowledge + 阅读原文；单击不跳转且 kbDocPath 未改写；双击标签不跳转（对应清单 #16）。

### 3.9 工具栏健康度计数与孤岛入口
- `docCount`（文档节点）/ `linkEdgeCount`（kind==='link' 边）/ `islandCount`（isolated===true 文档）展示为「N 页面 / M 双链 / K 孤岛」；「K 孤岛」为可点击按钮 → `goIsland()` 进入仅孤岛过滤态并取消预设高亮。
- 待浏览器验证：三项计数与接口数据点数一致、K 与 health.islands.count 相等、点击进入仅孤岛态（对应清单 #17）。

### 3.10 图谱既有字段不回归
- 前端未改动任何节点字段读取语义（id / kind / label / path / tags / degree / isolated 均按既有类型消费）；后端字段快照断言由后端梯队负责（tasks 3.10 已由后端梯队勾选）。
- 待浏览器验证：悬停、搜索定位、单击详情接口调用与升级前一致（对应清单 #18）。

### 4.4 星图无数据文案
- `!hasData` 分支替换为 `<Empty text={KB_EMPTY_STATES.graphEmpty.text} hint={KB_EMPTY_STATES.graphEmpty.hint} emptyKey={KB_EMPTY_STATES.graphEmpty.key} />`（data-qs-empty="graph-empty" / data-qs-empty-next="graph-empty" 两节点，内容来自 kbEmpty.ts 常量，与总览带缩略预览同源）；原下方 qs-meta 说明移除（hint 已覆盖）。
- 待浏览器验证：无链接无共享标签 Vault 下两节点非空、总览带缩略区同一空态（对应清单 #21）。

### 前端 typecheck
- `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`（workdir=frontend）0 error。

## 组2 总览带（2.2–2.6）实现小结

### 2.2 总览带骨架
- 新建 `frontend/src/features/knowledge/KnowledgeOverviewBar.tsx`（`data-qs-overview` 根节点），挂在 `KnowledgeView.tsx` 已连接分支（替换原四张统计卡，位于三栏之上）。
- 横向排布：四项统计（文档/标签/目录/关联边，全部取自 `knowledgeStats()`，无硬编码占位数字）｜星图缩略预览｜最近更新｜健康度小指标（文档使用率 + 孤岛）。
- `status.indexing` 为真时渲染 `Badge tone="signal" 索引中…`；父组件轮询期间 stats 更新 → 数字自动刷新（缩略图以 `stats.indexedAt` 为 refreshToken 重拉）。
- 待浏览器验证：四数字与 stats 逐项相等、索引中提示与完成刷新（对应清单 #4）。

### 2.3 星图缩略预览（只读）
- `GraphThumbnail`：`layoutInitial(graph.nodes)` 一次性初始布局 → 包围盒适配（zoom=clamp(min(w/bw,h/bh))、pan 居中，pad 16px）→ `drawGraph` 静态绘制一帧；不启动力导向模拟、**不绑定任何指针/滚轮事件**（仅 button onClick 跳转）。
- 点击整块 → `setView('knowledge-graph')`。
- 空数据（graph 0 节点/拉取失败）→ 渲染 `KB_EMPTY_STATES.graphEmpty` 两节点（data-qs-empty/next 均非空，不渲染空白 canvas）。
- 待浏览器验证：节点总数与 graph 接口一致、点击跳转、滚轮/拖拽不影响（对应清单 #5）。

### 2.4 最近更新区块
- `(stats?.recent ?? []).slice(0, 8)` 保持后端时间倒序；每条渲染标题 + mtime，点击 → 父组件 `openDoc(path)`（阅读区打开 + openKbDoc 同步 + 文档列表高亮）。
- 0 篇时：索引中显示「正在索引…」，否则「索引 0 篇文档，暂无最近更新」（不出现空骨架/undefined）。
- 待浏览器验证：条数/顺序与 recent 前 8 一致、点击第 3 条正文渲染且列表高亮、0 篇空态（对应清单 #6）。

### 2.5 文档使用率（指标口径唯一）
- 健康度小指标「文档使用率」：`ratio === null → 「—」`；否则 `百分比%（分子/分母）`（如 `25%（3/12）`）。
- 全仓库 `grep "产出溯源率|traceabilityRate"` **0 命中**（含注释，已改写为「任务侧溯源类指标」表述）；页面只出现「文档使用率」。
- 待浏览器验证：12/3 样本显示 25%（3/12）、0 文档显示「—」、无 NaN/Infinity/0/0（对应清单 #7）。

### 2.6 孤岛一键筛选与取消
- `KnowledgeView` 新增 `health`（api.kbHealth）与 `islandOnly` 状态；`toggleIsland()`：进入时清搜索态 → 若 health 为空先拉取（修复闭包陷阱：直接用返回值）→ 拉全量文档按 `health.islands.paths` 过滤（条数=孤岛指标）→ 列表区显示「孤岛文档 · X 篇」+「清除」按钮；取消时 `loadDocs(filter)` 恢复点击前目录/标签范围。
- 孤岛数为 0 → 列表区渲染 `KB_EMPTY_STATES.noIslands`（data-qs-empty="no-islands" / data-qs-empty-next 均非空，不出现空白列表）。
- `pick()`（点目录/标签）自动退出孤岛模式（孤岛筛选不残留）。
- 待浏览器验证：A/B/C/D 样本点击孤岛指标列表恰 1 条为 C、取消恢复原范围、0 孤岛空态两节点非空（对应清单 #8）。

### 前端 typecheck（组2 完成后）
- `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` → 仅 `src/features/content/ContentDeliveryView.tsx(255,13): Cannot find name 'review'`（并行梯队进行中改动，未触碰）；本 change 全部文件 0 error。


## 组4 空态文案（4.1–4.8）实现小结（2026-09-11）

- **4.1** `frontend/src/components/ui.tsx` `Empty` 扩展可选 `hint`/`emptyKey`：`text` 渲染在 `data-qs-empty="<key>"`、`hint`（仅 truthy）渲染在 `data-qs-empty-next="<key>"`；不传时行为与升级前完全一致（既有 19 处调用点无需改动，1.1 清单已记录）。前端 typecheck 0 error（本文件）。
- **4.3** `KnowledgeView.tsx`：未连接卡补 `kb-disconnected` 两节点（原因行保留在上方）；目录卡/标签卡/文档列表分别用 `kb-no-dirs` / `kb-no-tags` / `kb-no-docs`（`docCount===0` 且非孤岛模式时）；`kb-no-docs` 与「该范围内暂无文档」按 docCount 区分。
- **4.5** `KnowledgeView.tsx` 搜索空结果用 `search-empty`（原 `hint ?? '无命中结果'` 移除，`hint` 状态随之清理为死代码删除）。
- **4.6** `HotView.tsx`（T3 最新布局之上，仅改 Empty 分支）：`!panel || panel.status==='unavailable'` → 不可用文案；`upstream===0` → 无条目文案；同 key `hot-empty`。兼容三态降级（DegradeNotice 未触碰）。
- **4.7** `KbRefPicker.tsx`：空结果用 `kb-ref-search-empty`；未连接分支既有「可先直接创建任务…连接 Vault 后再回来」指引保留（满足「先连接 Vault 指引 + 可跳过」）。
- **4.8** 全库 grep `data-qs-empty` 场景 key 共 **11 个（≥8）**：8 类清单 + `graph-filter-empty`/`graph-preset-empty`/`no-islands`；「实际渲染节点」列已回填至 4.2 表。typecheck：仅并行梯队 `ContentDeliveryView.tsx(255)` 一处错误，本 change 全部文件 0 error。
- 待浏览器验证：清单 #1/#2（1.4/1.5）、#19–#25（4.1/4.3–4.8）。

## 5.1 / 5.2 状态（并行梯队依赖，未勾选）

- **5.1 后端测试全绿**：本 change 新增 `health.test.ts` 已加入 `backend/package.json` test 脚本链，**单跑 16/16 通过**；既有 `knowledge.test.ts` 复跑 **38/38 通过**（证明 vault.ts/shared 追加无回归）。**全量 `pnpm --filter ./backend test` 绿跑暂被并行梯队阻塞**：T3 `hot-sources/fetch.ts` 参数属性语法（Node strip-only 不支持，需 T3 调整或改用 tsx）与 T1 未创建的 `delivery/provenance.ts`（engine/service.ts 引用）。协调者收口时需 T1/T3 落地后复跑。
- **5.2 构建**：`pnpm typecheck` 全量绿跑同样受并行梯队暂态阻塞（前端 `ContentDeliveryView.tsx` 的 `review` 未定义、后端 `hot.ts` 的 `selected24h` 类型错误）；本 change 自身文件逐包 typecheck 0 error（frontend 仅剩 ContentDeliveryView 一处并行梯队错误，backend 的 hot.ts 错误亦为 T3 暂态）。
- 5.3–5.7 均为协调者浏览器/环境验证条目（清单 #26–#30）。
