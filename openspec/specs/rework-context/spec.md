# rework-context Specification

## Purpose

修复「打回等于没打回」的闭环断点：`reject(taskId, note)` 的 note 目前只写入 `task_events`，返工时 Agent 读不到意见。本能力要求返工意见与返工次数走**与知识库资料同一条注入通道**（`SmartProducer` 最终 system prompt 组装），并让用户在任务详情看到返工历史。数据来源限定为既有 `task_events` 事件（`REJECTED` / `REVIEW_ROLLBACK`），不改状态机、不改表结构，也不改变板块 A/B 的既有边界。

## Requirements

### Requirement: 返工意见注入 producer 上下文
系统 SHALL 在组装 producer 最终 system prompt 时，把该任务**当前待处理的返工意见**注入为独立段落（标题如【上次返工意见】），注入位置与既有【挂载技能】【挂载文件】【关联知识库资料】同一通道（即 `buildProducerSystemPrompt`）。注入内容 SHALL 至少包含：打回阶段、打回意见原文、该阶段累计返工次数；并 SHALL 明确要求「本次产出需针对该意见修改，不得原样重复上次产出」。

#### Scenario: 文案打回后返工产出
- **WHEN** 用户在文案确认点填写打回意见「规格数值与产品资料不符，请核对电芯容量」并确认打回，随后文案阶段重新产出
- **THEN** 文案 Agent 本次调用的最终 system prompt 中包含该意见原文与打回阶段标记

#### Scenario: 无返工意见时不注入
- **WHEN** 任务从未被打回，或该阶段的打回意见已被重新产出消费
- **THEN** 最终 system prompt 中不出现【上次返工意见】段，注入结果与既有行为完全一致

#### Scenario: 主管校对回退同样注入
- **WHEN** 主管校对执行回退（`REVIEW_ROLLBACK`）到指定阶段并填写意见
- **THEN** 被回退阶段的 Agent 返工产出时，system prompt 中包含该回退意见原文

### Requirement: 返工意见作用范围与失效
返工意见 SHALL 只在该意见所属阶段**下一次产出之前**注入；该阶段重新产出成功后，该条意见 SHALL 不再注入后续阶段的 prompt（避免旧意见永久污染上下文）。同时，注入段 SHALL 有长度上限（超出时截断并标注「已截断」），累计返工次数 SHALL 为可计算的真实次数。

#### Scenario: 意见产出后失效
- **WHEN** 文案阶段按打回意见重新产出成功，任务继续推进到主图阶段
- **THEN** 主图与后续阶段的 system prompt 中不再出现该条文案打回意见

#### Scenario: 意见超长截断
- **WHEN** 打回意见长度超过注入上限
- **THEN** 注入段按上限截断并标注「已截断」，不因超长导致请求失败

### Requirement: 返工次数统计
系统 SHALL 统计每个任务的返工次数（`REJECTED` 与 `REVIEW_ROLLBACK` 事件的出现次数）与最近一次返工记录（阶段、意见原文、时间），并通过任务详情接口返回。

#### Scenario: 统计返工次数
- **WHEN** 一个任务经历 1 次文案打回与 1 次校对回退
- **THEN** 任务详情返回返工次数为 2，并附两次返工各自的阶段、意见与时间

#### Scenario: 无返工任务
- **WHEN** 任务从未被打回或回退
- **THEN** 任务详情返回返工次数为 0，不显示返工区块

### Requirement: 任务详情展示返工次数与意见
任务详情 SHALL 展示「第 N 次返工 · 意见：…」（含阶段与时间），使打回意见在界面可回看；展示 SHALL 不依赖知识库连接状态（板块 B 未连接时返工信息照常可见）。

#### Scenario: 查看返工历史
- **WHEN** 用户打开一个被打回过 2 次的任务详情
- **THEN** 界面可见两条「第 N 次返工 · 意见：…」记录，含打回阶段与时间

#### Scenario: 知识库未连接时仍可查看
- **WHEN** 知识库未配置（Vault 未连接）且任务存在打回记录
- **THEN** 返工次数与意见照常展示，不报错、不回退为空白
