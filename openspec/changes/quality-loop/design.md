## Context

在已完成知识库板块（板块 B）与多 Agent 工作流（板块 A）的工作台上落实主文档 T1 梯队三条目（B1 产出溯源标记 + 产出溯源率、B2 打回意见注入返工上下文、B11 生图重试上限与 failed 不计入待决策）。三条目的共同目标是让「产出有没有依据」**可见、可追、可修**，属最贴近合规与真实成本的一批。

关键现状（已读代码确认，不得凭猜）：

- 注入通道唯一：`backend/src/agents/smart-producer.ts` 的 `buildProducerSystemPrompt(agentId, base, taskId)` = `buildSystemPrompt`（【挂载技能】【挂载文件】）+ `buildKnowledgeContext(taskId)`（【关联知识库资料】）；`SmartProducer.withLlm` 是唯一调用点。B2 必须复用这条通道。
- 打回意见落点：`backend/src/engine/executor.ts` 的 `reject(taskId, note)` 把 note 写进 `task_events` 的 `REJECTED` payload；`reviewRollback` 写 `REVIEW_ROLLBACK`（含 `note`）。二者都只有事件，无独立表。
- 生图自动重试**已存在**：`smart-producer.ts` `produceImages` 内 `for (let attempt = 1; attempt <= 3; attempt++)` + `1500 * attempt` 退避；3 次均失败后 rethrow，`service.produceImages` 落 `status: 'failed'`。B11 不得把「缺失自动重试」当需求重复提出，只写「保持上限不超过 3 次」。
- 卡死根因：`backend/src/delivery/store.ts` 的 `allImagesDecided` 判定 `every(i => i.status === 'approved' || i.status === 'rejected')`，`failed` 被当作未决策；`service.decideDeliverable` 中 `if (!delivery.allImagesDecided(...)) return task;` 直接返回 → 拍板点永不推进。
- 交付物存储：`deliverables` 表按 `(task_id, stage, kind)` 唯一，`content` 为 JSON（`CopyPackage` 或 `ImageItem[]`），重复产出 `version + 1` 并整体覆盖；`backend/src/delivery/store.ts` 无表结构变更需求。
- 关联资料：`task_kb_refs` 表（`backend/src/knowledge/refs.ts`）提供 `loadTaskKbFragments`（含 `state: ok | missing | anchor-missing`），只读，本 change **不得改其表结构**（主文档 §6.2）。

## Goals / Non-Goals

**Goals:**

- 交付物事实项可标记「已溯源 / 未溯源」，任务详情可见**产出溯源率**（口径 = 可溯源事实项 ÷ 全部事实项，主文档 §0.2）与明细；未关联资料时明确警示「参数由模型生成，请人工核对」
- 打回（含校对回退）意见与返工次数进入 producer 最终 system prompt，与知识库资料同一注入通道；任务详情可见「第 N 次返工 · 意见：…」
- 生图失败不再卡死拍板点：自动重试上限保持 ≤3 次，补单张「重试」「跳过」，`failed` 与跳过态不参与待决策判定
- 三条目均可独立实现与验收；不引入任何新的运行时依赖（无 NLP / 向量库 / 图库）；不改既有表结构

**Non-Goals:**

- 不做 RAG 向量检索或语义级事实核验（v2 边界，主文档 §0.4 / knowledge-base design 已声明）
- 不改 `task_kb_refs` 表结构、不改知识库侧任何行为（板块 B 只读边界不变）
- 不改状态机语义（`approve` / `reject` / `reviewRollback` 的迁移规则保持原样）
- 不做返工意见的全文检索、评分或统计分析面板
- 不做多语言的规格单位换算体系（只做归一化匹配，不做单位换算与量纲推导）
- 不新增 `failed` 图片的自动「重新排队」批处理（只做单张手动重试；整批重跑仍走既有打回返工路径）

## Decisions

