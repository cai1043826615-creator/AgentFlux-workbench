# Workstation

## Purpose

Defines the workstation capability that manages agent workstations: each agent card shows persona, role, model, online status, and supports editing persona, mounting skills and files, with content isolated per agent.

## Requirements

### Requirement: Agent workstation cards

The system SHALL render a workstation area displaying one card per agent, each card showing avatar, agent name, configured model, job role, and online status. The workstation area SHALL be **expanded by default**. When collapsed, it SHALL present an **avatar row** in which every agent shows a small avatar with its status dot together with the agent's **name and job role**, so the collapsed form remains identifiable without expanding. The collapsed row SHALL remain a single compact row that gives vertical space back to the main view.

The workstation area SHALL render **only the workflow crew** (文案 / 设计师 / 主管). The knowledge-base assistant agent (role 助理) SHALL NOT be rendered in the workstation area — the workstation's semantics are the workflow crew, and the assistant does not participate in the workflow. The assistant SHALL instead appear in the knowledge overview bar via the shared agent-card component.

#### Scenario: Display agent cards

- **WHEN** user opens the workstation area
- **THEN** each configured agent (文案, 设计师, 主管) is shown as a card with avatar, name, model, role and status

#### Scenario: Show online status

- **WHEN** an agent is processing a task
- **THEN** its card shows an online indicator with activity state (e.g. "正在" or "上次活跃 n 分钟前")

#### Scenario: Workstation expanded by default

- **WHEN** user opens the board page for the first time in a session
- **THEN** the workstation area renders in its expanded form showing the full agent cards

#### Scenario: Collapsed form shows avatar with name and role

- **WHEN** user collapses the workstation area
- **THEN** each agent appears as a small avatar with its status dot, followed by the agent's name and job role

#### Scenario: Collapsed form stays compact

- **WHEN** the workstation area is collapsed
- **THEN** it occupies a single row of reduced height, returning the freed vertical space to the main view

#### Scenario: Assistant agent excluded from workstation

- **WHEN** the knowledge-base assistant agent exists
- **THEN** the workstation area shows exactly three cards (文案 / 设计师 / 主管) and the assistant is not rendered there

### Requirement: Agent persona editing

The system SHALL allow the user to edit each agent's persona (人设), including role description and behavioral instructions.

#### Scenario: Edit agent persona

- **WHEN** user opens the edit dialog for an agent and saves a new persona
- **THEN** the agent's persona is updated and persists across sessions

### Requirement: Mount skills and files per agent

The system SHALL allow mounting skills and files onto individual agents, scoped only to that agent. The mountable skill catalog SHALL be organized into **business-domain sections** — 电商 (e-commerce), 小红书 (XHS), 通用 (general) — and the mount picker SHALL render the skill area **grouped by these sections** rather than as one flat list. A section SHALL be omitted when it contains no mountable skill. A skill's section SHALL be derived from its location in the skills directory, and an optional declaration in the skill's own header SHALL override that derived value. When a skill declares a section the system does not recognize, the declared value SHALL be preserved and displayed rather than silently replaced with a default. Any skill file placed directly in the skills root SHALL be treated as 通用 so that existing flat layouts keep working. Every mountable skill SHALL carry a non-empty section, so that a skill can never surface without a section to group it under.

挂载选择 SHALL 通过**二级弹窗**完成（验收 #6 + 三轮定案）：从配置弹窗某工作流份的「＋ 挂载」打开独立于配置主弹窗的二级 Modal。弹窗 SHALL **只显示进入的那条工作流**——SHALL NOT 展示其它工作流份的只读摘要（总览仅存在于 Agent 设置弹窗的 scope=all 视图）。弹窗 SHALL 包含两个区域：**技能区**（按业务域分组：电商→小红书→通用，顶部搜索框按名称/描述过滤）与**文件区**（知识库文档，同一样式的搜索框）。技能目录 SHALL 按**目标工作流过滤**：电商份弹窗只出现「电商 + 通用」分组，小红书份弹窗只出现「小红书 + 通用」分组（未识别分类按通用兜底）。文件列表 SHALL 排除已挂到**另一条**工作流的文件（可选文档已全部被占用时给出提示）。每个分组 SHALL 提供**收纳三角**，点击可整组收起/展开，分组计数保持可见。二级弹窗内容区 SHALL 可滚动（技能区/文件区各自 max-height 约束），分区标题 SHALL 吸顶且贴合裁切边缘（滚动条目不得从标题上方露出）；选择 SHALL 先暂存于组件内状态，用户点击「完成」后一次性保存目标份（技能与文件），取消/关闭 SHALL NOT 产生任何变更；打开期间 SHALL 阻止外层配置弹窗滚动（防滚动穿透），并支持 Esc 与遮罩关闭及焦点圈闭。

