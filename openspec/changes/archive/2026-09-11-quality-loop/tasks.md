> **梯队定位（主文档 T1）**：产出可信度闭环，含 B1（产出溯源标记 + 产出溯源率）、B2（打回意见注入返工上下文）、B11（生图重试上限 3 次 + failed 不计入待决策）。三条目彼此独立，可 3 路并行；同一文件不得被两个代理同时改。
> **共享改动点**：`buildProducerSystemPrompt`（`backend/src/agents/smart-producer.ts`）由条目 B2 先改，后续梯队（T3 热点背景注入）在其之上追加以防冲突。
> **边界**：不改 `task_kb_refs` 表结构与知识库侧行为；不引入新运行时依赖；每条验证标准都必须实际执行后再勾选。

## 1. 前置确认与共享契约

- [x] 1.1 确认基线现状（不改代码）：核对 `backend/src/delivery/store.ts` 的 `allImagesDecided` 把 `failed` 视为未决策、`backend/src/engine/service.ts` 的 `decideDeliverable` 在未全部决策时直接 `return task`，并在本 change 的 design.md 中确认已记录该根因；验证：`openspec validate quality-loop` 通过，且 design.md「Context」中引用的三处代码行号与实际一致（用 `grep`/阅读复核）
- [x] 1.2 在 `packages/shared/src/` 增补溯源与返工共享类型（事实项、溯源明细、溯源率、返工记录查询结果），`DeliverableDecisionInput.decision` 增补 `'skip'`，`ImageItem` 增补可选字段 `attempts?: number` 与跳过状态；验证：`pnpm --filter @workbench/shared build`（或根 `pnpm typecheck`）0 error，且既有类型消费者（`frontend/src/lib/api.ts` 的 `parseImages`、`parseCopy`）无需改动即可编译通过
- [x] 1.3 在 `deliverables.kind` 联合类型（`packages/shared/src/types.ts` 的 `DeliverableKind`）增补 `'provenance'`；验证：后端与前端均 0 error，且既有 `kind: 'copy' | 'image'` 分支的 switch/if 穷尽性检查（若有）通过

## 2. B1 产出溯源标记与产出溯源率（deliverable-provenance）

- [x] 2.1 新建事实项抽取模块（落点：`backend/src/delivery/provenance.ts`，目录级落点如此，文件名实现期可调），实现三类模式抽取：数值+单位、认证/标准编号、材质成分词表；验证：新增单测断言 `10000mAh`/`198g`/`GB 31241`/`铝合金` 被抽出，且纯描述性文本返回空数组
- [x] 2.2 实现归一化与匹配：去首尾空白 → 全角转半角 → 去数字与单位间空格 → 统一大小写；以 `loadTaskKbFragments(taskId)` 的**可用片段**为参照做包含匹配，记录命中资料标题，`state='missing'` 的资料不参与；验证：单测断言 `10000 mAh`（资料）与 `10000mAh`（产出）判定为已溯源，`20000mAh` 判定为未溯源
- [x] 2.3 实现产出溯源率计算（可溯源事实项 ÷ 全部事实项，取整百分数 + 分子分母），事实项总数为 0 时返回「无实质事实项」标记；验证：单测断言 4/6 输出 67% 且分子分母为 4 与 6，0 事实项输出无实质事实项标记
- [x] 2.4 溯源结果持久化：在 `backend/src/delivery/store.ts` 以既有 `saveDeliverable` 写入 `kind='provenance'` 行（含事实项明细、命中资料、溯源率、生成时间、依据资料的 mtime/hash），文案阶段产出后调用；验证：单测断言同一任务重复产出时该行 `version` 递增且内容被刷新，未关联资料的任务也写入「无资料」态结果
- [x] 2.5 后端读取接口：任务详情接口返回溯源结果（无结果时返回空态而非报错），并在 `task_kb_refs` 为空时返回 `hasRefs: false`；验证：后端测试断言两类返回（有资料任务含明细、无资料任务 `hasRefs=false` 且不含溯源率数值）
- [x] 2.6 前端任务详情展示：`frontend/src/features/status/TaskDetailView.tsx` 新增「产出溯源率」区块（取整百分数 + 分子分母 + 已溯源/未溯源明细，可展开）；验证：浏览器打开一个已关联资料的任务详情，区块显示数值且与后端返回一致；无 `kind='provenance'` 行的老任务显示「尚未生成溯源结果（重新产出后生效）」
- [x] 2.7 前端未关联资料警示：任务未关联任何资料时在任务详情与内容交付视图（`frontend/src/features/content/ContentDeliveryView.tsx`）显示「参数由模型生成，请人工核对」且隐藏溯源率数值；验证：浏览器打开一个无关联资料的任务，两处均出现该警示文案且页面无溯源率数字
- [x] 2.8 B1 人工一致性核对：用一份真实产品资料（含容量/重量/认证）关联任务并跑通文案产出，人工逐条比对界面标记；验证：界面已溯源/未溯源标记与人工核对结果完全一致（漏标/误标数均为 0），并把核对结论与事实项清单记录到 `openspec/changes/quality-loop/` 内的验证记录文件（不写入 `docs/`）