### D1. 事实项抽取用「模式匹配 + 覆盖率判定」，不引 NLP
事实项覆盖四类可机械判定的模式：① 数值 + 单位（`\d+(\.\d+)?\s*(mAh|Ah|Wh|W|V|A|g|kg|mm|cm|ml|L|小时|天|个月|年|元|%)` 等）；② 认证/标准编号（`GB\s?\d+`、`3C`、`CE`、`FCC`、`RoHS`、`UN38\.3` 等）；③ 材质成分词表（`铝合金`/`ABS`/`PC`/`硅胶`/`锂聚合物` 等可配置词表）；④ **文本型事实**——以「声明句/短语」为单位的陈述性内容（功能宣称、场景描述、结构说明），按分句 + 去停用词切分为声明项。

匹配策略按类型分化：
- ①②③ 用归一化后的**包含匹配**
- ④ 用归一化后的**最长连续命中占比**（`最长公共连续子串长度 ÷ 声明句有效长度 ≥ 阈值`，默认 0.8，可配置）

- **理由**：用户已拍板「数值型与文本型**都要**」（主文档 §八.5）。文本型事实若也用严格包含匹配会因改写而大量漏判（实测文案会把「过充/过流/过温/短路四重保护」重组为「四重保护：过充 / 过流 / 过温 / 短路」）；覆盖率判定零依赖且可用确定性单测覆盖
- **代价**：文本型判定的误报率高于数值型（同义改写可能被判为命中）→ 阈值可配置 + 明细记录命中来源供人工复核，并以「人工核对一致」作为验收硬标准
- **备选**：LLM 判定（不可确定性单测、成本与幻觉风险）；jieba 分词 + 词性标注（重依赖、仍难判定事实性）；文本型事实不做（**已被用户否决**）

### D2. 事实项位置用文本字段 + 片段下标，不做富文本内联
不把标记写入 `CopyPackage`（避免污染既有前端 `parseCopy` 消费者与 LLM 输出契约）。抽取结果按「文本字段（title/points[i]/outline/keywords）+ 命中文本 + 字符区间」定位。
- **理由**：`CopyPackage` 是 LLM 严格输出 JSON 的契约（`produceCopy` 校验 title/points），加内联标记会破坏 JSON 解析与既有 UI
- **备选**：在文案中插入 `[[已溯源]]` 内联标记（污染原文、易被 LLM 复述进下一版）

### D3. 溯源结果独立持久化为 deliverable，而非扩展 CopyPackage
在既有 `deliverables` 表内新增一条 `(task_id, stage='copy', kind='provenance')` 交付物，`content` 为 JSON（事实项列表 + 命中资料 + 溯源率分子分母 + 生成时间 + 依据的资料版本哈希）。
- **理由**：`deliverables` 的 `(task_id, stage, kind)` 唯一约束已支持多 kind；`saveDeliverable` 复制产出时重建该行，无需迁移脚本；`kind: 'copy' | 'image'` 联合类型需增补 `'provenance'`
- **备选**：新表 `deliverable_provenance`（多一次迁移与同步，收益不足）；塞进 `CopyPackage`（见 D2 问题）

### D4. 匹配语义：归一化后包含匹配，匹配对象是「实际注入的资料片段」
以 `loadTaskKbFragments(taskId)` 的**片段文本**为参照（与 Agent 实际看到的上下文一致），归一化规则：去首尾空白 → 全角转半角 → 去掉数字与单位之间空格 → 统一大小写。事实项的完整文本被片段文本包含即判定「已溯源」，并记录命中的资料标题；`state='missing'` 的资料不参与匹配。
- **理由**：与注入内容对齐，避免「资料里有但没注入」造成假阴性；归一化覆盖 `10000 mAh` / `10000mAh` 这类真实差异
- **备选**：与整篇文档匹配（会给出「未注入也算溯源」的假阳性）；模糊相似度阈值（不可确定性单测，且与「禁止编造」的严格立场不符）

### D5. 产出溯源率口径 = 可溯源事实项 ÷ 全部事实项；无事实项时显式说明
界面显示取整百分数 + 分子/分母原值 + 明细列表；事实项总数为 0 时显示「无实质事实项」，不显示百分数。
- **理由**：主文档 §0.2 明确定义；0/0 显示 100% 或 0% 都会误导
- **备选**：按字数加权（无法从主文档口径推出，且用户无法手工复核）

