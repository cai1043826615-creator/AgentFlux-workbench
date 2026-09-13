## 1. 源层：热榜适配器 ×3，下线统计局

- [ ] 1.1 新建 `backend/src/knowledge/hot-sources/baidu.ts`：百度热搜适配器（`https://top.baidu.com/api/board?platform=wise&tab=realtime`，JSON，解析 cards[].content[].word/desc/url → RawSourceItem，latestAt=抓取时刻，上限 30 条）；验证：typecheck 通过
- [ ] 1.2 新建 `backend/src/knowledge/hot-sources/60s.ts`：微博/抖音热榜适配器（60s API `/v2/weibo`、`/v2/douyin`，解析 data[].title/hot/url，latestAt=抓取时刻）；验证：typecheck 通过
- [ ] 1.3 新建 `backend/src/knowledge/hot-sources/toutiao.ts`：头条热榜适配器（`hot-event/hot-board/?origin=toutiao_pc`，解析 data[].Title/HotValue/Url）；验证：typecheck 通过
- [ ] 1.4 删除 `hot-sources/stats-sjjd.ts` 并从注册表移除；注册 3 个新适配器（baidu-hot / 60s-weibo / 60s-douyin / toutiao-hot）；验证：typecheck 通过
- [ ] 1.5 `attention.ts` 内置默认源列表更新：移除 stats-sjjd，追加 4 个热榜源（全部 enabled），保留电商派/网经社/AI聚合为可选；验证：删除 backend/config/attention.json 后重启，GET /api/hot 返回含新源条目
- [ ] 1.6 真机验证各源可达性：curl 4 个端点各一次，记录成功/失败（失败源由降级机制兜底，不阻塞）

## 2. 识别层：AI 批量打标

- [ ] 2.1 新建 `backend/src/knowledge/hot-tagging.ts`：`tagHotItems(items) → Map<id, {cls, tag, use}>`，单次 LLM 调用（复用 assistant 的 callLlm 链路与 agent-assistant 身份），输出 JSON 解析失败→全批降级「可参考」；验证：typecheck 通过
- [ ] 2.2 打标提示词：三类判定标准（产出方向=可直接变主图/详情页/选品/内容选题；可参考=有背景价值；无关=纯社会娱乐）+ 正反例 + 强制 JSON 输出格式 `{items:[{t,c,tag,use}]}`；验证：用 5 条真实标题手测打标结果合理性（含 1 条明显无关的）
- [ ] 2.3 聚合层接入：`hot.ts` 在去重后调用打标，结果合并进条目字段（`aiClass`/`aiTag`/`aiUse`），随 HotPanel 一起进缓存；验证：两次 GET /api/hot 第二次不触发 LLM（日志或耗时对比）
- [ ] 2.4 HotPanel 共享类型更新：条目增加可选 `aiClass?: 'dir'|'ref'|'none'`、`aiTag?: string`、`aiUse?: string`；验证：三端 typecheck 通过

## 3. 展示层：三分组重构

- [ ] 3.1 `HotView.tsx` 分组从 `['mustRead','browse','other']` 改为 `['dir','ref','none']`（产出方向/可参考/无关），组名与 TIER_LABEL/TIER_HINT 更新；「无关」默认折叠（复用既有 collapsedOther 机制）；验证：typecheck 通过
- [ ] 3.2 产出方向卡片渲染 AI 徽章（aiTag）与用法建议（aiUse 一行）；验证：DevTools 断言产出方向组内卡片含徽章文案
- [ ] 3.3 统计区改口径：今日收集 N 条 · 产出方向 N · 可参考 N · 条目最新发布日期（保留 P1-14 已做的上游停更提示）；验证：DevTools 断言统计区文案
- [ ] 3.4 删除 Pill 组件残留与「多源共振」类术语；验证：全库检索无残留
- [ ] 3.5 AI 降级态验证：临时改错 LLM key（或 mock 抛错），确认面板全部进「可参考」且显示「AI 识别暂不可用」，不报错；验证后还原

## 4. 沉淀层：收进灵感（替换挂任务）

- [ ] 4.1 `assistant.ts` 增加 `AssistantKind 'inspire'`：输入热点条目，产出灵感方向卡（趋势要点/产出方向/适配品类场景/来源链接），写 kb_drafts（sourceKind='inspire'；schema 的 KIND 约束同步）；验证：typecheck 通过
- [ ] 4.2 路由 `POST /api/kb-assistant/collect`：body 传热点条目，调 inspire，返回草稿 id；验证：curl 一条真实热点，收件箱出现新卡
- [ ] 4.3 HotCard 操作按钮「挂为任务背景」→「收进灵感」（调用新路由，成功 toast 指向「助理收件箱」）；AttachModal 及相关状态删除；验证：DevTools 实测收进灵感全链路
- [ ] 4.4 任务详情「关联热点背景」入口删除（HotRefsPanel 保留只读列表+失效标记+移除按钮）；验证：DevTools 断言入口不存在且既有数据仍显示
- [ ] 4.5 schema/类型：kb_drafts 的 sourceKind 约束加 'inspire'；HotCard 的 onAttach 链路清理；验证：三端 typecheck 通过

## 5. 关注域配置弹窗降级

- [ ] 5.1 AttentionModal 只保留「数据源管理」区（源启用/禁用/端点/展示名），关键词/排除词/多词阈值编辑区隐藏（数据不删）；降噪逻辑在 hot.ts 旁路（classifyHot 恒通过）；验证：typecheck + 面板拉取正常
- [ ] 5.2 弹窗标题与入口文案复核：「热点源配置」保留；关键词相关文案不再出现；验证：DevTools 断言

## 6. 整体验证

- [ ] 6.1 三端 typecheck exit 0；官方测试链无新增失败（hot-intel-core 若涉分组断言需同步更新其测试数据与断言）
- [ ] 6.2 Chrome DevTools 全链路：打开面板→AI 打标完成→三分组正确→产出方向卡带方向与用法→无关组折叠可展开→收进灵感→助理收件箱出现新卡（知识库页可读）
- [ ] 6.3 回归：旧任务（#7 已挂热点背景）详情背景列表照常显示；注入测试（hot-inject）全绿
- [ ] 6.4 边界确认：热点仍不派生任务（无任何创建任务入口）；Vault 只读零变化
- [ ] 6.5 提交并更新 tasks 勾选
