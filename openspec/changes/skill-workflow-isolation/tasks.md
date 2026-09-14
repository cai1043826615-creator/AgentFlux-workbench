## 1. 数据层：按工作流分份

- [x] 1.1 ~~`WORKFLOW_CATEGORIES` 映射表~~ → 改为 `workflowSkillsOf(workflowId, agent)` 读取函数（shared：读 workflow_skills[key]，空则回退旧全局 skills）；验证：typecheck 通过
- [x] 1.2 shared 类型：`Agent` 增加 `workflowSkills?: Record<string, string[]>`；验证：typecheck 通过

## 2. 数据与注入（后端）

- [x] 2.1 `ensureSchema` 给 agents 表幂等补列 `workflow_skills TEXT`；验证：typecheck + migrations 测试通过
- [x] 2.2 ~~skillCategoryOf 分类过滤~~ → **移除分类过滤逻辑**（挂什么用什么）；`buildSystemPrompt` 增加可选参数 `mountedSkills?: string[]`（producer 路径传该任务工作流的份；不传回退旧全局）；验证：typecheck
- [x] 2.3 producer 调用点：`smart-producer` 从 task.workflowId 取份传入（读时兜底：workflow_skills 空 → 回退 agents.skills，等价每份初始值=旧全局）；验证：typecheck
- [x] 2.4 `PUT /api/agents/:id` 扩展负载 `workflowSkills`：写入列并重算 `agents.skills` 并集；GET /api/agents 返回 workflowSkills；验证：typecheck
- [x] 2.5 测试重写（skill-workflow-isolation.test.ts）：①电商份注入=电商份内容；②小红书份注入=小红书份内容；③双份互不影响（改电商份小红书份不变）；④兜底（无 workflow_skills 回退全局）；⑤合规清单强制追加不回归；⑥并集视图同步；验证：全绿
- [x] 2.6 shared/workflow.ts 移除 WORKFLOW_CATEGORIES/allowedCategoriesFor（上一轮方案的遗留，语义已被分份取代）；验证：typecheck

## 3. 配置弹窗分份展示 + 二级弹窗（前端）

- [x] 3.1 `AgentSettingsModal`「技能与文件」卡片改分份形态：电商行/小红书行/文件行（工作流名+已挂条目+×移除+各自「＋ 挂载」按钮）；× 即时改对应份；验证：typecheck
- [x] 3.2 `SkillMountPicker` 重构：进入时指定目标份（targetWorkflowId 或 files）；主区=目标份完整编辑（三分区+搜索+吸顶）；只读摘要呈现另一份与文件；暂存-「完成」只落目标份；验证：typecheck
- [x] 3.3 保存链路：配置弹窗「保存」把 workflowSkills 一起 PUT；二级弹窗「完成」回写配置弹窗 state（统一由保存持久化）；验证：typecheck
- [x] 3.4 保留：失效标红、防滚动穿透、未保存 confirm、Esc/遮罩关闭；验证：代码走查

## 4. 回归与验证

- [x] 4.1 三端 typecheck + 官方测试链无新增失败
- [x] 4.2 Chrome DevTools：配置弹窗分份展示/行内挂载定向/×移除定向/二级弹窗聚焦与摘要/搜索/一次性保存/无脏数据
- [x] 4.3 真实任务归因：电商任务 prompt=电商份；小红书任务 prompt=小红书份；合规清单仍在
- [x] 4.4 勾选收尾
