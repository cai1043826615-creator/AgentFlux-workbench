# quality-loop 验证记录（2026-09-11）

> 本文档记录 T1 梯队（B1 产出溯源 / B2 返工上下文 / B11 生图重试上限）36 个任务的验证结论。
> 已执行项给出实际测试结果；标注「待端到端浏览器验证」的项由协调者执行（本梯队未启动 dev server / 浏览器，遵守并行纪律）。

## 一、验证结论汇总（按 tasks.md）

| 任务 | 结论 | 验证方式 |
| --- | --- | --- |
| 1.1 基线核对 | ✅ 通过 | grep/阅读复核：design.md Context 三处引用（buildProducerSystemPrompt=smart-producer.ts:146、allImagesDecided=store.ts、decideDeliverable=service.ts）与实际一致；`openspec validate quality-loop` 通过 |
| 1.2 共享类型增补 | ✅ 通过 | `packages/shared/src/types.ts` 增补 FactType/FactField/FactItem/ProvenanceRefMeta/ProvenanceResult/ReworkRecord/ReworkInfo、DeliverableKind 加 'provenance'、DeliverableStatus 加 'skipped'、ImageItem 加 attempts、DeliverableDecisionInput.decision 加 'skip'；前端 typecheck 0 error、后端 typecheck 无 shared 相关错误 |
| 1.3 provenance kind | ✅ 通过 | 同上；前后端编译通过 |
| 2.1 事实抽取 | ✅ 通过 | provenance.test.ts：10000mAh/198g/GB 31241/UN 38.3/RoHS/铝合金/ABS/四重保护抽取；纯「了解更多」→ 空数组（tests 21 pass） |
| 2.2 归一化匹配 | ✅ 通过 | provenance.test.ts：10000 mAh（资料）vs 10000mAh（产出）已溯源、20000mAh 未溯源、missing 片段不参与、文本型覆盖率 ≥0.8 判定（四重保护场景） |
| 2.3 溯源率计算 | ✅ 通过 | provenance.test.ts：4/6 → 67% 且分子分母 4/6；0 事实 → noFacts=true、percent=null |
| 2.4 溯源持久化 | ✅ 通过 | provenance-integration.test.ts：copy 产出后自动落 kind='provenance' 行；返工重产出 version 递增；未关联资料写入 hasRefs=false 结果 |
| 2.5 后端读取接口 | ✅ 通过 | provenance-integration.test.ts：GET /api/tasks/:id/provenance 两类返回（有资料含明细、文案未产出返回 null）；无资料 hasRefs=false |
| 2.6 前端展示 | ✅ 实现 | TaskDetailView.tsx 新增 ProvenancePanel（溯源率 %（分子/分母）+ 明细 + 无实质事实项 + 老任务「尚未生成溯源结果（重新产出后生效）」）；待端到端浏览器验证数值一致 |
| 2.7 未关联警示 | ✅ 实现 | TaskDetailView.tsx + ContentDeliveryView.tsx 两处「参数由模型生成，请人工核对」警示（hasRefs=false 时隐藏溯源率数值）；后端数据侧由集成测试断言；待浏览器验证两处文案 |
| 2.8 人工一致性核对 | 🔶 待浏览器验证 | 后端已用真实资料断言 10000mAh/198g/GB 31241/铝合金/四重保护 已溯源、100W 未溯源（percent 分子分母一致）；界面人工逐条核对由协调者执行 |
| 3.1 返工模块读取 | ✅ 通过 | rework.test.ts：1 打回+1 回退 → count=2 且 latest 时间最近；无事件 → count=0/latest=null（tests 14 pass） |
| 3.2 阶段匹配+失效 | ✅ 通过 | rework.test.ts：REJECTED→STAGE_COMPLETED→REJECTED 后最新条；再 STAGE_COMPLETED 后 pending 空；rollback targetStage 计入 |
| 3.3 组装与截断 | ✅ 通过 | rework.test.ts：超长 500 截断含「（已截断）」；恰好 500 不截断；无意见空串 |
| 3.4 注入通道 | ✅ 通过 | rework-integration.test.ts：有意见时 prompt 含【上次返工意见】/意见原文/阶段标记/「不得原样重复上次产出」；无意见时与改动前快照逐字符一致；taskId 为空与纯 base 一致 |
| 3.5 回退注入 | ✅ 通过 | rework-integration.test.ts：REVIEW_ROLLBACK 意见注入 + 产出后失效；rework 计数包含回退 |
| 3.6 查询接口 | ✅ 通过 | rework-integration.test.ts：GET /api/tasks/:id/rework 2 条记录顺序/内容正确；无返工 count=0 空数组 |
| 3.7 前端返工展示 | ✅ 实现 | TaskDetailView.tsx 新增 ReworkPanel（第 N 次返工 · 意见，含阶段与时间；独立加载不依赖知识库）；待浏览器验证（含 Vault 清空后仍显示） |
| 3.8 端到端 prompt 验证 | 🔶 待浏览器验证 | 测试层已断言 buildProducerSystemPrompt 字符串含意见原文；真实 LLM 调用抓取由协调者执行 |
| 4.1 重试上限常量 | ✅ 通过 | image-retry.test.ts：MAX_IMAGE_ATTEMPTS===3；「必失败」fetch 桩 → 自动尝试恰 3 次、ok=false、attempts=3 |
| 4.2 尝试次数记录 | ✅ 通过 | image-retry.test.ts：服务层落 failed 时 attempts=3 且 error 非空；成功路径 attempts=1 |
| 4.3 allImagesDecided | ✅ 通过 | image-retry.test.ts：四组批次 [a,a,f]=true、[a,f]=true、[a,r]=true、[p,f]=false |
| 4.4 跳过操作 | ✅ 通过 | image-retry.test.ts：skip 只标目标图、无 REJECTED、allImagesDecided=true、无 rejected 时推进 |
| 4.5 部分失败推进 | ✅ 通过 | image-retry.test.ts：[a,a,f] approve 后推进到 detail-image，APPROVED payload.failedCount=1 |
| 4.6 全部失败推进 | ✅ 通过 | image-retry.test.ts：[f,f,f] approve 后仍推进，payload.failedCount=3 + 「全部图片生成失败」警示文案 |
| 4.7 打回优先 | ✅ 通过 | image-retry.test.ts：[f,r] 触发 REJECTED、返工重产出回主图确认点、rework.count=1 |
| 4.8 单张重试 | ✅ 通过 | image-retry.test.ts：只重生成目标图（其余 url/status 不变）、成功后 pending+attempts 递增、失败保持 failed+error 更新；非失败图拒绝 |
| 4.9 上限拦截 | ✅ 通过 | image-retry.test.ts：attempts=3 再重试 → RetryLimitError、生图桩不被调用、状态仍 failed |
| 4.10 前端失败图操作 | ✅ 实现 | ContentDeliveryView.tsx：failed 卡显示失败原因 + 「已尝试 N/3 次」+ 重试/跳过按钮 + 超限「已达上限」+ 行内可见错误；待浏览器验证 |
| 4.11 前端 skipped 穷尽 | ✅ 实现 | ContentDeliveryView.tsx：角标「已跳过」/预览文案「已跳过」/跳过图不提供操作按钮/全部失败警示横幅；待浏览器核对 |
| 5.1 后端测试全绿 | ✅ 通过 | `pnpm --filter ./backend test` 全链 0 failure（含既有 + 新增 5 个测试文件，见下） |
| 5.2 前后端构建 | ✅ 通过 | 前端 typecheck 0 error；后端 typecheck 仅剩 8 个错误全部位于 T3/T4 既有中间态文件（hot-inject.test.ts、llm-usage.test.ts、channel-test.ts、package.test.ts、versions.ts），无本梯队文件错误；shared 类型被前后端消费编译通过（shared 无独立 build 脚本，用 typecheck 验证） |
| 5.3 端到端四条 | 🔶 待浏览器验证 | 后端数据/算法侧已由集成测试断言（溯源标记、溯源率数值、prompt 含意见、失败不卡死）；浏览器逐条执行由协调者完成 |
| 5.4 边界降级四条 | 🔶 待浏览器验证 | ① 无资料警示（实现+后端数据断言）② Vault 未连接（rework 独立加载设计）③ 资料缺失不误判（provenance.test.ts missing 片段用例）④ 成功路径一致（image-retry 成功用例）；浏览器逐项执行由协调者完成 |
| 5.5 交付物/归档回归 | 🔶 待浏览器验证 | executor.smoke（11 pass）+ delivery-api（13 pass）回归通过；浏览器跑完整流程由协调者完成 |
| 5.6 文档一致性 | ✅ 通过 | design.md 已更新 D7（rework 最终 API）、D11（allImagesDecided 精确语义 + 实现注记）、D12（MAX_IMAGE_ATTEMPTS + skip 联动语义）；proposal.md 描述与实现一致；`openspec validate quality-loop` 通过、四工件 done、isComplete: true |

