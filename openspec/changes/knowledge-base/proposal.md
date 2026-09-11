## Why

电商多 Agent 工作台当前只解决「任务执行」，缺资料底座：Agent 生成时只能依赖新建任务时手工粘贴的描述与少量挂载文件，团队积累的产品资料、历史案例、品牌规范散落在本地 Obsidian Vault 中，无法被工作台利用。需要新增一个与工作流**互相独立**的知识库管理系统（板块 B）：连接本地 Obsidian Vault，提供索引/浏览/搜索/知识星图/每日热点，并通过「任务关联资料」把知识库内容注入 Agent 上下文——让产出有据可依，知识库越用越厚。

## What Changes

- **新增板块 B「知识库管理系统」**，与板块 A「多 Agent 工作流」平行独立、互不阻塞、互不影响：
  - **Vault 连接**：通过设置面板/环境变量指定本地 Obsidian Markdown 目录，只读接入（仿 person_dashboard 的 `PERSONAL_DASHBOARD_VAULT_ROOT` 思路）
  - **索引与浏览**：扫描 Vault 内 `.md` 文件建索引，按目录/标签浏览，工作台内阅读 Markdown 原文；提供知识库总览（索引统计）
  - **全文搜索**：SQLite FTS5（trigram 分词，解决中文分词）关键词搜索
  - **知识星图**：知识对象（文档/概念/标签）节点 + 链接/标签关系边的图谱可视化
  - **每日热点面板**：公共匿名热点 API（复用 person_dashboard 的 AI HOT 思路）+ 电商化关注域配置 + 缓存
- **唯一耦合点「任务关联资料」**（v1 手动）：新建任务时从知识库勾选资料（可精确到文档章节/片段），挂到任务输入，Agent 执行时作为上下文注入——板块 A 对板块 B 只读消费，不写
- **渐进路线**：v1 手动关联跑通「Vault → 任务」链路；v2 再引入 RAG 自动检索注入（本次明确不做，作为边界声明）
- **独立性保障**：板块 B 未配置/异常时板块 A 照常运行；知识库数据域独立（独立表），不触碰工作流状态机；板块 B 内部任务（索引重建/热点抓取）全异步，不阻塞任务推进

## Capabilities

### New Capabilities

- `knowledge-base`: Vault 接入（Obsidian Markdown 目录只读连接）、文档索引、目录/标签浏览、Markdown 阅读、知识库总览、FTS5 全文搜索
- `knowledge-graph`: 知识星图——知识对象节点与链接/标签关系边的图谱可视化与交互
- `daily-hot`: 每日热点——公共匿名热点 API 拉取、电商化关注域过滤分层、缓存与前端面板
- `workflow-context`: 任务与知识库资料的关联——新建任务时从知识库勾选资料（含章节片段）注入任务上下文，作为板块 A/B 的唯一耦合点

### Modified Capabilities

- 无（板块 A 行为不变；主 `openspec/specs/` 目前为空，不产生 delta 修改）

## Impact

- **后端**：新增 `backend/src/knowledge/` 模块（Vault 扫描、索引、检索、热点抓取）+ 独立数据域（新表：`knowledge_docs` / `knowledge_links` / `knowledge_hot_cache` 等）；新增 REST 路由（知识库/星图/热点）；不触碰工作流状态机与既有表
- **前端**：新增 `frontend/src/features/knowledge/`（知识库页/星图/热点面板）+ 左栏「知识库」入口；新建任务弹窗增加「关联知识库资料」步骤
- **共享类型**：`@workbench/shared` 扩展知识库相关类型与契约（KBDoc / KBTag / KBLinks / HotItem 等）
- **配置**：Vault 根路径（设置面板 + 环境变量兜底）、热点关注域配置（仿 person_dashboard 的 `attention` 配置）
- **外部依赖**：无新增运行时依赖（FTS5 随 better-sqlite3 提供；热点用原生 fetch 调公共匿名 API）
- **不影响既有功能**：板块 A 独立运行；未配置 Vault 时板块 B 显示「未连接」而不影响工作流