### D6. 未关联资料警示优先于溯源率
`task_kb_refs` 为空时：显示「参数由模型生成，请人工核对」，隐藏溯源率数值；已关联但存在未溯源事实项时显示「N 项事实未溯源」。
- **理由**：避免「未关联资料 + 溯源率 0%」被误读为「这次产出全不可信」，而实际含义是「无从核定，必须人工核对」
- **备选**：无资料也显示 0%（误导且与实测编造风险不成正比）

### D7. 返工上下文读取复用 `task_events`，不建新表、不改 `reject` 签名
新增 `backend/src/engine/rework.ts`（目录级落点，函数名实现期可调），读取该任务的 `REJECTED` / `REVIEW_ROLLBACK` 事件，产出 `{ count, latest: { stage, note, at } }`。
- **理由**：note 已经持久化在事件 payload（`executor.reject` / `reviewRollback` 均已写）；建新表会与「不改既有表、不重复存储」的约束冲突
- **备选**：新增 `task_rework` 表（多一处数据源，易与事件日志漂移）

### D8. 注入位置与段序：`buildProducerSystemPrompt` 内追加【上次返工意见】段
顺序为：`base` → 【挂载技能】→【挂载文件】→【关联知识库资料】→【上次返工意见】。返工段含：打回阶段、该阶段累计返工次数、意见原文、明确要求「针对该意见修改，不得原样重复上次产出」。
- **理由**：主文档 §6.3 指定 `buildProducerSystemPrompt` 是共享改动点且由 T1 先改；末尾注入使返工意见在长 prompt 中保持最高注意权重
- **备选**：放在 base 之后（会被大段资料淹没）；改各阶段独立 prompt（散落多处、易漏）

### D9. 返工意见按「阶段匹配 + 产出后失效」限定作用范围
只在该意见所属阶段**下一次产出之前**注入；该阶段重新产出（`STAGE_COMPLETED`）后该意见不再注入。判定条件：事件的 `stage` 等于当前阶段、且事件时间晚于该阶段最近一次 `STAGE_COMPLETED`。注入段设长度上限（超出截断并标注「已截断」），返工次数用 `task_events` 计数得出。
- **理由**：避免旧意见永久污染后续阶段 prompt（例如文案意见被主图阶段读到）；无需额外清理任务
- **备选**：一次性注入后写「已消费」标记（需额外持久化，且与事件日志重复）；永久注入（污染上下文）

### D10. 返回给前端的事件 payload SHALL NOT 改变；返工信息由独立查询接口提供
新增 `GET /api/tasks/:id/rework`（或等价查询入口），返回 `{ count, records: [{ stage, note, at }] }`；前端 `TaskDetailView` 用它渲染「第 N 次返工 · 意见：…」。
- **理由**：事件接口 `listEvents` 已被活动日志消费（前端按 type + stage 分组渲染），改 payload 会牵动既有日志展示；独立查询使返工区块可独立加载、不受知识库连接状态影响
- **备选**：前端自行从 `eventsByTask` 过滤（依赖事件已在本地加载，且与活动日志耦合）

### D11. `allImagesDecided` 只认 `approved / rejected / skipped`
判定改为 `every(i => ['approved','rejected','skipped'].includes(i.status))`；`failed` 不再阻塞。推进规则保持既有：存在 `rejected` → 触发返工；否则 → 推进（`approve`）。仅整批全 `failed` 时，在推进的事件 payload 中记录失败图片数，并在界面显示警示。
- **理由**：直接消除实测卡死路径，且不改变既有决策语义；即使全部失败也允许推进，是「不得卡死」准则的必然结果（已有单张重试作为质量兜底手段）
- **备选**：要求「至少一张 approved 才可推进」（会引入新的死锁：全失败时仍无法推进）；把 `failed` 自动转成 `rejected`（会误触发整批返工与返工计数）

### D12. 图片重试/跳过的数据结构与端点
`ImageItem` 增补 `attempts?: number` 与 `skipped` 状态；新增 `POST /api/tasks/:id/deliverables/images/:imageId/retry` 单张重试（服务层调用既有生图通道，只更新该图）；跳过复用既有 decide 端点，`decision: 'skip'`，服务层按「仅该图标记 skipped」处理，不触发 `reject`/`approve` 联动。
- **理由**：重试是「重新执行」不是「决策」，与 decide 语义不同，需独立端点；跳过是决策，复用端点可少一处接口
- **备选**：复用 decide 传 `decision: 'retry'`（把执行动作混入决策语义，易误触发状态机）；前端直接调生图（绕过服务层，无法复用重试上限与事件记录）