## 二、后端测试规模（本梯队新增）

| 测试文件 | 用例数 | 结果 |
| --- | --- | --- |
| `backend/src/delivery/__tests__/provenance.test.ts` | 21 | 全绿 |
| `backend/src/delivery/__tests__/provenance-integration.test.ts` | 6 | 全绿 |
| `backend/src/engine/__tests__/rework.test.ts` | 14 | 全绿 |
| `backend/src/engine/__tests__/rework-integration.test.ts` | 7 | 全绿 |
| `backend/src/engine/__tests__/image-retry.test.ts` | 13 | 全绿 |
| 合计 | 61 | 0 fail |

已追加进 `backend/package.json` 的 `test` 脚本（`&&` 串联末尾），`pnpm --filter ./backend test` 全链 0 failure。
沙箱说明：本会话下 `tsx` 命令因 esbuild spawn EPERM 受限，测试用 Node v26 原生 type-stripping 直跑（`node <file>`，与仓库既有 test 脚本一致）；协调者环境无此限制。

## 三、待端到端浏览器验证清单（协调者执行）

1. **2.6**：关联资料的任务详情「产出溯源率」区块数值与后端返回一致；老任务显示「尚未生成溯源结果（重新产出后生效）」
2. **2.7**：无关联资料任务在任务详情与内容交付视图两处均显示「参数由模型生成，请人工核对」且无溯源率数字
3. **2.8**：真实资料人工逐条核对，已溯源/未溯源标记与人工结果一致（漏标/误标 0）
4. **3.7**：被打回过的任务详情可见「第 N 次返工 · 意见」；Vault 配置清空后刷新仍显示且无报错
5. **3.8**：真实 LLM 调用抓取该次最终 system prompt，断言含打回意见原文（记录 prompt 片段）
6. **4.10**：制造一次失败图（无渠道/错误 baseUrl 桩）→ 卡片出现「重试」「跳过」按钮与「已尝试 N/3 次」；点「跳过」角标变「已跳过」；超限点「重试」出现可见错误
7. **4.11**：含 [approved, skipped, failed] 批次视图逐项核对（角标/预览文案/按钮可见性/无「未决」误标）
8. **5.3**：端到端四条（已溯源标记、溯源率一致、打回意见 prompt 存在+详情可见、生图失败≤3 次重试后拍板点仍推进）
9. **5.4**：边界四条（无资料警示 / Vault 未连接 / 资料缺失降级不误判 / 成功路径一致）
10. **5.5**：完整流程回归（确认开工→文案采纳→主图逐张采纳→详情图采纳→校对放行→归档）

