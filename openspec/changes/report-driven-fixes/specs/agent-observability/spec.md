## MODIFIED Requirements

### Requirement: Execution statistics

执行统计/健康度口径 SHALL 采用**三通道合并**判定资产是否"被使用"：① 被任务关联（`task_kb_refs`）② 被 Agent 挂载（`workflow_skills` / `workflow_files` 并集）③ 被其他文档引用（wiki 链接），避免把已在生效的挂载/引用资产误判为"孤岛/未使用"（修 D-25）。按处置决议：健康度/孤岛**界面隐藏、代码与接口保留**。

#### Scenario: 已挂载技能不被误判孤岛

- **WHEN** 统计某技能的使用情况
- **THEN** 被 Agent 挂载的技能计入"已使用"，不再误判为孤岛

#### Scenario: 健康度界面隐藏

- **WHEN** 用户打开知识库/星图页
- **THEN** 不展示孤岛计数等健康度 UI（后端统计接口保留可用）
