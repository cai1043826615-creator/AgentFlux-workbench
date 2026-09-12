## Context

本变更是对已落地的前端 UI 优化（分支 `ui-optimization-2026-09-11`，19 个提交）的规格化收敛。动机见 `proposal.md` - Why；规格要求见 `openspec/changes/ui-optimization-2026-09-11/specs/`。

当前约束：

- 前端为 React 18 + TypeScript + Tailwind（Vite 6），单页应用，无路由库，视图切换靠 `location.hash` 手写实现。
- 全站样式分两层来源：`index.css` 的自定义组件类（`.qs-*`）与 Tailwind 工具类。Tailwind v3 使用 `@layer base / components / utilities` 的级联顺序，**未分层 CSS 的优先级高于任何 `@layer` 内的规则**。
- 状态集中在单一 Context（`store/useWorkbench.tsx`），同时承载 HTTP 拉取与 WebSocket 推送。
- 后端监听 4311，前端 dev server 4310 通过 vite proxy 转发。

## Goals / Non-Goals

**Goals**

- 把已实现的 UI 行为固化为可校验的规格，使 `openspec/specs/` 与代码重新对齐。
- 记录并锁定两处根因级修复，防止回归：
  1. 样式分层（`@layer components`）——否则 `.qs-input { width: 100% }` 会压过 `w-[Npx]` / `flex-1`，导致配置弹窗输入框宽度塌陷不可见。
  2. hash 路由只写不读——补 `hashchange` / `popstate` 回绑，恢复前进后退与刷新保持。
- 统一「同一份数据的口径」：顶栏角标与看板列数必须来自同一数据源，避免两处计数不一致。

**Non-Goals**

- 不引入路由库（react-router 等）、状态库（zustand/redux）或 UI 组件库。
- 不重构后端接口契约；不修改工作流引擎与数据库结构。
- 不做视觉体系（配色/字体/间距 token）的整体重设计，仅按走查意见做局部收敛。
- 不改动 `daily-hot` 的存储枚举取值（仅 UI 层展示中文标签），以免破坏后端 `isEcommerceVertical()` 判定。

## Decisions

### 1. 组件类统一纳入 `@layer components`

**决定**：把 `index.css` 中全部 `.qs-*` 组件类包进 `@layer base`（基础元素样式）与 `@layer components`（组件类）。

**理由**：Tailwind 的级联顺序为 `base < components < utilities`，只有分层后，工具类才能覆盖组件类默认值。此前 `.qs-input { width: 100% }` 未分层，优先级高于 `@layer utilities` 中的 `w-[140px]`，使关注域配置弹窗内同一 flex 行的输入框被兄弟节点挤成 0 宽度而完全不可见。

**替代方案**：给每个输入框加 `!important` 或内联 `style={{ width }}`。**否决**：`!important` 会污染全局工具类语义，内联样式绕过分层体系、后续维护者无法从类名判断生效宽度。分层是一次性根因修复，且后续所有工具类都受益。

**落地约束**（已写进 `HotView.tsx` 注释）：该弹窗内宽度一律用 Tailwind 工具类表达，不要改回行内 style 或改写 `.qs-input`。

### 2. hash 路由采用「回绑 + 自触发跳过」

**决定**：在 Provider 内监听 `hashchange` 与 `popstate`，从 hash 解析出 view 与 taskId 并同步状态；应用自身写入 hash 前先记录 `appliedHashRef`，回调里若发现 hash 等于该值则跳过，避免重复拉取任务详情。

**理由**：原实现只写不读，导致浏览器前进后退、分享链接、刷新都无法恢复视图。跳过自触发是必要的：`location.hash = x` 本身会触发 `hashchange`，若不跳过会造成「写 → 触发 → 再拉详情」的重复请求。

**替代方案**：引入 react-router。**否决**：仅需 view + taskId 两个维度，引入路由库会带来约 10KB+ 体积与一层新的状态同步问题，收益不成比例。

### 3. 顶栏角标改为从 `tasks` 派生

**决定**：`pendingCount = tasks.filter(t => t.column === 'awaiting' && !t.archived).length`，替换原先的 `approvalQueue.length`。

**理由**：`approvalQueue` 是 WS 推送的增量队列，与看板实际渲染的 `awaiting` 列存在口径差（含已归档任务），导致顶栏数字与看板列数对不上。改为从同一 `tasks` 派生后，两处天然一致。