## 3. B2 打回意见注入返工上下文（rework-context）

- [x] 3.1 新建返工上下文模块（落点：`backend/src/engine/rework.ts`，文件名实现期可调）：读取 `task_events` 中该任务的 `REJECTED` 与 `REVIEW_ROLLBACK` 事件，产出 `{ count, latest: { stage, note, at } }`；验证：单测断言 1 次打回 + 1 次回退 → `count=2` 且 `latest` 为时间最近的一条，无事件 → `count=0` 且 `latest=null`
- [x] 3.2 实现「阶段匹配 + 产出后失效」判定：仅当事件 `stage` 等于当前阶段、且事件时间晚于该阶段最近一次 `STAGE_COMPLETED` 时视为待处理意见；验证：单测断言返工后再次 `STAGE_COMPLETED` 则 `pending` 为空，未完成时 `pending` 含该意见
- [x] 3.3 组装注入文本并设长度上限（超出截断并标注「已截断」），文案含打回阶段、累计返工次数、意见原文，以及「针对该意见修改、不得原样重复上次产出、其余内容保持」的要求；验证：单测断言超长意见被截断且含「已截断」字样，无意见时返回空串
- [x] 3.4 在 `backend/src/agents/smart-producer.ts` 的 `buildProducerSystemPrompt` 内接入返工段（段序：base → 挂载技能 → 挂载文件 → 关联知识库资料 → 上次返工意见）；验证：单测直接断言 `buildProducerSystemPrompt(agentId, base, taskId)` 的返回字符串——有返工意见时包含意见原文与阶段标记，无返工意见时与改动前逐字符一致（用改动前的快照字符串比较）
- [x] 3.5 主管校对回退注入打通：确认 `service.reviewDecision('rollback')` 触发的 `REVIEW_ROLLBACK` 意见同样被 3.4 的注入段覆盖；验证：后端测试构造一次 rollback → 下一次同阶段产出时 `buildProducerSystemPrompt` 输出包含该意见
- [x] 3.6 后端返工查询接口：新增返工信息查询（落点：`backend/src/routes/tasks.ts`，路径如 `GET /api/tasks/:id/rework`，返回 `{ count, records: [{ stage, note, at }] }`）；验证：后端测试断言 2 条记录返回顺序与内容正确，无返工任务返回 `count=0` 与空数组
- [x] 3.7 前端任务详情展示：`TaskDetailView.tsx` 展示「第 N 次返工 · 意见：…」（含阶段与时间），并在知识库未连接时照常显示；验证：浏览器打开一个被打回过的任务详情，可见返工记录；把 Vault 配置清空后再刷新，返工区块仍显示且无报错
- [x] 3.8 B2 端到端实测：填打回意见 → 返工产出，抓取该次 LLM 调用的最终 system prompt 验证意见存在；验证：后端测试或本地日志断言 prompt 含意见原文（记录该次 prompt 片段到 change 目录内的验证记录文件）

## 4. B11 生图重试上限与 failed 不计入待决策（image-retry-policy）

