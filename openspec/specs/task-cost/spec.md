# task-cost Specification

## Purpose

把 `agent_executions` 里已有的单次执行数据聚合成**任务级账单**：任务详情直接回答「这个任务一共花了多久、跑了多少次、用了哪些模型、消耗了多少 token、大概多少钱」，不要求用户自己去执行日志里逐条累加。费用只在存在单价表时估算，没有单价表就只报 token 与耗时，绝不编造金额。

## Requirements

### Requirement: 任务级执行汇总接口
系统 SHALL 提供 `GET /api/tasks/:id/cost`，基于 `agent_executions` 中 `task_id = <id>` 的记录聚合返回：`totalDurationMs`（阶段耗时合计）、`runs`（执行次数）、`successRuns` / `failedRuns`、`byStage`（按阶段分组：阶段键、中文阶段名、执行次数、耗时合计）、`byAgent`（按 Agent 分组：agentId、Agent 名、执行次数、耗时合计）、`models`（去重后的模型名列表）、`firstStartedAt` / `lastFinishedAt`。汇总 SHALL 为只读，SHALL NOT 修改 `agent_executions` 的任何既有列或语义。任务不存在时 SHALL 返回 404。

#### Scenario: 聚合阶段耗时合计
- **WHEN** 某任务有 3 次成功执行，`duration_ms` 分别为 1200 / 3000 / 800
- **THEN** `totalDurationMs = 5000`、`runs = 3`、`successRuns = 3`、`failedRuns = 0`

#### Scenario: 按阶段与按 Agent 分组
- **WHEN** 任务在 `copy` 阶段执行 2 次、`main-image` 阶段执行 1 次，分别由不同 Agent 执行
- **THEN** `byStage` 含对应阶段条目且耗时合计正确（阶段键附中文阶段名），`byAgent` 含对应 Agent 条目且执行次数正确

#### Scenario: 模型列表
- **WHEN** 任务的执行记录中出现过 `deepseek-chat` 与 `gpt-image-2` 两个模型
- **THEN** `models` 同时包含这两个模型名

#### Scenario: 无执行记录
- **WHEN** 请求一个尚未开工（无任何执行记录）的任务
- **THEN** 返回 200 且 `runs = 0`、`totalDurationMs = 0`、`byStage`/`byAgent` 为空数组、`models` 为空数组（空态由前端呈现，不报错）

#### Scenario: 任务不存在
- **WHEN** 请求不存在的任务 id
- **THEN** 返回 404 与明确错误信息

#### Scenario: 失败执行也计入
- **WHEN** 任务有 1 次失败执行（`status = 'failed'`）与 1 次成功执行
- **THEN** `runs = 2`、`failedRuns = 1`、`successRuns = 1`，且失败执行的耗时被计入 `totalDurationMs`

### Requirement: Token 采集与估算
系统 SHALL 在 `agent_executions` 表新增 `input_tokens` 与 `output_tokens` 两列（幂等 `ALTER TABLE`，既有行默认为 0）。LLM 调用 SHALL 采集渠道返回的 `usage`（`prompt_tokens` / `completion_tokens`）并写入这两列；当渠道未回传 `usage` 时，系统 SHALL 按「输入摘要 + 输出摘要」的字符数做**估算**写入，并在汇总响应中以 `tokensEstimated = true` 明确标注为估算值；有真实 `usage` 时 `tokensEstimated = false` 且优先使用真实值。汇总 SHALL 只统计 `task_id` 匹配的记录。

#### Scenario: 渠道回传真实 usage
- **WHEN** 某次 LLM 调用响应含 `usage: { prompt_tokens: 812, completion_tokens: 344 }`
- **THEN** 该执行记录的 `input_tokens = 812`、`output_tokens = 344`，汇总 `tokensEstimated = false`

#### Scenario: 渠道未回传 usage 时估算
- **WHEN** 某次调用响应不含 `usage`
- **THEN** 该执行记录写入字符数换算的估算值（非 0），汇总 `tokensEstimated = true`，响应字段名与文案均体现「估算」

#### Scenario: token 汇总
- **WHEN** 任务有 2 次执行，输入 token 为 800 与 1200，输出 token 为 300 与 500
- **THEN** 汇总返回 `tokens.input = 2000`、`tokens.output = 800`、`tokens.total = 2800`

#### Scenario: 图片类执行不产生 token
- **WHEN** 某执行记录属于生图阶段（无 LLM token）
- **THEN** 该记录两个 token 列为 0，不影响 token 汇总口径（token 只来自 LLM 调用）

