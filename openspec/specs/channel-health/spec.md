# channel-health Specification

## Purpose

把「渠道配置问题」与「Agent 问题」在用户填写配置的当场就分开：在 Agent 设置面板提供「测试渠道」按钮，用该 Agent 实际生效的渠道发一次最小请求，直接给出红/绿结果、实测延迟与**归属明确**的失败原因，而不是等任务跑失败后去执行日志里猜。

## Requirements

### Requirement: 渠道健康检查端点
系统 SHALL 提供 `POST /api/agents/:id/channel-test`：使用该 Agent **实际生效**的渠道与模型（与 `callLlm` 相同的渠道选择顺序：面板专属渠道 → 主管视觉渠道（仅主管）→ `.env` 默认渠道），发起一次最小 LLM 请求（固定短 prompt、尽可能小的 `max_tokens`）。响应 SHALL 为 `{ ok, latencyMs, model, baseUrlHost, error: { code, message } | null }`，其中 `latencyMs` 为本次请求的实测毫秒数，`baseUrlHost` 为渠道主机名（不含完整 URL 与凭据）。请求体 SHALL 支持可选覆盖（`baseUrl`/`apiKey`/`model`），以便用户**在保存前先测**。

#### Scenario: 渠道正确返回绿色与延迟
- **WHEN** 用户对已正确配置 apiKey 的 Agent 点击「测试渠道」
- **THEN** 响应 `ok = true`，`latencyMs` 为大于 0 的整数，`model` 为该 Agent 生效模型，`error = null`

#### Scenario: apiKey 填错返回红色与失败原因
- **WHEN** 用户把 apiKey 故意改成错误值后点击「测试渠道」
- **THEN** 响应 `ok = false`，`error.code` 为鉴权类错误（如 `auth_failed`），`error.message` 含 HTTP 状态码（如 `401`）并说明「apiKey 无效或已过期」

#### Scenario: 未配置渠道
- **WHEN** 该 Agent 与其回退渠道都没有可用 apiKey
- **THEN** 响应 `ok = false`，`error.code = 'not_configured'`，`error.message` 说明「该 Agent 未配置渠道」，不发起外部请求

#### Scenario: 连接不上（baseUrl 错误）
- **WHEN** baseUrl 指向不可达地址
- **THEN** 响应 `ok = false`，`error.code = 'connect_failed'`，`error.message` 含「无法连接」与主机名，且响应在超时预算内返回

#### Scenario: 模型不存在
- **WHEN** 渠道可达但模型名不存在，渠道返回 404/400 并提示模型无效
- **THEN** 响应 `ok = false`，`error.code = 'model_not_found'`，`error.message` 含被请求的模型名

#### Scenario: 渠道超时
- **WHEN** 渠道在健康检查超时预算（15 秒）内未响应
- **THEN** 响应 `ok = false`，`error.code = 'timeout'`，`error.message` 说明「请求超时（15s）」

#### Scenario: 测试不污染执行统计
- **WHEN** 执行任意次健康检查（成功或失败）
- **THEN** `agent_executions` 表不新增任何记录，`GET /api/agents/:id/stats` 的 `runs` 与健康检查前一致

#### Scenario: 测试不改变 Agent 状态
- **WHEN** 执行健康检查前后对比
- **THEN** 该 Agent 的 `online_status`、`activity`、`last_active_at` 与配置字段均未变化

#### Scenario: 测试失败不返回 5xx
- **WHEN** 渠道返回任意错误、连接失败或超时
- **THEN** 接口返回 HTTP 200 且 `ok = false`（由业务字段表达失败），不返回 500

#### Scenario: 不存在的 Agent
- **WHEN** 请求的 Agent id 不存在
- **THEN** 返回 404 与明确错误信息

#### Scenario: 不泄漏密钥
- **WHEN** 检查任意健康检查响应体与前端展示文本
- **THEN** 不出现 apiKey 明文或其片段（只允许出现主机名与模型名）

### Requirement: 设置面板测试渠道
Agent 设置弹窗的「模型与 API」区块 SHALL 提供「测试渠道」按钮，点击后展示：**绿色**结果（含实测延迟毫秒与生效模型）或**红色**结果（含失败原因与可操作建议）。测试 SHALL 使用当前表单里已填写的 `baseUrl`/`apiKey`/`model`（未填字段按既有回退规则取默认渠道），并 SHALL NOT 修改已保存的配置、SHALL NOT 关闭弹窗或清空表单。

#### Scenario: 面板展示绿色结果
- **WHEN** 用户在设置面板点击「测试渠道」，渠道正常
- **THEN** 按钮旁出现绿色状态与「延迟 812ms · 模型 deepseek-chat」类文案，表单内容保持不变

#### Scenario: 面板展示红色结果与建议
- **WHEN** 测试失败原因为鉴权失败
- **THEN** 出现红色状态与「渠道配置错误：apiKey 无效或已过期（HTTP 401）」类文案，并给出「请检查 API Key 是否复制完整」的建议

#### Scenario: 区分配置问题与 Agent 问题
- **WHEN** 测试失败原因为渠道不可达或鉴权失败
- **THEN** 结果文案明确标注为「渠道配置错误」；当测试成功但该 Agent 仍有近期失败执行时，面板文案 SHALL 能提示「渠道正常，失败原因在 Agent 侧（见执行日志）」而非归咎于配置

#### Scenario: 测完再保存
- **WHEN** 用户在表单里填入新 apiKey 后先点「测试渠道」（成功），再点「保存」
- **THEN** 测试使用的就是我填入的值，且保存后 `settings.llmChannels[agentId]` 与测试所用渠道一致

#### Scenario: 未保存的改动不被测试改写
- **WHEN** 用户只改了表单但未保存，执行测试后关闭弹窗重开
- **THEN** 表单回到已保存的配置（测试过程未写入 settings）

#### Scenario: 测试进行中防重复
- **WHEN** 用户连续点击「测试渠道」
- **THEN** 测试进行中按钮为禁用/加载态，不并发发出多次请求
