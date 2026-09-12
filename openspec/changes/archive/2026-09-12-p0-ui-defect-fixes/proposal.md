## Why

第二轮 UI 走查（`D:\AI\workbuddy\2026-09-11-19-23-34\输出\第二轮诊断与低保真原型.html`）对当前 master 做了真实启动走查与源码核对，识别出 6 项 P0 级缺陷：其中 4 项是明确的交互/功能断裂（星图首屏空白、热点分组无法收起、版本认知错位、参考图文案矛盾），2 项是上轮修复的同类问题复发或回退（Markdown 链接色约束缺失、看板列宽失衡）。这些缺陷不修则 P1 的信息架构调整会建立在错误的地基上——例如星图 fitView 未修则侧栏折叠优化失去意义，看板列宽未修则卡片副标题补文案后仍会折行。

## What Changes

- **星图初始视图自动适配**：`KnowledgeGraphView.tsx` 已有 `fitView()` 函数（L345）但仅在工具栏按钮上挂载（L751），数据首次加载完成后自动调用一次，消除首屏约 60% 空白。
- **看板列宽固定 + 横向滚动**：`BoardView.tsx` L291 当前空列 `w-[96px] flex-none`、满列 `min-w-[200px] flex-1`，实测 1440px 下呈 96/96/456/456，最窄与最宽差 4.75 倍。改为四列统一固定 300px + 容器横向滚动，卡片宽度恒定。
- **「其他」热点分组可收起**：`HotView.tsx` L725-739 展开分支渲染时未回流折叠控件，导致点一次展开后分组按钮从 DOM 消失、无法收起。补齐可逆的折叠开关，并把「分组名 + 判定原因」混排的一行拆开（原因移入 tooltip）。
- **任务详情历史版本位置调整**：`ContentDeliveryView.tsx` 当前顺序为「标题 → 版本v1 → 历史版本 → v1内容预览（默认展开）→ 当前正文」，用户无法区分当前版本与历史版本。当前正文置顶，历史版本收为标题栏右侧按钮、默认收起、点击后在下方展开对比。
- **参考图判定文案修正**：无参考图的任务（如由热点创建的 #6/#7）仍显示「AI 产出将基于参考图生成」。判定逻辑分叉为：有参考图 → 「基于参考图生成」；无参考图 → 「由 AI 生成主图（无参考图）」。
- **Markdown 链接色约束机制**：`Markdown.tsx` L37/L53 的 wiki 链接计算色为 `rgb(124,58,237)`，与 `--color-signal` 同值。**本轮不改颜色**（token 值由用户定案保持 `#7C3AED`），仅补齐约束机制，防止 Tailwind 默认色类名再次覆盖 QS 变量导致同类问题第三次复发。

**非目标**：本轮不含 P1 的信息架构调整（总览带重构、公共侧栏抽取、重点目录可增删改、通知移入设置、小助理预留位）；不含 P2 的 DocPreviewModal、灵感库重构、知识库小助理功能实现；工位栏不作任何改动。

## Capabilities

### New Capabilities

无。本轮为既有能力的缺陷修复，不引入新能力。

### Modified Capabilities

- `knowledge-graph`: 「图谱可视化」补充初始加载后自动适配视口的要求（fitView 时机）。
- `task-board`: 「Four-column task board」补充列宽固定与横向滚动的布局要求。
- `daily-hot`: 「热点面板信息分层与响应式排版」补充「其他」分组的可收起交互要求。
- `content-delivery`: 「Copy package preview」补充当前版本与历史版本的呈现次序要求；新增无参考图场景的文案判定要求。
- `knowledge-base`: 「Markdown 原文阅读」补充链接色必须来自 QS 令牌、不得被工具类覆盖的约束要求。

## Impact

**前端（唯一影响面，无后端/契约改动）**

| 文件 | 改动性质 |
| --- | --- |
| `frontend/src/features/knowledge/KnowledgeGraphView.tsx` | 数据加载后调用一次既有 `fitView()` |
| `frontend/src/features/board/BoardView.tsx` | 列容器与列宽类名调整，新增横向滚动 |
| `frontend/src/features/knowledge/HotView.tsx` | 分组折叠状态收口为可逆开关 |
| `frontend/src/features/content/ContentDeliveryView.tsx` | 区块次序调整、默认折叠、参考图文案分叉 |
| `frontend/src/index.css` | 新增链接色约束（不改动既有 `--color-*` 令牌值） |

**不影响**：`packages/shared` 契约、`backend/` 路由与数据库、WS 协议、工作流状态机。

**回归风险**：看板列宽改动会影响所有看板卡片的换行行为（上轮曾修过按钮折行，需复核）；`ContentDeliveryView` 区块次序调整需复核采纳/打回按钮的可达性未被破坏。