**权衡**：`approvalQueue` 仍然保留，继续承担「触发待确认通知 / Toast」的职责——它表达的是「新事件」，而角标表达的是「当前状态」，两者职责不同，不应合并。

### 4. WS 处理抽成稳定回调以支持重连

**决定**：把原来内联在 `useEffect` 里的 WS 消息处理抽为 `handleWsMessage`（`useCallback`），再封装 `startWs`，暴露 `reconnect`。

**理由**：原实现在 effect 内一次性建立连接，断开后无法重试。抽成稳定回调后，`reconnect` 可先关闭旧连接（避免重复订阅）再重建，且顶栏与聊天面板共用同一个 `connected` 状态，消除「顶栏说断开、聊天框说在线」的不一致。

### 5. 反馈提示分两栈、分工不重叠

**决定**：新增「通用动作反馈」栈固定底部居中；既有任务通知栈保留右下角。两者 z-index 分别 80 / 70。

**理由**：任务通知（待确认 / 完成）是**需要用户处理的信号**，应占据最显眼的右下角并常驻；动作反馈（归档成功等）是**操作回执**，短暂即可。若共用一栈，轻量回执会挤掉高优先级信号。

### 6. 表单校验改为「交互后提示」

**决定**：新建任务弹窗引入 `touched` 状态，用户编辑标题 / 描述、切换平台、选择参考图时才置为 `true`；只有 `touched && !canNext` 才渲染红色校验文案，否则渲染中性提示。

**理由**：原实现打开弹窗即显示「● 请先填写任务标题」，属「未开始就报错」的负面体验。校验应在用户表达意图之后出现。

### 7. 折叠 rail 的分组语义下沉到 tooltip

**决定**：折叠态移除常驻的「知识库 / 工作流 / 通用」文字标签与分隔线外的分组标题，改由每个图标的 tooltip 携带分组前缀（如「知识库 · 知识星图」）。

**理由**：rail 宽度仅 48px，常驻中文分组标签会溢出或被迫换成极小字号；tooltip 无空间成本，且 hover 时能给出更完整的说明。分隔线保留，仍能传达分组边界。

## Risks / Trade-offs

- **[样式分层改动影响全站]** → 分层后组件类的优先级下降，任何**依赖组件类压过工具类**的既有写法都会失效。缓解：改动后跑全量 build（vite 会报 CSS 语法错误）+ 人工走查各视图宽度/字号类；已在 `index.css` 内写明「必须分层」的注释。
- **[hash 回绑可能与首载逻辑重复拉取]** → 首载时 `applyHash()` 与 `refresh()` 都会触发。缓解：`appliedHashRef` 初值置空，首载只在 hash 指向 task 时补拉详情；日常刷新走 `refresh()` 拉列表。
- **[角标口径切换后数字会变小]** → 用户可能觉得「数量怎么少了」。缓解：这是修正——归档任务本就不该计入主视图角标；同时 spec 场景 `Archived tasks excluded from badge` 明确该行为为预期。
- **[反馈提示上限 4 条可能吞掉早期回执]** → FIFO 淘汰。缓解：耗时操作（归档/重试）本身就是幂等的最终态操作，回执丢失影响小；真正需要留意的信号走右下角任务通知栈，不受 4 条上限约束。
- **[vite 代理端口 4311 vs 4312 曾反复改动]** → 缓解：以「后端实际监听端口」为唯一事实源，代理配置不得单方面修改；本次在 spec 的 Impact 与 tasks 中均标注。

## Migration Plan

无数据迁移、无接口变更，属纯前端行为与样式收敛。

发布步骤：

1. `pnpm install --offline --frozen-lockfile`（确保共享包依赖完好）。
2. `pnpm typecheck && pnpm build && pnpm test` 全绿。
3. `openspec validate ui-optimization-2026-09-11 --strict` 通过。
4. `openspec archive ui-optimization-2026-09-11` 把 delta 同步进 `openspec/specs/` 并归档。
5. 合并 `ui-optimization-2026-09-11` → `master`。

回滚策略：前端改动无状态副作用，回滚即 `git revert` 对应提交；因未改后端与库表，回滚不涉及数据修复。

## Open Questions

无。本变更规划的是已实现并已通过全量校验的行为，不存在需要推迟决策的未知项。
