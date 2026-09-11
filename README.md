# 多 Agent 电商新品上架工作台

Multi-Agent E-Commerce Workbench —— 一套把「电商新品上架全套物料」跑成自动流水线的工作台：3 个各司其职的 Agent（文案 / 设计师 / 主管）接力完成从需求到交付归档的 6 个阶段，关键节点由你拍板，全程有看板、聊天、审批与执行观测。

## 工作流

```
需求对接 → 卖点文案 ✱ → 主图设计 ✱ → 详情图设计 ✱ → 主管校对 → 交付归档
```

- **6 阶段**：需求对接 → 卖点文案 → 主图设计 → 详情图设计 → 主管校对 → 交付归档
- **3 个拍板点**（✱）：卖点文案、主图设计、详情图设计 —— 产出后停在「待确认」，由你在「内容交付」页采纳或打回
- **采纳即推进**：文案整包采纳 / 图片逐张采纳（全部采纳后自动推进），无需回看板重复操作
- **校对回退**：主管校对发现问题时，可沿回退边把任务退回文案 / 主图 / 详情图重新输出
- **并行生图**：主图 / 详情图按渠道分组并行生成（组间并行、组内串行），逐张上报进度，失败不阻塞
- **交付物按阶段独立**：主图、详情图、文案各自独立存储展示，互不覆盖

## Agent 工位

| 工位 | 角色 | 模型 | 职责 |
| --- | --- | --- | --- |
| 美美 | 文案 | deepseek-chat | 需求对接、卖点文案、详情大纲、关键词 |
| 平平 | 设计师 | gpt-image-2 | 主图（3 张）、详情图（4 张） |
| 波波 | 主管 | deepseek-chat | 主管校对、终审放行 / 回退、交付归档 |

- 文本 Agent 调用真实 DeepSeek 接口；生图 Agent 调用真实图像生成接口（当前渠道 gpt-image-2）
- 未配置渠道或调用失败时自动降级为内置模拟内容，流程仍可端到端跑通
- **编排模式**：图编排（拍板点等人工确认，默认）/ 线性降级（拍板点自动通过，全自动跑完），可在左侧「设置」切换

## 0909 修改意见落地亮点

- **Q 版 Agent 头像**：美美 / 平平 / 波波各有 AI 生成 Q 版 iOS 风头像，全站（工位栏 / 看板 / 聊天 / 详情 / Agent 状态）统一使用
- **Agent 真实对话**：聊天顶部圆头像切换会话（工作群 / 各 Agent），发消息后由**负责对应工作的 Agent** 回复（私聊指定 / 群聊按进行中任务阶段负责人 / 指令性内容由主管波波记录记忆）；回复前先发「已收到」回执，再出正文
- **参考图上传 + 平台多选**：新建任务时必填目标平台（可多选）与参考图（上传后本地转存 `/uploads/`），后续文案与生图均基于该图
- **Agent 设置**：每工位可配模型名称 + API 地址 + 密钥，并**真实挂载技能**（`backend/skills/*.md`，注入 LLM System Prompt）与人设
- **Agent 状态**：执行观测统一改名「Agent 状态」，平均耗时格式化为「x 分 x 秒」；状态点三色（未连接=灰 / 在线待命=绿 / 忙碌=紫闪）
- **详情页重构**：面包屑返回、6 节点大阶段条（数字 + 箭头 + 拍板标记）、活动日志最新在前且同类折叠、审批集中在内容交付页

## 技术栈

- **Monorepo**：pnpm workspaces（`frontend` / `backend` / `packages/shared`）
- **前端**：Vite 6 + React 19 + TypeScript + Tailwind CSS v4（Quiet Signal 设计语言基座；布局严格对照低保真线框可交互版）
- **后端**：Fastify 5 + WebSocket（@fastify/websocket）+ SQLite（node:sqlite，WAL）
- **共享**：`@workbench/shared` 类型包（Agent / Task / Event / Deliverable / Message / 工作流定义 / WS 协议），前后端契约一致
- **引擎**：状态图式工作流引擎（6 阶段节点 + 条件分支边 + 并行子任务分组 + 编排开关）

## 目录结构

