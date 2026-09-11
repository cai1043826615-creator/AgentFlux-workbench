## Why

`knowledge-base` 已把知识库资料注入 Agent 上下文（`buildKnowledgeContext` → `buildProducerSystemPrompt`），但「产出有没有依据」在界面上**不可见、不可追、不可修**，形成三处可信度断点：

1. **产出无法溯源**：文案交付物只有最终文本，没有标记哪些事实项来自关联资料。实测证据（`docs/验收记录-2026-09-11-知识库板块.md`）显示：不注入知识库时 LLM 会**自信地编造**规格——实测编造了 `20000mAh`（实为 10000）、`370g`（实为 198g）、`3C 认证`（实为 GB 31241）、`18 个月质保`（无）。这类错误在电商上架等于虚假宣传，而现有界面看不出哪个数字有据可查。
2. **打回形同虚设**：`reject(taskId, note)`（`backend/src/engine/executor.ts`）把 note 只写进 `task_events` 的 `REJECTED` payload，返工时 Agent **读不到**这条意见——系统 prompt 只组装 skills/files/关联资料，不含返工意见。质量闭环在「人给意见 → Agent 改」这一步断裂。
3. **生图失败会让任务卡死**：`SmartProducer.produceImages` 已有「最多 3 次 + 指数退避」的自动重试（现状，**不是缺失项**），但 ① 3 次仍失败后图片落 `status='failed'`，而 `delivery.allImagesDecided`（`backend/src/delivery/store.ts`）只认 `approved/rejected`，把 `failed` 当作「未决策」→ 拍板点永远推不动、任务卡死（已被 `docs/验收记录-2026-09-10-真实端到端.md` 第四节实证）；② 前端没有任何单张「重试 / 跳过」操作，用户只能打回整批触发返工。

## What Changes

- **B1 · 产出溯源标记 + 产出溯源率**
  - 交付物（文案）产出后按「数值+单位 / 认证编号 / 材质成分词 / **文本型事实（功能宣称、场景描述）**」四类模式抽取**事实项**，与任务关联资料片段文本做归一化匹配（文本型用覆盖率判定，阈值可配）；命中项标记为「已溯源」，结果随交付物一起持久化
  - 任务详情新增**产出溯源率**指标（定义见主文档 §0.2：可溯源事实项 ÷ 全部事实项），并列出具体已溯源/未溯源事实项
  - 任务**未关联任何资料**时必须显示警示「参数由模型生成，请人工核对」，不展示溯源率数值
  - 不引入 NLP / 向量库依赖（数值/认证/材质用模式匹配，文本型用最长连续命中占比，均为纯字符串运算）
- **B2 · 打回意见注入返工上下文**
  - 返工意见走**与知识库资料同一条注入通道**：在 `buildProducerSystemPrompt` 内新增【上次返工意见】段（返工意见 + 返工次数），与【关联知识库资料】段并列
  - 数据来源为既有 `task_events` 的 `REJECTED` / `REVIEW_ROLLBACK` 事件（不改状态机、不改表结构）；意见只在该阶段重新产出前注入，产出成功后自然失效，避免永久污染后续 prompt
  - 任务详情展示「第 N 次返工 · 意见：…」（含打回阶段与时间）
- **B11 · 生图子任务重试上限 3 次 + failed 不计入待决策**
  - **保持**自动重试上限不超过 3 次（不新增重试层数；现有指数退避保留）
  - 新增**单张「重试」**操作：对 `failed` 图片手动重发一次生图，累计尝试次数受同一上限 3 次约束，超限返回可见错误
  - 新增**单张「跳过」**操作：`skipped` 与 `failed` 均**不参与**「是否全部已决策」判定；仅当整批全部失败时，拍板点仍可推进并在界面显示警示
- 三条目彼此独立，可分别实现与验收；共享改动点仅 `packages/shared` 类型与 `buildProducerSystemPrompt`（主文档 §6.3 已指定 T1 先改）

## Capabilities

### New Capabilities

- `deliverable-provenance`: 交付物溯源——事实项抽取与关联资料匹配、交付物溯源标记、产出溯源率指标、未关联资料的「参数由模型生成，请人工核对」警示
- `rework-context`: 返工上下文——打回/回退意见与返工次数注入 producer system prompt（与知识库资料同一通道）、任务详情返工次数与意见展示
- `image-retry-policy`: 生图失败处置——自动重试上限 3 次、单张「重试」、单张「跳过」、`failed/skipped` 不参与待决策判定（拍板点不卡死）

### Modified Capabilities

- 无（改用 `## ADDED Requirements` 表达，原因见下）

> **为何不写 `## MODIFIED Requirements`**：B2 要改的 `workflow-context` 能力与 B1 要读的 `task_kb_refs` 都定义在**尚未归档**的 `openspec/changes/knowledge-base`，其 spec 还没有同步进主 `openspec/specs/`（主 specs 目前只有 agent-observability / chat / content-delivery / shell-layout / task-board / workflow-engine / workstation）。对主 specs 中尚不存在的能力写 MODIFIED 会导致 `openspec validate quality-loop` 失败，且会与未归档的 knowledge-base 产生 delta 冲突（主文档 §6.4 已提示同类风险）。因此本 change 对新行为一律用 `## ADDED Requirements` 表达；待本 change 归档时若 `workflow-context` 已进入主 specs，再按需改写为 MODIFIED。

## Impact

- **共享类型**：`packages/shared/src/`（新增溯源与返工共享类型；`DeliverableDecisionInput.decision` 增补 `'skip'`；`ImageItem` 增补尝试次数字段）——纯类型增补，不破坏既有消费者
- **后端**：新增 `backend/src/delivery/provenance.ts`（事实项抽取/匹配/溯源率计算）与 `backend/src/engine/rework.ts`（返工上下文读取与组装）；改动 `backend/src/agents/smart-producer.ts`（`buildProducerSystemPrompt` 追加返工段、`produceImages` 支持单张重试与尝试次数上报）、`backend/src/engine/service.ts`（`decideDeliverable` 处理 `skip` 与推进判定、新单张重试入口）、`backend/src/delivery/store.ts`（`allImagesDecided` 忽略 `failed/skipped`、新增跳过与尝试次数写入）、`backend/src/routes/tasks.ts`（新增单张重试端点）；新增后端测试
- **前端**：`frontend/src/features/status/TaskDetailView.tsx`（产出溯源率指标 + 返工次数/意见）、`frontend/src/features/content/ContentDeliveryView.tsx`（已溯源标记、未关联资料警示、失败图「重试 / 跳过」按钮）、`frontend/src/lib/api.ts`、`frontend/src/store/useWorkbench.tsx`（透传 skip 与重试）
- **数据**：不新增表、不改 `task_kb_refs` 表结构（主文档 §6.2 约束）；溯源结果与图片尝试次数持久化在既有 `deliverables.content` JSON 内（`saveDeliverable` 已支持版本递增重建），无迁移脚本
- **外部依赖**：无新增运行时依赖
- **不影响既有功能**：未关联资料的任务行为与现状一致（仅多一条人工核对警示）；返工意见段仅在存在待处理打回时出现；生图成功路径（含 3 次重试内成功）行为完全不变
