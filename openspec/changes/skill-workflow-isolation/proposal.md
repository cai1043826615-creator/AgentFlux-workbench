## Why

验收单「技能分区挂载 · 技能库实体化」第 2/3/6 项的用户备注指出了技能体系的两个断层：**① 工作流之间技能不隔离**——小红书技能挂上后，电商任务的 prompt 也会注入它的全文，用户看到的是「所有 skill 都显示、都被使用」，与「按工作流挂载」的直觉相悖；**② 挂载选择器在技能多时溢出屏幕且不可滚动**，且用户希望通过二级弹窗选择。技能库目录已实体化（`docs/示例Vault/技能库/{电商,小红书,通用}/`，目录即分类），注入链（`buildSystemPrompt`→`buildProducerSystemPrompt`）与分区展示（`AgentSettingsModal`）均已就位，本变更在这条链上补两块：**按工作流过滤的可见性与使用边界**、**二级弹窗式挂载选择器**。

## What Changes

**① 工作流级技能可见性与使用隔离**

- 新增单一映射表 `WORKFLOW_CATEGORIES: Record<workflowId, string[]>`（shared 层）：电商工作流 → `['电商','通用']`；小红书工作流 → `['小红书','通用']`；未列出的 workflowId → 全分类可见（兜底，防新工作流技能凭空消失）。
- **注入过滤（后端）**：`buildProducerSystemPrompt` 组装【挂载技能】段时按任务 `workflowId` 过滤——分类不在映射表内的挂载技能不进 prompt（在读取全文之前过滤，省 token）；`WORKFLOW_SKILLS`（小红书合规违禁词清单→xhs-note）作为**工作流专属强制追加项**独立保留，不受过滤影响。
- **展示过滤（前端）**：`AgentSettingsModal` 的挂载选择器内按当前上下文过滤的分区视图保留完整三分区（Agent 配置是唯一能看到全部分区的入口）；如任务侧展示「所用技能」，按同一映射过滤。
- **语义决策（已定）**：「通用」对所有工作流可用；**不加**「显式跨域」标记——严格按分类过滤，语义更可预期（用户原话「电商只显示挂载的电商 skill 和我选择的 skill」落地为：挂载动作仍在 Agent 配置自由进行，但**使用/展示**按工作流分类过滤）。
- 回归底线：无分类技能不消失；失效标红全量可见；合规清单行为不回归（skills.test.ts 与验收脚本 C1 复用）。

**② 挂载选择改二级弹窗 + 滚动修复**

- 从 `AgentSettingsModal` 抽出 `SkillMountPicker`（新组件）。
- 点击「＋ 挂载 skill 和文件」打开二级 Modal：左栏已挂载（分类徽标/失效标红/×移除）、右栏可挂目录（电商/小红书/通用分区 + 搜索框）；`max-height:70vh; overflow-y:auto`；分区标题吸顶。
- 勾选即暂存组件 state，底部「完成」一次性保存（减少请求、避免半保存状态）；Esc/遮罩关闭；二级弹窗打开期间外层配置弹窗禁止滚动（防穿透）。

**非目标**：

- 不改挂载关系的数据模型（`agents.skills` 仍是展示名数组，不加跨域标记字段）。
- 不做「按工作流自动推荐技能」。
- 不改技能库目录结构与分类规则。

## Capabilities

### Modified Capabilities

- `workstation`: 挂载技能的使用与展示按工作流分类隔离（新需求 + 既有 picker 需求补二级弹窗交互与滚动行为）。

### New Capabilities

- `skill-context`: 技能注入的工作流隔离能力——映射表、注入过滤规则、工作流专属技能强制追加、兜底语义、回归底线。

## Impact

| 文件 | 改动 |
| --- | --- |
| `packages/shared/src/workflow.ts`（或新文件） | `WORKFLOW_CATEGORIES` 映射表 |
| `backend/src/agents/smart-producer.ts` | `buildSystemPrompt` 增加 workflowId 参数与分类过滤（在读取技能全文之前） |
| `backend/src/agents/skills.ts` | 可能新增 `skillCategoryOf(skillId)` 快查（listSkills 已返回 category，或走索引） |
| `frontend/src/features/workstation/AgentSettingsModal.tsx` | 挂载入口改二级弹窗、抽出 SkillMountPicker |
| 新增 `frontend/src/features/workstation/SkillMountPicker.tsx` | 二级弹窗组件 |
| `backend/src/agents/__tests__/skills.test.ts`（或新增隔离测试） | 注入过滤断言 |

**不受影响**：工作流状态机、任务派发、知识库/热点注入通道（`buildKnowledgeContext`/`buildHotContext`）、返工注入、Vault 只读承诺。

**风险**：过滤导致用户「明明挂了却不生效」的困惑 → 任务侧不展示被过滤技能即可见性一致；兜底分支（未知 workflowId 全可见）保证新工作流不静默丢技能。
