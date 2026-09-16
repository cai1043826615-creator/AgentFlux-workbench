## 1. 快照与识别（后端）

- [x] 1.1 `catalog_snapshot(kind, ref, hash)` 幂等建表（`ensure.ts`），提供「按 kind 覆盖式写入（同一 `tx` 内先删后插）」与「按 kind 读全量」两个函数
- [x] 1.2 新增 `backend/src/agents/mount-repoint.ts`：`diffCatalog(kind, oldSnapshot, nextEntries)` 产出「旧引用 → 新引用」映射；判定严格按 design 决策 3（唯一才跟随）；歧义/无候选/无旧指纹一律跳过
- [x] 1.3 `repointMounts(renames)`：改写 `workflow_skills` / `workflow_files`（分份）与 `skills` / `files`（派生并集）**四个列**，走同一函数保证同步；改写后做条目去重（防同一处出现重复引用）
- [x] 1.4 技能侧：`scanIndex()` 计算技能文件内容指纹（技能不在 Vault 索引内）；技能索引重建时落快照并触发比对
- [x] 1.5 文件侧：`indexer.ts` 的 `writeIndex()` 取「重建前快照」为基线 → 构建 → 触发比对 → **成功后**落新快照（失败不落，基线保持对应一次成功状态）
- [x] 1.6 跟随动作写后端日志（旧 → 新、影响条数）；不写任务事件、不加用户面呈现

## 2. 测试

- [x] 2.1 改名（内容未变）⇒ 自动跟随（技能与文件各一例）
- [x] 2.2 改名 + 内容同时变更 ⇒ 不跟随，保持失效
- [x] 2.3 内容指纹相同的两份文件 ⇒ 歧义，不跟随
- [x] 2.4 删除 ⇒ 不跟随（不得误判为改名）
- [x] 2.5 同一文件被多个 Agent / 多个工作流份挂载 ⇒ 全部跟随，且各处不出现重复条目
- [x] 2.6 无快照（首次升级）⇒ 不跟随且不报错；落快照后下一轮具备跟随能力
- [x] 2.7 幂等：连续两次索引，第二次无任何改写
- [x] 2.8 分份列与并集列改写后一致（无残留旧引用）
- [x] 2.9 不回归：既有「失效标红 + 可移除」与 `FILE_MOUNT_RENAMES`（pdf→md 一次性迁移）行为不变

## 3. 验证

- [x] 3.1 三端 typecheck 通过；后端测试链无新增失败（24/24 文件全绿，含本变更新增测试）
- [x] 3.2 真实场景：把 `docs/示例Vault/技能库/电商/电商文案模板.md` 改名 → 触发索引 → 美美的电商份自动指到新名，注入探针仍含该技能正文（并验证改回原名同样跟随）
- [x] 3.3 真实场景：改名 + 改内容 → 保持失效（标红），不误指；日志中有跳过原因
- [x] 3.4 真实场景：移动 Vault 文档到另一目录 → 美美的文件挂载自动跟随，`readFileContent` 可解析，并集列同步

## 4. 文档与边界

- [x] 4.1 `docs/开发文档/开发注意事项.md` 18.x 补「改名/移动自动跟随」与「快照基线」两段说明（含失败情形与手动重挂路径）
- [x] 4.2 写明升级首轮无基线 ⇒ 当轮不跟随，下一轮自愈
- [x] 4.3 与在建 `skill-workflow-isolation` 的边界说明（两者都动挂载列，冲突点在 `ensure.ts` / `skills.ts`）

## 5. 实施记录（2026-09-16）

- 新增 `backend/src/agents/mount-repoint.ts`（快照读写 + `diffCatalog` + `repointMounts` + `followCatalogChanges`）。
- 分份 JSON 解析与并集工具从 `ensure.ts` 上移到 `db/agent-mounts.ts` 导出，`ensure.ts` 与 `mount-repoint.ts` 共用同一份实现（避免两处各写一遍）。
- 接入点：`knowledge/indexer.ts` 的 `writeIndex()`（**在 DELETE 之前**取基线，构建成功后落新快照）；`skills.ts` 的 `scanIndex()` → 新增 `syncSkillCatalog()`（原构建逻辑拆为 `buildSkillIndex()`）。
- 测试 `backend/src/agents/__tests__/mount-rename-follow.test.ts`（4 组 18 例）已加入 `backend/package.json` 的 test 链。
- 真实环境验证 10/10 断言通过；验证用的临时改名/临时文档与挂载**已全部恢复**（Vault 与 HEAD 字节一致）。
- **实测发现的固有限制**（已写进 design 风险与开发注意事项 18.5，并用测试断言固化）：跟随只能从「曾进入过基线」的引用出发；功能上线前就已失效的引用无法追溯修复（与引入前行为一致）。
