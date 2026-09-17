# Design — report-driven-fixes

## Context

核验报告（2026-09-17）给出 5 P1 + 15 P2 + 8 P3 缺陷清单，需求方已逐条拍板处置决议（报告 §8.1，其中 D-01/D-02/D-03/D-04/D-05~D-12/D-19/D-20/D-21/D-22/D-23/D-24/D-25/D-26/D-29~D-33 均按报告各条目建议执行）。技术栈：pnpm monorepo，backend Fastify + better-sqlite3 + tsx（4311），frontend React 19 + Vite（4310），packages/shared 共享类型。UI 受 `docs/规范/01_UI设计与组件规范_0916.md` + `frontend/scripts/check-ui-rules.mjs` 强制约束。知识库/工作流是平行独立板块（架构铁律 10），Vault 只读承诺即将精确化为"只新增于灵感库"。

## Goals / Non-Goals

**Goals:**
- 打通「热点 → 灵感库 → 工作流」链路（D-19/D-20/D-24）
- 消除 3 个"卡住做不下去"的 P1（D-01/D-02/D-19）与 2 个性能 P1（D-03/D-04）
- 热点模块按 §9 定案落地：产出灵感雷达 + AI 打标三分组 + 泛热榜源
- 全部 UI 改动通过 `check-ui-rules.mjs` 与术语校验

**Non-Goals:**
- 不接小红书内容源（A 档）；不做促销日历；不复活 hot-trend-pivot 沉淀层设计
- 不做星图性能优化之外的结构重做（报告 §3.4 结论：任务详情骨架一致，不做重构）
- `task_hot_refs` 通道去留（T1）、60s 源选型（T2）等**待确认项不擅自决定**，报告中标注即可

## Decisions

### D1. 生图落地为文件（D-03/D-04，最高收益单项）

- 生图结果不再以 base64 dataURL 存入 `deliverables.content`，改为写 `backend/data/uploads/<uuid>.png`，content 存相对路径 `/uploads/<file>`
- 复用既有 `/uploads/:file` 静态路由（报告确认已存在）
- **存量迁移**：一次性迁移脚本扫描旧 base64 content → 落盘 → 更新 content → `settings` 写迁移标记（遵循架构铁律 11：不写成启动常驻迁移）
- 搜索（D-04）：新增 `deliverable_images(deliverable_id, image_id, name, status, url)` 索引表，搜索走该表 LIKE，不再全表 JSON.parse
- 列表接口（D-03）：`deliverables(task_id, updated_at)`、`task_events(task_id, created_at)` 复合索引；`UPDATED_AT_EXPR` 改 LEFT JOIN 聚合子查询；`countKbRefsByTask` 合并单条 IN 查询

### D2. 任务详情补挂资料（D-19）

- 复用现有 `KbRefPicker` 组件 + `api.putTaskKbRefs`（接口已存在但 0 调用，仅需接线）
- 「关联知识库资料」面板空态改为引导卡：「尚未关联资料 · 参数将由模型生成」+「＋ 关联知识库资料」
- 已开工任务改动后提示"新资料将在后续阶段生成中生效，已产出阶段需打回重做"
- 后端补 `docPath` 缺失 400 校验（当前会 200 静默清空，见 §3.5.4）

### D3. 灵感库链路（D-20/D-24，按 §8.3 定案）

- 热点卡片唯一动作「收进灵感库」：调 `POST /api/kb-assistant/organize`（hot 型）→ **直接写盘 `知识库/灵感库/`**
- **不做** kb_drafts 草稿区、不做"工作台"页面（§8.3 已取消）
- `kb_drafts` 表降级为写入日志（谁/何时/收了哪条），用户不可见
- 「挂到工作流」迁至：知识库文档行 + 任务详情页「关联资料」面板；只列未归档未完成的任务（修 D-24）
- 承诺精确化三处同步：知识库设置弹窗文案 + `AGENTS.md` 铁律 10 + 设置弹窗明示写入目录
- 清理旧概念：移除 `助理收件箱/` 虚拟目录映射、界面"收件箱/草稿区"字样、`dirDisplayName.ts` 死配置

### D4. 热点 AI 打标三分组（D-33 + §9）

- 新建 `backend/src/knowledge/hot-tagging.ts`：`tagHotItems(items) → Map<id,{cls:'dir'|'ref'|'none', tag, use}>`，单次 LLM 调用（复用 assistant callLlm 链路，agent-assistant 身份）
- 结果随热点缓存 TTL 复用，不重复调用；LLM 失败全批降级「可参考」+ 标注"AI 识别暂不可用"
- HotView 三分组「产出方向 / 可参考 / 无关」，「无关」默认折叠；统计口径改「今日收集 N · 产出方向 N · 可参考 N」
- 源层：删统计局 + 关 AI HOT + 4 热榜适配器（百度/60s·微博/60s·抖音/头条，端点照 hot-trend-pivot tasks.md 1.1–1.4）+ 2 官方规则源（淘宝天猫规则中心、小红书规则公告）
- 关注域配置降级「源管理」（关键词区隐藏、数据不删）；源作用域作兜底闸门标"建议待确认"
- 缓存按源打 key / 空响应防御 / 三层去重（0911 调研 §5.3）

