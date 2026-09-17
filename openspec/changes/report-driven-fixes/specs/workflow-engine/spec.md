## MODIFIED Requirements

### Requirement: Missing workflow definition fails loudly

任务执行到**不在其工作流定义中的阶段**时，系统 SHALL **显式报错**（返回错误、界面可见提示），不得静默 200 无响应（修 D-01「遗留阶段任务静默卡死」）。内置工作流定义的启动同步（`syncBuiltinWorkflow`）SHALL 补阶段存在性校验：定义中引用的每个阶段必须可解析，解析失败时启动日志告警并显式暴露问题。

#### Scenario: 遗留阶段任务不再静默卡死

- **WHEN** 一个任务卡在已废弃阶段（如旧版 `xhs-image`），用户点击推进/采纳
- **THEN** 系统返回明确错误提示（阶段不存在于当前工作流定义），不再 200 静默

#### Scenario: 启动校验发现定义不一致

- **WHEN** 后端启动且内置工作流定义与代码不一致（阶段引用缺失）
- **THEN** 启动日志输出明确告警，指出不一致的阶段，不静默修复
