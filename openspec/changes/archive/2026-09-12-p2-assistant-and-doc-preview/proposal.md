## Why

P1 归档后，第二轮走查定的三个方向性功能还剩两个可在本轮落地：文档引用目前一律「跳页打开」（星图节点点「阅读原文」会离开星图、任务详情关联资料会离开任务详情），上下文丢失严重；知识库小助理在 P1 已铺好入口位（`useFirstAssistantAgent()` 预留 + AgentCard 组件复用），只差实体与能力。用户已就小助理给出 4 条定案：涉及 Agent 的界面都要更新；电商工作流不体现小助理；总览带位置放右侧；带与工位一致的收起功能。

## What Changes

**F3 · 知识库小助理（先做，P1 已铺路）**

- `AgentRole` 增加 `'助理'`，seed 增加小助理实例（名「涵涵」，模型 deepseek-chat，只读知识库场景）。
- 总览带小助理位从「占位卡」切换为**真实 Agent 卡**（P1 的 `useFirstAssistantAgent()` 自动命中，零改动），位置从入口组**中间移到右侧**（用户定案），并加**收起/展开**功能（与工位栏一致的交互语义）。
- 涉及 Agent 的界面同步更新：**Agent 状态页**显示小助理状态卡；**聊天框**私聊头像行显示小助理（可与它私聊）；**Agent 设置弹窗**天然支持（复用既有组件）。
- **电商工作流严格不体现**：工作流阶段条（`ROLE_TO_AGENT_NAME` 三角色映射）、任务派发（`AGENT_BY_ROLE`）、群聊播报署名映射均不加入「助理」——小助理不接任务、不出现在任何任务阶段上。
- 能力边界（沿用对接文档已定案②）：**只读** Vault；产出写入工作台自己的**草稿区**（新增独立容器），用户预览后手动「沉淀进知识库」才落盘（沉淀 = 写入 Vault 之外的空白目录需用户指定，或首期仅落库到草稿区供复制——首期做后者，写入 Vault 属后续增强，需用户另授权）。
- 三个能力入口：① 提交文档 → 整理成 md（产出进草稿区）② 每日热点 → 整理进灵感库方向（产出进草稿区）③ 定期整理知识库 → 产出「整理建议 + 预览 diff」进草稿区。

**F1 · DocPreviewModal（文档预览大弹窗）**

- 新建全局 `<DocPreviewModal>`：所有「快速查看文档」的引用统一走弹窗，不再整页跳转。
- 接入点：星图节点详情「阅读原文」、任务详情「关联知识库资料 · 阅读原文」、Markdown 正文内 wiki 链接与内部文档链接。
- 弹窗内能力：正文渲染（复用 `Markdown.tsx`）、**关联文档在弹窗内切换**（可回退栈，支持「← 返回上一份」）、右侧「引用此资料的任务」区块。
- 保留跳转的场合：知识库页内点文档列表 → 仍在阅读区原地打开；弹窗内「在知识库中打开 ↗」→ 跳转并关闭弹窗。
- 可访问性：Esc 关闭、遮罩可点关闭、焦点锁、宽度 min(920px, 92vw)、高度 86vh 内部滚动。

**非目标（本轮不做）**

- F2 灵感库重构（相关性分层、收进灵感库主操作、灵感库设置）——涉及新数据容器与公开信息源可行性验证，单独一轮 propose。
- 小助理**写入 Vault**（即「沉淀进知识库」真正落盘到用户目录）——首期只到草稿区，落盘需用户另授权。
- 小助理参与工作流、出现在任务阶段条 / 播报署名 / 工作群聊（用户定案：不参与）。

## Capabilities

### New Capabilities

- `doc-preview`: 全局文档预览弹窗能力——所有「快速查看」类文档引用的统一弹窗行为、弹窗内导航、可访问性与跳转保留边界。
- `kb-assistant`: 知识库小助理能力——助理 Agent 实体的角色定义、Agent 面板的纳入范围与工作流隔离边界、只读 + 草稿区产出模型、总览带入口位置与收起交互。

### Modified Capabilities

- `knowledge-overview`: 总览带小助理入口由「占位卡」改为「真实 Agent 卡」，位置移至右侧，增加收起/展开。
- `knowledge-base`: 阅读视图的文档打开方式增加「弹窗预览」通道（原地阅读保留，二者边界明确）。
- `knowledge-graph`: 节点详情「阅读原文」改为打开预览弹窗（不再跳页）。
- `chat`: 私聊可与小助理会话（聊天面板 Agent 列表的纳入）。
- `workstation`: Agent 卡组件被总览带小助理位复用的既有事实升格为 spec 要求；Agent 状态页纳入小助理。
- `agent-observability`: Agent 状态页包含小助理（执行统计只统计其自身调用）。

## Impact

**前端**

| 文件 | 改动 |
| --- | --- |
| `store/useWorkbench.tsx` | 新增 `docPreviewPath` 全局态 + `openDocPreview()/closeDocPreview()` |
| 新建 `components/DocPreviewModal.tsx` | 弹窗本体（Markdown 渲染 + 弹窗内导航栈 + 引用此资料的任务） |
| `features/knowledge/KnowledgeGraphView.tsx` | 节点详情「阅读原文」改走弹窗 |
| `features/status/TaskDetailView.tsx` | 关联资料「阅读原文」改走弹窗 |
| `features/knowledge/Markdown.tsx` | `onOpenDoc` 优先走弹窗（知识库页阅读区内保持原地打开） |
| `features/knowledge/KnowledgeOverviewBar.tsx` | 小助理位移右侧 + 真实 Agent 卡 + 收起/展开 |
| `features/workstation/WorkstationBar.tsx` | 工位栏是否显示小助理：**不显示**（用户定案：它不参与工作流；工位=工作流班组） |
| `features/chat/ChatPanel.tsx` | 私聊头像行纳入小助理（过滤 role === '助理' 不剔除） |
| `features/observability/ObservabilityView.tsx` | Agent 状态页纳入小助理 |

**共享契约**

| 文件 | 改动 |
| --- | --- |
| `packages/shared/src/types.ts` | `AgentRole` 增加 `'助理'` |

**后端**

| 文件 | 改动 |
| --- | --- |
| `backend/src/db/seed.ts` | 新增小助理 seed（id `agent-assistant`，name `涵涵`，role `助理`，model `deepseek-chat`） |
| `backend/src/agents/` | 新增 assistant Agent 执行逻辑（只读知识库检索 + 整理产出，复用既有 llm.ts / skills.ts 基建） |
| 新增草稿区存储 | `kb_drafts` 表（SQLite，独立于 Vault，只读承诺不破）+ 读写路由 |

**不影响**：工作流状态机、任务派发逻辑、WS 协议、Vault 文件系统（保持只读）。

**风险**：`AgentRole` 加值会让「按角色遍历」的前端（工位栏 grid、聊天头像行、状态页 grid）自动多出小助理——工位栏需显式过滤，聊天与状态页按用户定案显式纳入；`Markdown.tsx` 的 `onOpenDoc` 行为分叉（弹窗 vs 原地）需要按挂载场景区分，防误伤知识库页阅读区的既有体验。
