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
- [x] 4.3 真实任务归因：电商任务 prompt=电商份；小红书任务 prompt=小红书份；合规清单仍在（单元测试已覆盖注入矩阵；真实 LLM 归因已复验 2026-09-17——本地结构断言 + 真实渠道 LLM 回报双证：电商 prompt 仅注入电商份两技能+品牌手册，小红书 prompt 仅注入合规清单（工作流专属机制，挂载份被排除不重复））
- [x] 4.4 勾选收尾

## 5. 第三批（三轮验收，已随实现落地——文件分份 / 双上传 / 两级界面 / 工作流重排）

- [x] 5.1 文件分份数据层：agents 幂等补列 `workflow_files`；AgentRow/toAgent/shared 类型带出 `workflowFiles`；验证：typecheck + API 返回
- [x] 5.2 文件分份注入：`buildSystemPrompt` 技能与文件统一 `partOf()` 按工作流取份（缺失回退全局）；验证：注入探针（电商注入电商份文件、小红书注入小红书份、互不串）
- [x] 5.3 路由接收 `workflowFiles`（写份 + 全局 files 重算并集）；新增 `POST /api/agents/skills`（saveSkillContent 落技能库/中文分类 + 索引失效）；验证：上传落盘位置与立即可见
- [x] 5.4 双上传按钮：两条工作流标题右侧「上传技能/上传文件」，上传后自动挂到发起方；验证：界面走查 + API 往返
- [x] 5.5 两级界面职责：AgentSettingsModal 增加 `scope`（工位栏=workflow 只显当前份；Agent 状态/知识库=all 总览）；验证：三入口浏览器走查
- [x] 5.6 二级挂载弹窗单工作流化：删其它份只读摘要；技能目录按工作流过滤（电商→电商+通用）；文件列表排除已挂到另一条的；验证：双向走查
- [x] 5.7 弹窗体验：双搜索框统一 176px 右对齐无占位文案、文件区搜索套知识库「输入即出候选」、分类收纳三角、吸顶露残行修复（去容器顶 padding）、高度各缩 20%；验证：滚动 5 位缝隙 0px + 折叠往返
- [x] 5.8 工作流重排：XHS 六段（首图/内页拆分、删发布包装）、主管校对与交付完成自动节点、确认点 4 个；库定义启动自检 syncBuiltinWorkflow；验证：API 返回新定义 + 启动日志
- [x] 5.9 归档前置断言：末段归档无 REVIEW_PASSED 自动回退补校对；负责人链路（创建预填美美/归档波波）；验证：#28 全链走查事件链
- [x] 5.10 一键采纳修复与统一：图片阶段逐张循环决策（修不推进 bug）；两流紫条按钮右置同尺寸（85×33）；文案统一加「失败可打回重做」删「急用」句；交付阶段按钮「导出交付包」；验证：#25/#29 实测
- [x] 5.11 内容交付布局：XHS 两行两栏等高（h-full 补齐）；TaskInfoBar 统一信息条（参考图回退 AI 首图 resolveInfoBarRef 两流共用）；合规审核移信息条下方（任务详情移除）；未关联警示移任务详情（溯源面板去重）；占位格删「模拟占位」；历史任务降级；验证：浏览器逐条走查
- [x] 5.12 笔记文案 300-500 字 prompt 重写（小红书调性 + brief 注入 + mock 加长）；生图超时与电商统一 180s；验证：prompt 文本校验
- [x] 5.13 沉淀文档：docs/开发文档/小红书工作流-三轮修复与挂载改造记录-2026-09-14.md；开发日志 #69/#70