#### Scenario: Mount a skill to an agent

- **WHEN** user attaches a skill to an agent
- **THEN** the skill is listed on that agent's card and only that agent can use it

#### Scenario: Mount a file to an agent

- **WHEN** user attaches a file to an agent
- **THEN** the file is listed on that agent's card and only that agent can access it in its tasks

#### Scenario: Skill picker shows business-domain sections

- **WHEN** user opens the mount picker for an agent
- **THEN** the skill area renders one labeled group per non-empty section, ordered 电商 then 小红书 then 通用, with each group listing only the skills belonging to that section

#### Scenario: Section shows how many of its skills are mounted

- **WHEN** a section contains at least one skill already mounted on the agent
- **THEN** that section's label shows a mounted count in the form "已挂 N/M", where M is the number of skills in the section

#### Scenario: Every mountable skill has a section

- **WHEN** the mountable skill catalog is read
- **THEN** every skill reports a non-empty section, and a skill found directly in the skills root reports 通用

#### Scenario: Unrecognized declared section is preserved

- **WHEN** a skill declares a section the system does not recognize
- **THEN** the skill is presented under that declared value instead of being forced into a default section

#### Scenario: Mounted skill shows its section

- **WHEN** the mount picker lists the skills already mounted on the agent
- **THEN** each mounted skill displays its section as a badge next to its name

#### Scenario: 从电商行进入只显示电商份
- **WHEN** 用户在配置弹窗电商工作流份的「＋ 挂载」打开二级弹窗
- **THEN** 弹窗只包含电商份的技能目录（电商+通用分组）与文件区，且不出现小红书工作流份的任何内容或摘要

#### Scenario: 技能目录按工作流过滤
- **WHEN** 用户在小红书工作流份的挂载弹窗中浏览技能目录
- **THEN** 只出现「小红书 + 通用」分组，电商分组的技能（如「电商文案模板」）不出现

#### Scenario: 已挂到另一工作流的文件不再出现
- **WHEN** 某知识库文档已挂到电商份，用户打开小红书份的挂载弹窗文件区
- **THEN** 该文档不出现在小红书份的可挂列表中；可选文档全部被占用时给出提示

#### Scenario: 变更只落目标份
- **WHEN** 用户在电商份弹窗勾选「电商文案模板」并点「完成」
- **THEN** 仅电商份更新，小红书份不变

#### Scenario: 挂载多技能时二级弹窗可完整滚动
- **WHEN** Agent 挂载 20+ 技能并打开挂载二级弹窗
- **THEN** 弹窗内容完整可见并可滚动，分区标题吸顶，列表不再溢出屏幕且外层弹窗不跟随滚动

#### Scenario: 搜索过滤技能
- **WHEN** 用户在二级弹窗搜索框输入关键词（如「SEO」）
- **THEN** 目录仅显示名称或描述命中关键词的技能，清空关键词恢复全量

#### Scenario: 完成前关闭不产生脏数据
- **WHEN** 用户在二级弹窗中勾选/取消若干技能后未点「完成」而直接 Esc 或点击遮罩关闭
- **THEN** Agent 的挂载关系保持打开前状态，无部分保存

#### Scenario: 完成后一次性保存
- **WHEN** 用户在二级弹窗完成勾选并点击「完成」
- **THEN** 系统一次性保存目标份变更（一次持久化调用），挂载列表与分区计数即时更新

### Requirement: Mounted skill and file validity is visible

The system SHALL indicate, in the agent's mounted list, whether each mounted skill and file still resolves to an existing catalog entry. A mounted entry that no longer resolves SHALL be marked as invalid **in the same list**, in a visually distinct way, and SHALL remain removable. The system SHALL NOT present an unresolvable mount as if it were in effect.