### D13. `packages/shared` 只做向后兼容的字段增补
新增溯源共享类型与返工查询结果类型；`DeliverableDecisionInput.decision` 增补 `'skip'`；`ImageItem` 增补 `attempts?: number`（可选字段）。`CopyPackage` 不变。
- **理由**：可选字段与联合类型扩展不破坏既有消费者（前端 `parseImages` 返回的宽松类型也不受影响）
- **备选**：新增一套并行类型（前后端两套溯源模型易漂移）

## Risks / Trade-offs

- [文本型事实的覆盖率判定误报（同义改写被判为命中）] → 阈值默认 0.8 且可配置；明细记录命中来源与覆盖率数值供人工复核；验收以「人工核对结果一致」为硬标准
- [抽取出的事实项被误判为已溯源（数字恰好出现在无关语境）] → 匹配范围限定为实际注入的关联资料片段，并记录命中来源供人工复核；验收用「人工核对结果一致」作为硬标准
- [全失败批次推进会让任务在无可用图片的情况下继续（交付物资料包可能缺图）] → 推进时写入事件 + 界面警示；单张重试/跳过为主路径，整批问题仍可打回返工
- [返工意见注入可能让 Agent 过度改写（把好内容一起改掉）] → 注入文案明确「只针对意见所指问题修改，其余保持」；意见段限制长度上限
- [溯源结果与资料版本漂移（Vault 文档事后被改动）] → 溯源结果记录生成时间与依据资料的 mtime/hash，界面标注「基于 N 份资料、生成于 …」；资料变更后重新产出即刷新
- [返工次数依赖事件日志计数，历史数据可能不含 note] → 事件 payload 缺失 `note` 时按空意见处理（只显示次数），不报错
- [「跳过」引入新图片状态，可能被既有前端分支漏处理] → 前端所有状态分支（缩略图角标、大图预览文案、决策按钮可见性）逐一覆盖 `skipped`；任务 5 的验证清单强制检查

## Migration Plan

- 数据库：无新增表、无列变更（`task_kb_refs` 表结构不动）。溯源结果与图片 `attempts/skipped` 状态持久化在既有 `deliverables.content` JSON 与既有 `task_events` 内
- 已有任务：老任务的 `deliverables` 无 `kind='provenance'` 行 → 任务详情显示「尚未生成溯源结果（重新产出后生效）」，点选重算入口按需生成；老任务的 `failed` 图片在下次进入该阶段决策时按新判定处理，不需要数据回填脚本
- 回滚：三条目均可独立回退。回退到旧代码后，`kind='provenance'` 交付物与 `skipped` 状态对旧代码不可见（不被访问），不产生破坏；`deliverables` 表数据保持可读
- 部署顺序：`packages/shared` 类型 → 后端 → 前端（同一提交内完成，避免类型不匹配的中间态）

## Open Questions

- **事实项判定粒度（主文档 §八.5，已拍板）**：用户已确认**数值型与文本型都要**。本 change 按 D1 覆盖「数值+单位 / 认证编号 / 材质成分词 / 文本型事实」四类，文本型采用覆盖率判定（阈值默认 0.8，可配置）。若后续误报率不可接受，可下调为「仅数值型」或提高阈值，无需改表结构
- **产出溯源率的展示位置与阈值**：是否需要设定「低于 N% 禁止采纳」的硬门槛（合规拦截），还是仅做提示？本 change 只做提示，不拦截
- **返工意见是否应支持多条累积**：当前设计只注入「当前阶段最近一条待处理意见 + 累计次数」；若用户希望看到并在 prompt 中带上该阶段全部历史意见，需要调整 D9 的失效规则
- **「跳过」是否需要填写原因**：当前设计跳过不带原因（避免与打回原因混淆）；若运营需要审计「为什么跳过」，需在 `ImageItem` 增加 `skipReason`
- **溯源结果是否需要随交付物归档留存**：归档任务是否要保留历史版本的溯源明细（当前 `saveDeliverable` 会覆盖旧版本内容，仅保留最新）
