## Context

技能体系现状（经源码核实）：技能库目录已实体化为 `docs/示例Vault/技能库/{电商,小红书,通用}/`，`listSkills()` 返回带 `category` 的技能元数据；挂载注入走 `buildSystemPrompt`（smart-producer.ts，读取 `agents.skills` 全局数组）→ `buildProducerSystemPrompt`；展示层 `AgentSettingsModal` 内嵌挂载面板。

用户验收打回后定位升级：**隔离的真正语义是「挂载按工作流分份」**——不是「全局挂载 + 注入按分类过滤」。用户原话证据：「我在电商挂载的 skill，在小红书也能看到，在小红书删除的 skill，电商也删掉了」——这证明用户期望挂载关系本身按工作流分份；同时要求二级弹窗**一屏呈现全部工作流份**（不切换），文件与 skill 同层进弹窗。

## Goals / Non-Goals

**Goals:**

- 挂载关系按「工作流 × Agent」分份存储（`agents.workflow_skills` JSON 列）
- 任务注入直接取该任务工作流的份（挂什么用什么；分类过滤逻辑废弃）
- 二级弹窗一屏呈现：电商份 / 小红书份 / 文件 三个分区上下排布，独立勾选
- 文件与 skill 同层进二级弹窗（用户定案：两者同层级概念）
- 既有全局挂载迁移为每份初始值（不丢数据）；`agents.skills` 保留为并集只读视图

**Non-Goals:**

- 不做「先选工作流再切换查看」的交互（用户明确否定）
- 不改技能目录结构与分类解析规则（分区徽标仍用）
- 不动知识库/热点/返工注入通道
- 不做按任务动态挂载/自动推荐

## Decisions

### 1. 数据模型：`agents.workflow_skills` JSON 列（而非新表）

`ALTER TABLE agents ADD COLUMN workflow_skills TEXT`（`ensureSchema` 幂等补列）。值为 `{"ecom-new-listing":["技能A",...],"xhs-note":[...]}`——key 为 workflowId，值为展示名数组（与既有 `agents.skills` 同形态）。

**替代方案**：新表 `agent_workflow_skills(agent_id, workflow_id, skill_name)`。否决——一行 JSON 与既有 `skills`/`files` 列形态一致，读取无需 join，规模（每 Agent 2-3 个工作流 × 10 技能）远未到需要关系表的程度。

### 2. 迁移：懒式 + 读时兜底（一次性 UPDATE 不必要）

读取挂载份时：`workflow_skills` 为空/缺 key → **回退到旧全局 `agents.skills` 并返回之**（等价于「每份初始值=旧全局挂载」，且不写库、零迁移风险）；用户在某份保存时才真正写 `workflow_skills[key]`。`agents.skills` 更新为各份并集（保存时同步维护），供任务卡片等既有只读展示兼容。

**替代方案**：启动时批量迁移全部 Agent。否决——多一次全表写，且「读时回退」语义等价、实现更薄。

### 3. 注入：`buildSystemPrompt` 改为接受「挂载技能列表」而非 agentId 内查

`buildSystemPrompt` 增加重载参数：producer 路径传**该任务工作流的份**（`smart-producer` 调用点从 task.workflowId 查份）；上一轮的 `allowedCategoriesFor` 分类过滤**整体移除**（挂什么用什么，不再按分类过滤）。非 producer 调用点不传列表 → 回退旧行为（读 `agents.skills` 并集），兼容不回归。

### 4. API：挂载读写走 `PUT /api/agents/:id` 扩展负载

既有 `updateAgent` 负载 `{persona, model, skills, files}` 扩展 `workflowSkills` 字段（可选）；后端写入 `workflow_skills` 列并重算 `skills` 并集。GET `/api/agents` 返回体增加 `workflowSkills`（前端弹窗初始化用）。旧客户端不传该字段 → 不触碰分份数据（兼容）。

### 5. 二级弹窗布局：从各工作流行的「＋ 挂载」进入，弹窗聚焦该份 + 文件

用户定案：配置弹窗「技能与文件」卡片改为**分份展示**（A 形态）——每个工作流一行：`已挂列表（×可删） + 独立的「＋ 挂载」按钮`，文件同样一行。**每行的挂载按钮只作用于该行对应的份**（电商行的按钮只改电商份；文件行的按钮只改文件）。二级弹窗从该行进入后：主区为该份的完整编辑（目录三分区勾选+搜索+吸顶），同时以只读摘要形式呈现另一工作流份与文件的当前状态（满足「一屏看到 2 个工作流」），其变更仍只能在自己分区的勾选中进行。文件不分工作流（资料性质无工作流语义），作为独立分区与技能份同级。

**替代方案**：配置弹窗只显示并集、二级弹窗呈现全部分份的编辑（上一轮方案）。否决——用户明确要求配置弹窗内直接可见工作流维度挂载并可分别挂载。

### 6. 文件挂载同层进弹窗（全局一份）

文件不分工作流（挂载文件是资料性质，无工作流语义），配置弹窗独立一行 + 二级弹窗独立分区：目录勾选 + 上传，随「完成」一起保存（`files` 字段不变）。

## Risks / Trade-offs

- **并集视图的语义模糊**：`agents.skills` 变成派生并集后，「任务卡片上的技能徽章」显示的是全量而非该任务所用 → 本轮不改卡片展示（既有 UI 无技能徽章，实测确认），后续若加任务侧展示直接读份
- **分类过滤逻辑移除后的「挂错」风险**：用户在电商份挂了小红书技能会真的注入 → 这正是用户要的「挂什么用什么」显式语义；分区内的目录仍按业务域分组，误挂可见
- **旧库兼容**：`workflow_skills` 缺列/空值全程回退旧字段，升级零停机
- **一次保存负载变大**：两份技能+文件一次 PUT——字段均为小数组，负载可忽略
