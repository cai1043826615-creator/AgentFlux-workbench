## ADDED Requirements

### Requirement: 技能按工作流分份挂载与注入
每个 Agent 的技能挂载 SHALL 按「工作流 × Agent」**分份存储**（`agents.workflow_skills` JSON：`{"ecom-new-listing":[...],"xhs-note":[...]}`），而非全局单一数组。任务产出的 prompt 注入 SHALL 直接取**该任务所属工作流的挂载份**（挂什么用什么）；工作流之间互不影响——在某工作流视图下新增或移除技能 SHALL NOT 改变其他工作流的挂载份。「通用」类技能同样按份挂载（分份语义无例外）。Agent 级 `agents.skills` SHALL 保留为**只读派生视图**（各份并集），供既有展示兼容，SHALL NOT 再作为注入数据源。既有全局挂载 SHALL 在首次使用时复制为该 Agent 每个工作流份的初始值（不丢数据）。

#### Scenario: 电商份挂载不影响小红书份
- **WHEN** 用户在电商工作流分区为美美挂载「电商文案模板」
- **THEN** 小红书工作流分区中该技能不出现，小红书任务的 prompt 也不含它

#### Scenario: 小红书份移除不影响电商份
- **WHEN** 用户在小红书工作流分区移除「素材结构化」（通用类）
- **THEN** 电商工作流分区中「素材结构化」保持已挂，电商任务的 prompt 仍含它

#### Scenario: 任务注入直接取本工作流的份
- **WHEN** 一个电商工作流任务进入文案产出
- **THEN** prompt 的【挂载技能】段内容 = 美美的电商份（而非并集、也不做分类过滤——挂什么用什么）

#### Scenario: 通用类技能同样分份
- **WHEN** 用户只在电商份勾选「质检清单」（通用类）
- **THEN** 小红书任务的 prompt 不含「质检清单」

#### Scenario: 既有全局挂载迁移不丢数据
- **WHEN** 系统首次读取一个只有旧版全局 `agents.skills` 的 Agent
- **THEN** 其现有技能被复制为该 Agent 每个工作流份的初始值，后续各份可独立编辑

#### Scenario: 派生视图保持兼容
- **WHEN** 任一工作流份发生变化
- **THEN** `agents.skills`（并集读视图）同步更新，既有按该字段的展示（如任务卡片）不回归
