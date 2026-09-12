## ADDED Requirements

### Requirement: 通用动作反馈反馈提示

系统 SHALL 提供一个通用的动作反馈提示（Action Toast）机制，用于向用户确认轻量操作的结果。该提示 SHALL 固定在视口底部居中呈现，SHALL NOT 与右下角的任务通知栈（待确认 / 任务完成）争夺位置。每条提示 SHALL 携带语气（`ok` / `signal` / `no` / `default`）以决定左侧强调色，SHALL 支持可选的「动作按钮」（如「撤销」）与可选的自动消失时长；未指定时长时 SHALL 常驻直到用户手动关闭。常驻条数 SHALL 有上限（4 条），超出时淘汰最早的一条。

#### Scenario: 操作后出现反馈提示
- **WHEN** 用户执行归档、恢复、采纳、打回、重试图片或保存配置等操作
- **THEN** 底部居中位置出现一条带语气色条的反馈提示，文案说明该操作的结果

#### Scenario: 提示不遮挡任务通知
- **WHEN** 右下角任务通知栈与底部居中反馈提示同时存在
- **THEN** 两者各占其位、互不重叠，用户可分别阅读

#### Scenario: 带动作按钮的提示
- **WHEN** 某条提示带有动作按钮（如「撤销」）
- **THEN** 点击该按钮执行对应动作并关闭该条提示

#### Scenario: 常驻条数上限
- **WHEN** 连续触发超过 4 条反馈提示且均未被关闭
- **THEN** 界面最多同时显示 4 条，最早的一条被自动淘汰

#### Scenario: 自动消失与手动关闭
- **WHEN** 某条提示设置了自动消失时长
- **THEN** 该条在时长到达后自动消失；未设置时长的提示保持常驻，直到用户点击关闭

## MODIFIED Requirements

### Requirement: Execution statistics

The system SHALL compute per-agent execution statistics: total runs, success count, success rate, and average duration, optionally broken down by workflow stage. Sub-panels that load execution data asynchronously SHALL render a loading skeleton while data is in flight, so that an empty layout is never mistaken for "no data".

#### Scenario: Workstation card shows statistics

- **WHEN** user views an agent workstation card
- **THEN** the card shows the agent's run count, success rate, and average duration

#### Scenario: Statistics by stage

- **WHEN** user views execution statistics
- **THEN** statistics can be broken down by workflow stage (e.g. 卖点文案, 主图设计, 详情图设计)

#### Scenario: Loading skeleton for async sub-panels

- **WHEN** a sub-panel (task detail, knowledge, observability) is still loading its data
- **THEN** the panel shows a loading skeleton placeholder instead of an empty or "no data" state, and switches to real content once the data arrives
