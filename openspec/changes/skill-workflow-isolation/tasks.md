## 1. 映射表（shared 层）

- [ ] 1.1 `packages/shared/src/workflow.ts` 新增 `WORKFLOW_CATEGORIES`（`ecom-new-listing`→`['电商','通用']`、`xhs-note`→`['小红书','通用']`）与 `allowedCategoriesFor(workflowId): string[] | null`（未列出→null=全可见）；验证：typecheck 通过
- [ ] 1.2 类型导出与既有 workflow 常量并列；验证：shared typecheck 通过

## 2. 注入过滤（后端）

- [ ] 2.1 `backend/src/agents/skills.ts` 新增 `skillCategoryOf(skillId): Promise<string | null>`：复用 ensureIndex + categoryOfPath + parseSkillMeta（与 listSkills 同一解析链），未命中返回 null；验证：typecheck 通过
- [ ] 2.2 `smart-producer.ts` 的 `buildSystemPrompt` 签名加 `workflowId?: string`：解析挂载列表后，`allowedCategoriesFor(workflowId)` 非 null 时逐技能查 category，不在集合内且 category 已知（非 null）→ 跳过 `readSkillContent`；验证：typecheck 通过
- [ ] 2.3 `buildProducerSystemPrompt` 与各调用点把 `task.workflowId` 透传进 `buildSystemPrompt`（非 producer 调用点不传 = 全可见兜底）；验证：typecheck 通过
- [ ] 2.4 确认 `WORKFLOW_SKILLS`（合规清单）路径未受影响（workflowSkillBlock 逻辑零改动）；验证：代码走查
- [ ] 2.5 新增注入过滤测试（skills.test.ts 或新文件）：①电商任务不含小红书技能全文；②小红书任务不含电商技能全文；③通用技能两端都注入；④未知 workflowId 全注入；⑤无分类技能注入不被过滤；⑥合规清单在 xhs-note 持续注入；验证：node --experimental-strip-types 全绿

## 3. 二级弹窗挂载选择器（前端）

- [ ] 3.1 新建 `frontend/src/features/workstation/SkillMountPicker.tsx`：左右两栏（左=已挂载含分类徽标/失效标红/×移除，右=分区目录+搜索框）、max-height 70vh 可滚动、分区标题 sticky、暂存 Set + 「完成」一次性保存、未保存变更关闭需 confirm；验证：typecheck 通过
- [ ] 3.2 `AgentSettingsModal.tsx`：「＋ 挂载 skill 和文件」改为打开二级 Modal（复用 ui.tsx Modal），内嵌挂载面板移除；二级打开期间外层内容区 overflow hidden（防滚动穿透），关闭还原；验证：typecheck 通过
- [ ] 3.3 挂载面板分区说明补一行灰字「技能按工作流分类生效：电商任务仅使用电商+通用类技能」（防「挂了却不生效」困惑）；验证：文案存在
- [ ] 3.4 文件挂载保持现状内联添加（不进二级弹窗）；验证：代码走查

## 4. 回归与整体验证

- [ ] 4.1 三端 typecheck exit 0；官方测试链无新增失败（skills.test.ts 全绿）
- [ ] 4.2 Chrome DevTools 全链路：Agent 配置挂载 小红书+电商+通用 技能各一 → 电商任务产出（日志确认 prompt 含电商/通用、不含小红书）→ 小红书任务产出（反向确认）；合规清单仍在 xhs-note prompt
- [ ] 4.3 二级弹窗交互：挂 20+ 技能可滚动/吸顶/搜索命中「SEO」/完成保存/取消无脏数据/Esc 关闭/外层不滚动穿透
- [ ] 4.4 回归底线：失效技能标红仍全量可见；未知分类技能原样展示；既有验收单 #3/#4/#5 复验不回归
- [ ] 4.5 提交并勾选 tasks