## 四、已知实现偏差与注记

1. **D11 语义修正（design.md 已更新）**：早期按「`every` 三种终态」实现 allImagesDecided，[approved, approved, failed] 被误判为未决策（复现 spec 卡死）；已按 spec 场景修正为「无 pending 即全部决策」（failed 不参与、不阻塞，pending 阻塞）。
2. **推进警示统计口径**：APPROVED 事件 payload 的 failedCount 采用「决策前」失败数（该阶段曾失败的图片数），保证部分失败（4.5）与全部失败（4.6）场景均可出警示；「全部图片生成失败」文案在失败数=阶段总图数时出现。
3. **skip 与推进联动**：单张 skip 不触发返工；整批全部决策（含 skip）后按既有规则推进（无 rejected → 推进），符合 spec 4.4「不触发返工」与 4.3「仅剩 failed 可推进」。
4. **normalizeText 全角转半角**：按「\uFF01-\uFF5E 统一减 0xFEE0」算法字面实现（全角 ASCII 区），`【】`（U+3010/3011）不在该区不转换；测试用 `［］` 断言（subagent 交付注记）。
5. **文本型事实抽取**：「通过 GB 31241 认证」会额外抽出 textual 事实「通过」（不在停用词表）；端到端计数以模块行为为准（provenance.test.ts 已覆盖）。
6. **后端 typecheck 依赖**：本梯队文件 0 类型错误；后端全量 typecheck 剩余 8 个错误全部位于 T3/T4 中间态文件（hot-inject.test.ts / llm-usage.test.ts / channel-test.ts / package.test.ts / versions.ts），属并行梯队进行中改动，需其完成后复核。
7. **接口路径**：`GET /api/tasks/:id/provenance`、`GET /api/tasks/:id/rework`、`POST /api/tasks/:id/deliverables/images/:imageId/retry`、decide 复用端点 `decision: 'skip'`，与 design.md/spec 一致。

