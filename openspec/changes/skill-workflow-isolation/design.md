## Context

技能体系现状（经源码核实）：技能库目录已实体化为 `docs/示例Vault/技能库/{电商,小红书,通用}/`，`listSkills()` 返回带 `category` 的技能元数据（目录即分类，文件头 `> 分类：` 可覆盖，未知分类原样保留——`skills.ts` L40-78）；挂载注入走 `buildSystemPrompt`（smart-producer.ts L122，读取 `agents.skills` 展示名数组逐个 `readSkillContent`）→ `buildProducerSystemPrompt`（L177，追加工作流专属技能/知识库/热点/返工段）；展示层 `AgentSettingsModal` 内嵌挂载面板按三分区渲染。

断层：注入层对挂载技能**无工作流维度**——小红书技能挂上后电商任务照样注入全文；展示层在技能多时溢出不可滚动。验收单建议文档（`docs/相关设计文件/技能挂载与工作流隔离优化建议-2026-09-14.md`）已给出方案骨架，本 design 补齐关键决策。

## Goals / Non-Goals

**Goals:**

- 电商任务只用电商+通用挂载技能；小红书任务只用小红书+通用（注入层真实过滤）
- 未知 workflowId 兜底全可见；无分类技能不消失；失效标红不回归
- 挂载选择二级弹窗：左右两栏、可滚动、吸顶、搜索、暂存-一次性保存
- 合规清单（WORKFLOW_SKILLS）强制追加行为不变

**Non-Goals:**

- 不改挂载数据模型（不加跨域标记字段、`agents.skills` 仍为展示名数组）
- 不做技能自动推荐、不做按任务动态挂载
- 不改技能目录结构与分类解析规则
- 不动知识库/热点/返工注入通道

## Decisions

### 1. 映射表放 shared 层（`packages/shared/src/workflow.ts`）

`WORKFLOW_CATEGORIES: Record<string, string[]>` 与 `WORKFLOW_ID`/`XHS_WORKFLOW_ID` 同文件，前后端共用同一份真源（前端任务侧展示过滤、后端注入过滤同口径）。辅助函数 `allowedCategoriesFor(workflowId): string[] | null`（null = 未知工作流全可见）。

**替代方案**：放 smart-producer 顶部常量。否决——前端展示过滤需要同口径，shared 才能单源。

### 2. 过滤点在 `buildSystemPrompt`（读取全文之前），签名加 workflowId

`buildSystemPrompt(agentId, base, workflowId?)`：解析挂载列表后先查每个技能的 category，不在 allowed 集合的**直接跳过 `readSkillContent`**（省 IO 与 token），再对剩余技能读全文注入。category 快查走 `skills.ts` 新增 `skillCategoryOf(skillId): Promise<string | null>`（复用 ensureIndex 索引，不整表扫描）。未知分类（null/非三类）→ 视为兜底可见，**不过滤**（对应 spec「无分类技能不消失」）。

**替代方案**：在 `buildProducerSystemPrompt` 过滤。否决——那里已拿到各段字符串，过滤发生在读全文之后，浪费 IO 与 token；且 `buildSystemPrompt` 还有别的调用点（非 producer 场景不传 workflowId = 全可见，天然兜底）。

### 3. WORKFLOW_SKILLS 保持原样（独立机制，不合入映射表）

合规清单的语义是「无论挂没挂都强制注入」，与「挂载后按分类过滤」正交。合并成一个机制会让「未挂载却注入」的特例藏在过滤逻辑里，可读性差、spec 也要多绕一层。两个机制、两个段落、两条 spec 需求，各自简单。

### 4. 二级弹窗用现有 Modal 基础组件（`components/ui.tsx` 的 Modal）

不引原生 `<dialog>`：项目 Modal 已有遮罩/Esc/焦点圈闭实现（DocPreviewModal 验证过），复用保证视觉与交互一致。滚动穿透阻断：二级弹窗 open 时给外层配置弹窗内容区加 `overflow: hidden`（组件内 useEffect 同步，关闭时还原）。

### 5. 暂存-一次性保存的状态管理

`SkillMountPicker` 内部持有 `Set<string>` 暂存勾选（以打开时的挂载列表初始化），「完成」时 diff 出全量列表一次 `PUT /api/agents/:id`（与既有保存同 endpoint 同负载形状，只是频率变低）。取消/Esc/遮罩 = 丢弃暂存。文件挂载不进二级弹窗（保持现状的内联添加）——用户验收原话只针对 skill 选择。

**替代方案**：勾选即存（每次 PUT）。否决——用户明确要「弹窗选择 + 完成」，且半保存状态会让「完成前关闭不产生脏数据」无法成立。

### 6. 任务侧技能展示：现有 UI 没有该区块，本轮不新增

核实：任务详情/看板卡片当前**不展示**所用技能（无此 UI 元素）。spec 的「任务侧按工作流过滤展示」需求以「若展示则必须同口径过滤」的约束语义落地——本轮实现注入过滤即可让「显示却未生效」无从产生；UI 区块本身列为后续可选项，不在 tasks 里（避免造没人要的界面）。若用户要这个展示，验收时提，另开小 change。

## Risks / Trade-offs

- **用户「挂了却不生效」的困惑**：过滤只发生在后端注入，Agent 配置里技能仍显示已挂 → 在挂载面板分区说明文案中加一句「技能按工作流分类生效：电商任务仅使用电商+通用类技能」（一行灰字，不造新 UI）
- **categoryOfPath 与文件头覆盖的双源**：skillCategoryOf 必须与 listSkills 同一套解析（复用 parseSkillMeta + categoryOfPath），否则展示徽标与注入过滤可能不一致 → 单一函数导出复用，测试断言一致性
- **暂存丢失（误触 Esc）**：与 DocPreviewModal 同款确认语义——有未保存变更时关闭需 confirm（沿用项目既有 confirm 风格）
- **性能**：skillCategoryOf 走内存索引（ensureIndex 已缓存），过滤开销可忽略
