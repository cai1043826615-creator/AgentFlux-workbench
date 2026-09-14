## ADDED Requirements

### Requirement: 工作流技能可见性与使用边界透明
任务详情 SHALL 让用户能看出「哪些技能实际作用于该任务」：展示的所用技能 = Agent 挂载技能 ∩ 该任务工作流的分类映射范围（与 skill-context 的注入过滤同一口径）。被工作流边界滤除的技能 SHALL NOT 出现在任务侧的技能展示中，避免「显示却未生效」的误导。Agent 配置弹窗（`AgentSettingsModal`）SHALL 保持完整三分区视图——它是唯一展示全部分类的入口。

#### Scenario: 任务侧技能展示按工作流过滤
- **WHEN** 用户查看一个电商工作流任务所用到的技能
- **THEN** 展示列表只含分类为「电商」「通用」的挂载技能，不含「小红书」分类技能（即使该 Agent 挂载了它）

#### Scenario: Agent 配置保留完整分区
- **WHEN** 用户打开任意 Agent 的配置弹窗挂载面板
- **THEN** 技能目录按 电商/小红书/通用 完整三分区展示，不因当前无任务上下文而被过滤

#### Scenario: 任务侧不展示未生效技能
- **WHEN** Agent 挂载了小红书分类技能但当前任务属于电商工作流
- **THEN** 任务详情的技能展示中不出现该技能（不存在「显示了但没用上」的状态）

## MODIFIED Requirements

### Requirement: Mount skills and files per agent

The system SHALL allow mounting skills and files onto individual agents, scoped only to that agent. The mountable skill catalog SHALL be organized into **business-domain sections** — 电商 (e-commerce), 小红书 (XHS), 通用 (general) — and the mount picker SHALL render the skill area **grouped by these sections** rather than as one flat list. A section SHALL be omitted when it contains no mountable skill. A skill's section SHALL be derived from its location in the skills directory, and an optional declaration in the skill's own header SHALL override that derived value. When a skill declares a section the system does not recognize, the declared value SHALL be preserved and displayed rather than silently replaced with a default. Any skill file placed directly in the skills root SHALL be treated as 通用 so that existing flat layouts keep working. Every mountable skill SHALL carry a non-empty section, so that a skill can never surface without a section to group it under.

挂载选择 SHALL 通过**二级弹窗**完成（验收 #6）：点击「＋ 挂载 skill 和文件」打开独立于配置主弹窗的二级 Modal，采用左右两栏布局——左栏为已挂载列表（含分类徽标、失效标红、×移除），右栏为可挂目录（按业务域分区 + 顶部搜索框按名称/描述过滤）。二级弹窗内容区 SHALL 可滚动（`max-height` 约束 + `overflow-y: auto`），分区标题 SHALL 吸顶；选择 SHALL 先暂存于组件内状态，用户点击「完成」后一次性保存，取消/关闭 SHALL NOT 产生任何变更；打开期间 SHALL 阻止外层配置弹窗滚动（防滚动穿透），并支持 Esc 与遮罩关闭及焦点圈闭。

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

#### Scenario: 挂载多技能时二级弹窗可完整滚动
- **WHEN** Agent 挂载 20+ 技能并打开挂载二级弹窗
- **THEN** 两栏内容在弹窗内完整可见并可滚动，分区标题吸顶，列表不再溢出屏幕且外层弹窗不跟随滚动

#### Scenario: 搜索过滤技能
- **WHEN** 用户在二级弹窗搜索框输入关键词（如「SEO」）
- **THEN** 右栏仅显示名称或描述命中关键词的技能，清空关键词恢复分区全量

#### Scenario: 完成前关闭不产生脏数据
- **WHEN** 用户在二级弹窗中勾选/取消若干技能后未点「完成」而直接 Esc 或点击遮罩关闭
- **THEN** Agent 的挂载关系保持打开前状态，无部分保存

#### Scenario: 完成后一次性保存
- **WHEN** 用户在二级弹窗完成勾选并点击「完成」
- **THEN** 系统一次性保存全部变更（一次持久化调用），挂载列表与分区计数即时更新