The system SHALL seed agents only with mounts that resolve to an existing skill catalog entry or mounted file. Seeding SHALL NOT attach a skill or file whose only viable content is an empty fallback.

#### Scenario: Unresolvable mount is marked invalid

- **WHEN** an agent has a mounted skill that no longer exists in the skill catalog
- **THEN** that entry is displayed with an explicit invalid marker, distinguishable from a valid mount, and can still be removed by the user

#### Scenario: Resolvable mount shows no invalid marker

- **WHEN** every mounted skill of an agent resolves to a catalog entry
- **THEN** no entry in the mounted list carries the invalid marker

#### Scenario: Seeded mounts all resolve

- **WHEN** agents are seeded
- **THEN** every seeded skill resolves to an existing skill catalog entry and every seeded file resolves to an existing mounted file, so no agent starts with a mount that can only produce empty content

#### Scenario: Legacy file mounts migrate to a supported extension

- **WHEN** the backend starts against an existing database whose agent file mounts reference `.pdf` files that the mounted-file whitelist never supported
- **THEN** those references are replaced, once and idempotently, with their `.md` counterparts that exist in the mounted-file directory, and no other entries in the agent's file list are altered

### Requirement: Per-agent content isolation

The system SHALL isolate content, skills, files, and contexts between agents so that one agent cannot see another agent's private materials.

#### Scenario: Content isolation between agents

- **WHEN** two agents are configured with different mounted files and skills
- **THEN** each agent only sees its own mounted content and none of the other agent's

### Requirement: Per-agent model configuration

The system SHALL allow each agent to be configured with an independent AI model.

#### Scenario: Configure different models

- **WHEN** the user sets model A for the 文案 agent and model B for the 设计师 agent
- **THEN** each agent uses its own configured model for its tasks

### Requirement: Online status and activity

The system SHALL display whether each agent is online, busy, or idle, and update the status as the agent works.

#### Scenario: Status update while working

- **WHEN** an agent begins processing a task
- **THEN** its workstation card status changes to online/busy with current activity

### Requirement: 配置弹窗内按工作流分份展示挂载
Agent 配置弹窗的「技能与文件」卡片 SHALL 按**入口区分显示范围**（用户定案 2026-09-14）：
- 从**工作流看板的工位栏**打开（scope=workflow）：SHALL 只渲染**左栏当前工作流**的那一份（在电商看板打开只见电商份；小红书同理），SHALL NOT 出现另一条工作流的份。
- 从 **Agent 状态 / 知识库等通用区**打开（scope=all，默认）：SHALL 总览渲染**两条工作流**的份，各自独立编辑。
每个工作流份 SHALL 包含：工作流名 + 已挂计数（技能 N · 文件 M）+ 标题行右侧两个独立上传按钮（**「上传技能」「上传文件」**）+ 已挂条目列表（SKILL 与 FILE 同列，各带 × 移除）+ 一个「＋ 挂载」按钮。SHALL NOT 再设置独立的全局「文件」分区（文件与技能同属工作流份成对挂载）。行内条目的 × SHALL 直接从对应份移除并即时生效（随配置弹窗「保存」持久化）。

#### Scenario: 工位栏入口只显示当前工作流份
- **WHEN** 用户在电商新品上架看板打开某 Agent 的配置弹窗
- **THEN** 「技能与文件」卡片只显示电商工作流份，不出现小红书工作流份

#### Scenario: Agent 状态入口显示总览
- **WHEN** 用户从「Agent 状态」页打开同一 Agent 的配置弹窗
- **THEN** 「技能与文件」卡片同时显示电商工作流份与小红书工作流份

#### Scenario: 文件与技能成对挂载，无全局文件区
- **WHEN** 用户查看任一工作流份的挂载列表
- **THEN** SKILL 与 FILE 条目同列展示，且不存在独立于工作流的全局「文件」分区

#### Scenario: 行内 × 即时移除
- **WHEN** 用户点击电商份某条目上的 × 并保存
- **THEN** 该技能从电商份移除，小红书份不变

#### Scenario: 上传按钮位于工作流标题右侧
- **WHEN** 用户查看任一工作流份的标题行
- **THEN** 行右侧并排提供「上传技能」与「上传文件」两个独立入口，上传成功后自动挂到该工作流份
