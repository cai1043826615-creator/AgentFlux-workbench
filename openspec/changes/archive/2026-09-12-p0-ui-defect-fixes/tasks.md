## 1. 星图初始视图适配（knowledge-graph）

- [x] 1.1 在 `KnowledgeGraphView.tsx` 中新增自动适配触发：以「图谱数据已就绪」且「画布尺寸已就绪」为双前置条件，用 ref 标记保证进入视图后只自动调用一次 `fitView()`；验证：进入星图视图，节点团块居中且完整可见，画布无大面积空白（对应 spec「初始加载自动适配视口」）
- [x] 1.2 验证自动适配不覆盖用户手动视图：`autoFitRef` 保证只执行一次，过滤/数据变化不重置视图（对应 spec「手动视图不被自动适配覆盖」）
- [x] 1.3 复核既有手动适配入口未被破坏：工具栏「适配全部可见节点」按钮仍调用同一 `fitView()`，未被改动

## 2. 看板列宽固定与横向滚动（task-board）

- [x] 2.1 修改 `BoardView.tsx` L291 列容器类名：四列统一为 `w-[300px] flex-none`，移除「空列 `w-[96px]` / 满列 `min-w-[200px] flex-1`」的条件分支；验证：`git diff` 确认无残留 96px/200px 分支，全库仅剩 300px
- [x] 2.2 确认容器横向滚动生效：容器保持既有 `overflow-x-auto`（L287）未改动，四列固定宽度后总宽超出即触发横向滚动
- [x] 2.3 回归验证卡片按钮不折行：300px 列宽 ≥ 原满列临界值，且既有 `white-space: nowrap`（index.css `.qs-btn`）未被改动

## 3. 「其他」热点分组可收起（daily-hot）

- [x] 3.1 ~~重构 `HotView.tsx` 的分组渲染~~ **已满足，无需改动**：实测 HEAD 中 `HotView.tsx` L749-753 已存在「收起」按钮，`collapsedOther` 已可双向切换，折叠与展开互为可逆。第二轮走查文档该条结论对当前代码已过期（文档基于更早修订版）。经用户确认跳过本项，仅保留 spec 中的可逆性要求作为回归约束（避免将来被改回单向）。
- [x] 3.2 拆分标题行文案：折叠态改为「其他 · 12 条」、展开态标题行改为「其他 / 12 条」，判定口径移入 `title` 属性；验证：标题行不再出现「未命中关注域」，悬停可见
- [x] 3.3 回归验证序号连续性：`seqById` 由 `tiers` 全量遍历预先构建（HotView L644-648），不受分组的折叠/展开状态影响，序号始终跨分组全局连续

## 4. 内容交付：版本次序与参考图文案（content-delivery）

- [x] 4.1 调整 `ContentDeliveryView.tsx` 渲染次序：`<CopyVersionPanel>` 由原「标题之后、正文之前」移至「关键词之后」；验证：`git diff` 确认调用点已下移，标题与正文之间不再有历史版本区块
- [x] 4.2 历史版本默认收起并用标题栏控件触发：`CopyVersionPanel` 新增 `open` 状态（默认 `false`），标题栏改为「▸ 历史版本 (N)」按钮，展开后才渲染版本下拉/内容预览/对比面板
- [x] 4.3 ~~修正参考图文案判定~~ **已满足，无需改动**：实测 HEAD 中 `ContentDeliveryView.tsx` L643-647 已按 `task.referenceImage` 三分支输出文案（该分支自 commit `b3cdc56` 起存在）。文档 N14 所举的 #7（Apple 热点任务）实测 `referenceImage` 已为 `/uploads/002bbef5-….png`，即该任务当前确实带参考图，显示「AI 产出将基于参考图生成」是正确的。文档该条结论基于走查时的旧数据，对当前数据不成立。保留为回归约束：无参考图任务须走「未提供参考图 / 暂无参考图」分支。
- [x] 4.4 回归验证审批可达性：卡片内「采纳 / 打回」区块（L361-390）与 `approveBox` 均未被移动或改动，仅历史版本区块下移

## 5. Markdown 链接色约束机制（knowledge-base）

- [x] 5.1 在 `index.css` 的 `@layer components` 中新增 `.qs-doc-link`（链接色只读 `var(--color-signal)`，hover 用 `--color-signal-strong`），并让 `Markdown.tsx` 三处链接（wiki 链接、内部文档链接、锚点）改用该类；**未改动任何 `--color-*` 令牌值**；验证：`--color-signal` 仍为 `#7c3aed`
- [x] 5.2 验证令牌驱动生效：`qs-doc-link` 颜色声明为 `var(--color-signal)`，无其他硬编码色值；令牌变更即链接色变更，无需改链接代码
- [x] 5.3 回归验证链接可点击性：`onOpenDoc` 回调与 `qs-clickable` 类均保留，仅替换颜色声明方式，跳转能力不变

## 6. 整体验证

- [x] 6.1 运行 `tsc --noEmit`（前端）→ 退出码 0；后端 20/21 测试通过、前端 2/2 通过。**唯一失败 `hot-intel-core.test.ts`「最近 24h 条目数应 > 0」为既有失败**：已用 `git stash` 在干净 HEAD 上复现同样 28 pass / 1 fail，证明与本轮改动无关（本轮仅改前端，未触碰 `backend/`）
- [x] 6.2 前后端已启动（backend :4311 `/health` ok、frontend :4310 HTTP 200），并校验各改动模块经 Vite 转译后正常产出（`index.css` 含 `.qs-doc-link`、`Markdown.tsx` 引用该类）
- [x] 6.3 本轮 6 项改动均为定向修复，未新增交互路径；既有测试与类型检查均无新增失败
- [x] 6.4 越界检查通过：`git diff --name-only` 仅含 6 个前端文件（BoardView / ContentDeliveryView / HotView / KnowledgeGraphView / Markdown / index.css），`packages/` 与 `backend/` 零改动，工位栏零改动

---

## 本轮偏离文档的记录（供回溯）

| # | 文档原结论 | 实测结果 | 处理 |
| --- | --- | --- | --- |
| N1 | Markdown 链接被 Tailwind 默认紫覆盖，应加 lint 禁类名 | `#7C3AED` 即 `--color-signal` 的值；全库 `violet\|purple\|indigo` 类名 0 处命中 | 用户定案 A：不改色，只补 `.qs-doc-link` 结构性约束 |
| N14 | 无参考图任务仍显示「基于参考图生成」 | `referenceImage` 三分支自 `b3cdc56` 已存在；#7 当前实际带参考图 | 判为过期结论，跳过代码改动 |
| #11 | 「其他」展开后无法收起 | HEAD L749-753 已有「收起」按钮，可双向切换 | 经用户确认跳过 3.1，仅做 3.2 文案拆分 |
