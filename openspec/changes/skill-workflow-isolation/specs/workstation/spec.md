## ADDED Requirements

### Requirement: 配置弹窗内按工作流分份展示挂载
Agent 配置弹窗的「技能与文件」卡片 SHALL 按**工作流分份**展示挂载：每个工作流一行（工作流名 + 已挂条目列表 + 独立的「＋ 挂载」按钮），文件一行。每行的「＋ 挂载」SHALL 只作用于该行对应的目标份（电商行的按钮打开电商份的挂载弹窗，文件行的按钮打开文件挂载）；行内条目的 × SHALL 直接从对应份移除并即时生效（随配置弹窗「保存」持久化）。SHALL NOT 在配置弹窗内把不同工作流份混排展示。

#### Scenario: 分份展示互不混排
- **WHEN** 用户打开一个在电商份挂了「电商文案模板」、在小红书份挂了「小红书合规违禁词清单」的 Agent 配置
- **THEN** 电商行只显示「电商文案模板」，小红书行只显示「小红书合规违禁词清单」，无并集混排

#### Scenario: 行内挂载按钮定向生效
- **WHEN** 用户点击小红书行的「＋ 挂载」并勾选一个通用类技能后完成
- **THEN** 该技能加入小红书份，电商份不变

#### Scenario: 行内 × 即时移除
- **WHEN** 用户点击电商份某条目上的 × 并保存
- **THEN** 该技能从电商份移除，小红书份不变

## MODIFIED Requirements

### Requirement: Mount skills and files per agent

The system SHALL allow mounting skills and files onto individual agents, scoped only to that agent. The mountable skill catalog SHALL be organized into **business-domain sections** — 电商 (e-commerce), 小红书 (XHS), 通用 (general) — and the mount picker SHALL render the skill area **grouped by these sections** rather than as one flat list. A section SHALL be omitted when it contains no mountable skill. A skill's section SHALL be derived from its location in the skills directory, and an optional declaration in the skill's own header SHALL override that derived value. When a skill declares a section the system does not recognize, the declared value SHALL be preserved and displayed rather than silently replaced with a default. Any skill file placed directly in the skills root SHALL be treated as 通用 so that existing flat layouts keep working. Every mountable skill SHALL carry a non-empty section, so that a skill can never surface without a section to group it under.

挂载选择 SHALL 通过**二级弹窗**完成（验收 #6）：从配置弹窗各工作流行的「＋ 挂载」打开独立于配置主弹窗的二级 Modal。弹窗 SHALL 聚焦**进入时指定的目标份**（该工作流份或文件份）的完整编辑——技能目录按业务域分组（电商→小红书→通用）、顶部搜索框按名称/描述过滤；同时 SHALL 以只读摘要呈现其余份的当前状态（一屏看到全部工作流）。二级弹窗内容区 SHALL 可滚动（max-height 约束），分区标题 SHALL 吸顶；选择 SHALL 先暂存于组件内状态，用户点击「完成」后一次性保存目标份，取消/关闭 SHALL NOT 产生任何变更；打开期间 SHALL 阻止外层配置弹窗滚动（防滚动穿透），并支持 Esc 与遮罩关闭及焦点圈闭。

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

#### Scenario: 从电商行进入聚焦电商份
- **WHEN** 用户在配置弹窗电商工作流行的「＋ 挂载」打开二级弹窗
- **THEN** 弹窗主区为电商份的技能目录勾选，且同屏可见小红书份与文件分区的只读摘要

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