#### Scenario: 既有列语义不变
- **WHEN** 采 token 后查看 `GET /api/executions` 返回结构
- **THEN** 既有字段（`durationMs`、`model`、`status`、`outputSummary` 等）语义与取值不变，token 为新增可选字段

### Requirement: 费用估算（可配置单价表）
系统 SHALL 提供一份**默认单价表**，其价目数据 SHALL 来自本地配置文件（`backend/data/` 下，已被 `.gitignore` 覆盖，不入版本库），**源码内 SHALL NOT 出现任何价目字面量**；单价的实际数值由开发期查渠道公开计价页填入。系统 SHALL 支持通过设置项 `settings.modelPricing` 覆盖默认单价表（形如 `{ "<model>": { "inputPer1M": <数字>, "outputPer1M": <数字>, "currency": "CNY" } }`，设置优先于本地默认表）。当且仅当某模型在生效的单价表中存在条目时，汇总 SHALL 给出该模型的估算费用并按货币汇总为 `cost = { currency, amount, estimated: true, pricingSource }`；**生效单价表缺失、未配置或均不含实际使用的模型时，汇总 SHALL 返回 `cost = null`，前端只展示 token 数与耗时，SHALL NOT 展示任何金额。** 费用字段 SHALL 始终被标注为估算值，并 SHALL NOT 用于账单或结算口径。

#### Scenario: 默认单价表参与估算
- **WHEN** 本地默认单价表含 `deepseek-chat` 的价目，任务消耗输入 1,000,000 与输出 500,000 token
- **THEN** 汇总给出估算金额且 `cost.pricingSource` 标明来源为本地默认单价表

#### Scenario: 设置覆盖默认单价表
- **WHEN** `settings.modelPricing` 与本地默认单价表都含 `deepseek-chat`，但价目不同
- **THEN** 估算以 `settings.modelPricing` 为准，`cost.pricingSource` 标明来源为设置

#### Scenario: 源码零价目字面量
- **WHEN** 对 `backend/src` 与 `frontend/src` 做价目字面量检索（如 `per1M` 后跟数字、或 `元/百万` 后跟数字）
- **THEN** 检索结果为空，价目只存在于本地配置文件

#### Scenario: 有单价表时给出估算费用
- **WHEN** 单价表配置 `deepseek-chat` 为输入 1 元/百万 token、输出 2 元/百万 token，任务消耗输入 1,000,000 与输出 500,000 token
- **THEN** 汇总 `cost.amount ≈ 2.0`、`cost.currency = 'CNY'`、`cost.estimated = true`

#### Scenario: 无可用单价表时不给金额
- **WHEN** 本地默认单价表缺失且 `settings.modelPricing` 未配置
- **THEN** 汇总 `cost = null`，token 与耗时字段照常返回，前端不出现任何金额文案

#### Scenario: 单价表缺该模型
- **WHEN** 单价表只配置了 `deepseek-chat`，但任务还用了 `gpt-image-2`
- **THEN** 汇总只对单价表覆盖的模型计费，并在响应中列出未计费的模型名；`cost` 的说明体现「部分模型未计价」

#### Scenario: 截图/生图费用不臆造
- **WHEN** 任务包含生图阶段执行
- **THEN** 生图部分不产生 token 计费，SHALL NOT 为生图臆造单价或金额

### Requirement: 任务详情成本卡片
任务详情页（「任务详情」tab）SHALL 展示执行汇总卡片，含：阶段耗时合计（人类可读，如 `8.2s` / `3m 12s`）、执行次数（成功/失败）、按阶段的耗时明细、涉及模型、token 数（标注「估算」或「实测」）、以及**仅在 `cost != null` 时**展示的估算金额。无执行记录时 SHALL 展示空态文案（如「尚无执行记录」），SHALL NOT 展示 `0 元` 或报错。

#### Scenario: 展示耗时合计与阶段明细
- **WHEN** 用户打开一个已开工任务的「任务详情」tab
- **THEN** 卡片显示总耗时、执行次数与按阶段耗时明细，数字与 `GET /api/tasks/:id/cost` 返回值一致

#### Scenario: 标注估算
- **WHEN** 汇总 `tokensEstimated = true`
- **THEN** 卡片上 token 文案标注「估算」，不使用「消耗」等确定性措辞

#### Scenario: 无单价表时不显示金额
- **WHEN** 汇总 `cost = null`
- **THEN** 卡片内不出现任何金额（含 `0`、`—` 元之类的占位），只显示耗时与 token

#### Scenario: 空态
- **WHEN** 任务尚无执行记录
- **THEN** 卡片显示「尚无执行记录」空态文案，不显示 0 值数字、不报错