```
.
├── frontend/                 # React 前端（Vite + Tailwind v4）
│   └── src/
│       ├── features/         # board / status / content / observability / chat / workstation / LeftPanel
│       ├── components/       # QS 风格 UI 基座（Btn/Badge/Card/Modal/StageFlow/Avatar/Glyph）
│       ├── store/            # WorkbenchProvider（视图/任务/Agent/WS 订阅/审批）
│       └── lib/              # API 客户端 / WS 客户端
│   └── public/               # 静态资源（avatars/ 头像、logo.png）
├── backend/                  # Fastify 后端
│   └── src/
│       ├── engine/           # 图定义 + 执行器 + 并行调度 + 事件总线
│       ├── agents/           # 运行时 / LLM / 生图 / 渠道配置 / 执行日志 / 播报 / 聊天回复 / 技能挂载
│       ├── db/               # node:sqlite 客户端 / schema / 种子
│       ├── routes/           # tasks / workflows / agents / executions / chat / settings
│       └── ws/               # WebSocket 广播与消息处理
│   ├── skills/               # 可挂载技能（Markdown，注入 Agent System Prompt）
│   └── files/                # 可挂载文件（人设 / 知识库等）
├── packages/shared/          # @workbench/shared 共享类型与工作流常量
├── openspec/                 # OpenSpec 变更文档（proposal / design / tasks / specs）
└── docs/                     # 验收清单（含大白话版）、修改意见落地记录
```

## 快速启动

要求：Node.js ≥ 22（内置 `node:sqlite`）、pnpm ≥ 9。

```bash
# 1. 安装依赖（跳过构建脚本；无原生编译依赖）
pnpm install --ignore-scripts

# 2. 配置渠道密钥（可选，不配置则用内置模拟内容跑通全流程）
#    复制 backend/.env.local.example 为 backend/.env.local 并填写：
#    DEEPSEEK_BASE_URL / DEEPSEEK_API_KEY / DEEPSEEK_MODEL / IMAGE_BASE_URL / IMAGE_API_KEY / IMAGE_MODEL
#    （.env.local 已被 gitignore，密钥不会入库）

# 3. 启动后端（端口 4311）
cd backend && node src/index.ts

# 4. 启动前端（端口 4310，代理 /api /ws 到 4311）
cd frontend && npx vite --port 4310 --host 127.0.0.1

# 打开 http://127.0.0.1:4310
```

## 渠道配置说明

- API 地址与密钥按「渠道」配置，密钥仅存于本机 `backend/.env.local`（已 gitignore）
- 文本渠道：OpenAI 兼容 `/chat/completions`（如 DeepSeek）
- 图像渠道：OpenAI 兼容 `/images/generations`（当前 gpt-image-2，返回 base64 写入交付物）
- 每个 Agent 可配置独立模型渠道；生图渠道全局一份

## 测试

```bash
# 图引擎 smoke（11 项：列映射/拍板/采纳/打回/逐张联动/校对回退/全链路/编排开关/并行事件）
cd backend && node src/engine/__tests__/executor.smoke.ts

# Agent 运行时 / 执行日志 / 统计（10 项断言）
cd backend && node scripts/smoke-agents.ts

# 聊天 + 事件播报
cd backend && node scripts/smoke-chat.ts

# 聊天对话链路（Agent 回复 / 回执 / 主管记忆 / LLM 降级，4 段断言）
cd backend && node scripts/smoke-chat-reply.ts

# 技能挂载（技能扫描 / 内容读取 / System Prompt 注入，6 项断言）
cd backend && node scripts/smoke-skills.ts
```

前端验收请见 `docs/验收清单-大白话版.md`（逐步操作 + 预期表现）与 `docs/前端UI验证清单.md`、`docs/前端操作测试清单.md`。

## 设计说明

- **布局基准**：`2026-09-08-电商新品上架工作流设计/低保真线框-可交互版-多Agent电商工作台.html`（三栏结构、工位栏、四列看板、任务详情页、内容交付两栏、审批条）
- **视觉语言**：Quiet Signal（近白画布 / 黑色信息层级 / 衬线 Display + 等宽 Metadata / 有限紫色信号 / 无阴影 / 大结构直角），注入 gpt-taste 排版与动效品味
- **功能约束**：任务在「确认并开工」前不会启动任何 Agent；审批集中在「内容交付」页（文案整包 + 图片逐张 + 底部审批条）；执行日志与任务活动日志互不污染