- [x] 4.1 确认并加固自动重试上限：核对 `smart-producer.ts` 的 `produceImages` 循环上限为 3（不新增重试层数），并把上限抽为可被测试断言的常量或参数；验证：单测断言上限常量为 3，且注入「必失败」生图桩后自动尝试次数恰为 3
- [x] 4.2 记录累计尝试次数：在服务层落 `status='failed'` 时写入 `attempts`（含自动重试次数）；验证：单测断言 3 次失败后该图 `attempts === 3` 且 `error` 非空，成功路径 `attempts` 为实际尝试次数
- [x] 4.3 修正 `allImagesDecided` 语义（`backend/src/delivery/store.ts`）：只认 `approved`/`rejected`/`skipped` 为终态，`failed` 不参与判定；验证：单测覆盖四组批次——[approved, approved, failed] 判定为 true、[approved, failed] true、[approved, rejected] true、[pending, failed] false（仍等待）
- [x] 4.4 跳过操作：`decision: 'skip'` 只把目标图标记为已跳过，不产生 `REJECTED` 事件、不触发返工；验证：单测断言跳过后该图状态为跳过、同批其他图状态不变、`task_events` 中无新增 `REJECTED`，且随后 `allImagesDecided` 为 true
- [x] 4.5 拍板点推进（部分失败）：构造 [approved, approved, failed] 批次后调用 `service.decideDeliverable`，验证：断言任务 `column` 由 `awaiting` 推进（不因 failed 阻塞），且推进事件 payload 记录失败图片数
- [x] 4.6 拍板点推进（全部失败）：构造 [failed, failed, failed] 批次，验证：断言任务仍可推进（不停留在待确认），界面所需数据中包含「全部图片生成失败」的警示信息
- [x] 4.7 打回优先级回归：构造 [failed, rejected] 批次，验证：断言仍触发 `REJECTED` 返工（failed 不掩盖 rejected），且返工次数统计包含该次
- [x] 4.8 单张重试接口：新增 `POST /api/tasks/:id/deliverables/images/:imageId/retry`（落点：`backend/src/routes/tasks.ts` + `service.ts`），只重生成该图；验证：单测断言其余图片的 `url`/`status` 完全不变，目标图成功后状态为 `pending` 且 `url` 非空、`attempts` 递增
- [x] 4.9 重试上限拦截：已用尽 3 次尝试的图片再次重试；验证：单测断言接口返回可见错误（提示已达重试上限）、生图桩被调用次数不增加、该图状态仍为 `failed`
- [x] 4.10 前端失败图操作：`ContentDeliveryView.tsx` 在 `failed` 图卡片显示失败原因与「已尝试 N/3 次」，并提供「重试」「跳过」按钮（执行中禁用、错误以 Toast 或卡片内文本可见提示）；验证：浏览器制造一次失败图（可用无渠道配置/错误 baseUrl 的桩），卡片出现两个按钮，点击「跳过」后角标变为「已跳过」，点击「重试」在超限时出现可见错误提示
- [x] 4.11 前端 `skipped` 状态穷尽覆盖：缩略图角标、大图预览状态文案、决策按钮可见性、`imgBlockState` 分支均处理跳过态；验证：浏览器逐项核对一个含 [approved, skipped, failed] 批次的阶段视图，无「未决」误标、无按钮错位

## 5. 集成与回归验收

- [x] 5.1 后端测试全绿：`pnpm --filter ./backend test` 0 failure，新增用例覆盖 2.1–2.5、3.1–3.6、4.1–4.9 的全部断言点
- [x] 5.2 前后端构建：`pnpm typecheck` 与 `pnpm build` 均 0 error
- [x] 5.3 端到端实测（对应主文档 T1 验收标准 1–4）：关联产品资料的任务产出带「已溯源」标记；任务详情可见溯源率且与人工核对一致；打回意见在返工 prompt 中被验证存在且详情可见返工次数与意见；人为制造一次生图失败 → 至多自动重试 3 次 → 拍板点仍可推进（不卡死）；验证：按上述四条逐条执行并截图/记录到 `openspec/changes/quality-loop/` 内的验证记录文件
- [x] 5.4 边界与降级回归：① 未关联资料任务 → 只见人工核对警示、无溯源率数值；② 知识库未连接（Vault 清空）→ 任务全流程照常、返工区块照常显示；③ 关联资料失效（Vault 删除该文件）→ 注入按既有「资料缺失」降级且不误判为已溯源；④ 生图成功路径（3 次内成功）行为与改动前一致；验证：四条逐项在浏览器中执行通过
- [x] 5.5 交付物与归档回归：既有 copy/image 交付物展示、逐张采纳/打回、归档与恢复行为无回归；验证：跑一遍「确认开工 → 文案采纳 → 主图逐张采纳 → 详情图采纳 → 校对放行 → 归档」，与改动前行为一致
- [x] 5.6 文档一致性：更新本 change 的 design.md / proposal.md 中与实现产生偏差的描述（如最终函数名、接口路径），并在 `openspec/changes/quality-loop/` 内记录已知偏差；验证：`openspec validate quality-loop` 通过，`openspec status --change quality-loop --json` 四个工件均为 `done`