### D5. 弹窗统一（D-02/D-08/D-31）

- 按 G3 先抽取/复用统一 `Modal`（现有 `frontend/src/components/ui.tsx` 的 Modal），替换：新建任务弹窗（加 `maxHeight:90vh; overflowY:auto`）、知识库设置弹窗（Esc/遮罩可关）、星图标签多选弹窗
- 全部使用既有 token（圆角 4px、`var(--color-*)`），过 `check-ui-rules.mjs`

### D6. 左栏折叠态同源（D-30）

- `App.tsx:496-498` 硬编码的折叠态工作流项删除，改为 `workflows.map()` 渲染（与 `LeftPanel.tsx:76` 同源）
- 删除 2 个假占位（直播带货上架/跨境选品）；图标按工作流区分

### D7. 阶段别名与显式报错（D-01/D-12/D-13/D-23）

- 阶段显示名走别名表（`xhs-image` → 用户可见名），内部 id 不暴露界面
- 阶段不在工作流定义中时：**显式报错**（不再 200 静默）+ 启动校验内置工作流定义同步（`syncBuiltinWorkflow` 已有，补阶段存在性检查）
- 按决议删除 5 个老任务（#27/#20/#19/#18/#14，卡在已废弃阶段）——一次性数据清理脚本
- 文案摘要按阶段优先取（不取第一个 copy）

### D8. 页面高度自适应（D-29/D-32）

- 知识库/星图页外层去 `overflow-auto`，改 `flex + min-h-0` 撑满视口；局部（文档列表/目录树）保留滚动
- 星图画布去 `h-[62vh]`，改 `flex-1 min-h-0` + canvas 尺寸随容器重算
- 知识库标签默认收起（折叠控件）；左栏自身滚动

### D9. 其余小改动（D-05/D-06/D-07/D-09/D-10/D-11/D-14/D-15/D-16/D-17/D-18/D-21/D-25/D-26/D-27/D-28）

- D-05：确认并开工行为对齐（建单即启动或改文案，按报告建议）
- D-06：参考图上传前端守卫（无图不发 400）
- D-07：审批 Toast 同 key 清理（新提示替换旧提示，不堆积）
- D-09：后端广播带 `ownerName`（`taskMerge` 不再 `?? prev` 锁死）
- D-10：「类型」按 `workflowId` 派生（删除硬编码）
- D-11：渠道自检结论修正（生图渠道不误报）
- D-14：头像按钮 `aria-label`
- D-15：`--color-ink-faint` 令牌级校准（同步规范 token 表 + 校验脚本，不只在 index.css）
- D-16：2 个 README 冒烟脚本修复
- D-17/D-18：计数口径说明 + 测试脏数据清理
- D-21/D-25：历史版本、健康度界面隐藏、代码保留
- D-26：展示 `effectivePath` + 期望≠实际时轻提示
- D-27/D-28：筛选/搜索作用域说明扩展现有入口；知识库入口收敛

## Risks / Trade-offs

- [D-03 迁移遗漏] → 一次性迁移幂等 + settings 标记 + 迁移后校验无残留 base64 content
- [AI 打标引入 token 成本/延迟] → 缓存 TTL 复用 + 失败降级"可参考" + 打标前源作用域粗排（待确认项 T2 关联）
- [改承诺文案引发用户疑虑] → 设置弹窗明示写入目录 + 每篇落盘文件自带来源头（源/时间/原文链接）
- [并行会话冲突] → 只改本 change 相关文件；skill-workflow-isolation 已归档，冲突解除
- [UI 校验拦截] → 所有 UI 改动过 `check-ui-rules.mjs`，被拦按提示改，不用 `--no-verify`

## Migration Plan

1. 备份 SQLite（354MB）
2. 一次性脚本：删除 5 个老任务 + 存量 base64 交付物落盘 + settings 标记
3. 后端先行（接口/索引/迁移），前端随后（面板/弹窗/入口）
4. 每批跑验收：typecheck / 测试链 / check-ui-rules / check-secrets / openspec validate

## Open Questions

- T1 `task_hot_refs` 通道删/留、T2 60s 源选型、T3 宏观源替代——已写入报告 §9.7 待确认区，**不阻塞本 change 的其余工作**；T1 影响 hot-context delta 范围，实施时若仍未确认，仅迁移入口不动数据
