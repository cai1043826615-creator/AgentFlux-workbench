# 验证记录 — 2026-09-14 技能分区挂载与技能库实体化

change：`2026-09-14-skill-category-sections`（实施日期 2026-09-13 晚 ~ 2026-09-14）

## 1. `GET /api/agents/skills` 基线 vs 改造后

**基线（改造前）**：扁平目录 2 个技能（`电商文案模板`、`小红书合规违禁词清单`），响应无 `category` 字段（当时该字段尚不存在）。

**改造后（运行中的 4310 dev server 实测，HTTP 200）**：7 条，全部分类非空，排序「电商 → 小红书 → 通用」：

| # | id | category |
|---|----|----------|
| 1 | 电商视觉规范 | 电商 |
| 2 | 电商文案模板 | 电商 |
| 3 | SEO 关键词 | 电商 |
| 4 | 小红书合规违禁词清单 | 小红书 |
| 5 | 素材结构化 | 通用 |
| 6 | 知识库整理 | 通用 |
| 7 | 质检清单 | 通用 |

对应单测 `backend/src/agents/__tests__/skills.test.ts`（9/9 通过）覆盖同样断言，另含 `parseSkillMeta` 三情形单测、`categoryRank` 排序、**冷启动直读回归**（进程重启后未经 `listSkills` 直接 `readSkillContent` 必须命中分类子目录——防止技能静默注入为空）。

## 2. system prompt 注入比对结论

验证脚本（临时库 + ensureSchema + seed + 真实 `buildSystemPrompt`）输出：

- 美美（agent-copy）prompt 中依次出现：【挂载技能】→ `## 技能：电商文案模板` / `## 技能：SEO 关键词` / `## 技能：小红书合规违禁词清单` →【挂载文件】→ `## 文件：品牌手册.md`，技能正文特征词「绝对化用语」命中（子目录技能全文注入成功，旧扁平查找在冷启动下会静默为空）。
- 与「假想基线」（技能文件仍在根目录、无分类行）的**逐字差异仅为每个技能全文头部多一行 `> 分类：…`**（美美 3 个挂载 = 3 行），源于任务 4.2 的预期文件变更，分类元数据不参与任何过滤逻辑，注入语义无回归。
- `WORKFLOW_SKILLS`（`小红书合规违禁词清单 → ['xhs-note']`）与【工作流专属技能】段未受本次改造影响（静态断言通过；该段仅经由 `readSkillContent` 读文件，冷启动行为已被单测覆盖）。

## 3. 前端截图（4310 实测，1680×1050 逻辑视口）

- `mount-sections.png`：美美配置弹窗上部 — 已挂载技能列表显示「SKILL 电商文案模板【电商】」「SKILL SEO 关键词【电商】」分类徽标，`FILE 品牌手册.md`（存量迁移生效）。
- `mount-sections-scrolled.png`：挂载面板完整分区 — **电商（已挂 2/3）→ 小红书 → 通用** 三区，勾选状态（✓电商文案模板、✓SEO 关键词）与 DB 持久化一致，面板在弹窗内可滚动（6.1 / 6.2 / 5.5）。
- 5.4 失效标记采用代码级验证（`skillCategory()` 查不到返回 null → 红色「已失效」且保留 × 移除按钮）：未向运行中的用户生产库注入脏数据做现场演示。

## 4. 存量库处理结论（4.4 遗留 → 4.6 迁移）

- `ensureSchema()` 末尾的幂等迁移 `migrateAgentFileMounts()` 仅精确改写 `agents.files` JSON 中的 `品牌手册.pdf → 品牌手册.md`、`品牌视觉规范.pdf → 品牌视觉规范.md`，其余元素与解析失败的行不动；二次执行零变化（try/catch ALTER TABLE 同款惯例）。
- 运行中的 4310 服务随 tsx watch 重启自动完成存量迁移：美美挂载列表已显示 `品牌手册.md`（见截图）。
- 全新库路径：seed 挂载全集（美美 3 技能 + 品牌手册.md；平平 电商视觉规范 + 品牌视觉规范.md；波波 质检清单；依依 知识库整理 + 素材结构化）在验证脚本中**全部解析为非空内容**。

## 5. 测试与构建

- `backend pnpm test`：**全绿**（22 个测试文件、281 组断言 0 失败，含新增 skills.test.ts）。
- `pnpm typecheck`（全 workspace）与 `pnpm build`（backend tsc + frontend vite）全部通过。
- **计划外修复（主干既有回归，非本 change 引入）**：`delivery/package.test.ts` 的「文案+图片+manifest」失败 — c046ecb 引入的 `asNote` 判断 `copyStages.includes(copySource.stage)` 对电商任务恒为 true，把电商 CopyPackage 误走小红书 Note 渲染分支导致 `points` 丢失；且 Note 分支误用 `cp.outline/cp.keywords`（NotePackage 实际字段为 `body/tags`）。已修为 `isXhsWorkflow(task.workflowId) && copySource.stage.startsWith('xhs-')`，并按正确字段渲染 Note。修复后 7/7 通过。
- 6.4（任务真实走通）：已由验收脚本 `acceptance-2026-09-14.mts` 补齐——临时库 + mock LLM 走真实服务层（`createTask` → `confirmAndRun`），A1–A4 全过（column=awaiting / stage=copy、文案 deliverable pending、事件时间线完整、CopyPackage 有效且 5 条卖点）；另以注入链路逐字比对（§2）双重覆盖。脚本五组 11/11 PASS，结果收录进《验收报告-2026-09-14.html》。

## 6. 附带事件：git 仓库对象库损坏与恢复（与本 change 代码无关）

- 会话中一次 `git stash -u` 被沙箱安全策略 SIGTERM 击杀（本环境同样拦截一切 `git fetch` 网络写操作），导致 `.git/refs/` 目录与最后 3 个提交（c046ecb / eb95c56 / c28d2d1）的 loose objects 丢失。
- 已恢复：refs 从 reflog 精确重建（master = origin/master = c046ecb），**工作区全部 17 个变更文件完好**，损坏前的 `.git` 快照备份在 `.git-backup-20260914/`。
- 剩余一步需用户在有网络授权的终端执行：`git fetch origin` —— 拉回缺失的 3 个提交对象后仓库即完全恢复（status/log/commit 可用）。