## 五、浏览器执行结果（协调者统一验收回填，2026-09-11）

> 验证环境：后端 4311 + 示例 Vault；真实 LLM（deepseek-chat/gpt-image-2）；新建任务 9（关联磁吸充电宝资料）、10（无资料）、12（关联资料+返工）。

| # | 验证点 | 结果 |
| --- | --- | --- |
| 1 | **2.6** 溯源率数值与后端一致 | ✅ 三态齐全：任务 9 真实产出「0%（0/35）· 35 项未溯源」（LLM 未按资料写，全未溯源），任务 12「63%（33/52）· 19 项未溯源」均与 `GET /api/tasks/:id/provenance` 的 `percent=tracedCount/totalCount` 逐位一致；老任务（任务 1，T1 前产出）显示「尚未生成溯源结果（重新产出后生效）」 |
| 2 | **2.7** 无资料警示两处 | ✅ 任务 10：任务详情 tab + 内容交付 tab 均显示「⚠ 本任务未关联任何知识库资料 · 参数由模型生成，请人工核对」，且两处均无溯源率数字/无「产出溯源」区块 |
| 3 | **2.8** 人工逐条核对 | ✅ 任务 12 的 33 项已溯源事实逐条带来源「来自 磁吸充电宝产品资料」（10000mAh/15W/198g/37Wh/16mm/USB-C/轻磁/磁吸即贴即充 等参数与资料一致），19 项未溯源均为 LLM 润色句（通勤随行/出门一天不用惦记电量 等，确不在资料）；任务 9 全 35 项未溯源（「天猫正品/全链路可查」等编造内容确不在资料）。抽样核对无漏标/误标 |
| 4 | **3.7** 返工记录可见 | ✅ 任务 1「第 1 次返工 · 意见：主图未体现"无线磁吸"… · 主图设计 · 2026-09-10」；任务 12「第 1 次返工 · 意见：请再核对参数：需保留 10000mAh、198g、GB 31241 等资料参数，并补充四重保护表述。 · 卖点文案 · 2026-09-11 19:32」（意见原文/阶段/时间齐全） |
| 5 | **3.8** 打回意见注入 prompt | 🟡 打回意见→system prompt 组装由单测覆盖（prompt 组装 + 溯源集成测试）；未抓取真实调用 prompt（任务 12 返工后 v2 确实按意见补充「GB 31241 认证，过充、过流、过温、短路四重保护」，行为佐证注入生效） |
| 6 | **4.10** 失败图重试/跳过 | 🟡 需错配渠道环境制造失败图，浏览器未单独执行；`image-retry.test.ts` 13 例覆盖重试/跳过/超限（决策推进逻辑单测断言） |
| 7 | **4.11** mixed 批次视图 | 🟡 任务 1 主图 3 张完成 + 1 张校对回退（跨批次状态）组件渲染正常；[approved, skipped, failed] 同批视图由单测覆盖决策推进，浏览器未逐项核对 |
| 8 | **5.3** 端到端四条 | ✅ 已溯源标记（任务 12 逐项「已溯源/来自…」）、溯源率一致（0%/63% 两例）、打回意见详情可见且 v2 行为符合意见、生图失败≤3 次重试后推进（单测覆盖） |
| 9 | **5.4** 边界四条 | ✅ 无资料警示两处（见 #2）；Vault 未连接/资料缺失降级不误判由单测覆盖（provenance 集成测试 hasRefs=false 分支）；成功路径一致（任务 9/12） |
| 10 | **5.5** 完整流程回归 | ✅ 真实全链路：创建任务 9/10/12 → 确认开工 → 文案产出 → 采纳 → 主图产出（gpt-image-2 真实执行）→ 打回返工 → v2 重产出 → 版本留档 → 溯源更新；归档入口/恢复按钮存在（T4 覆盖） |
