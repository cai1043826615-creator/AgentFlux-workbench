# 多 Agent 电商新品上架工作台

Multi-Agent E-Commerce Workbench —— 一套把「电商新品上架全套物料」跑成自动流水线的工作台：3 个各司其职的 Agent（文案 / 设计师 / 主管）接力完成从需求到交付归档的 6 个阶段，关键节点由你拍板，全程有看板、聊天、审批与执行观测。

## 工作流

```
需求对齐 → 卖点文案 ✱ → 主图设计 ✱ → 详情图设计 → 主管校对 → 交付归档
```

- **6 阶段**：需求对齐 → 卖点文案 → 主图设计 → 详情图设计 → 主管校对 → 交付归档
- **2 个拍板点**（✱）：卖点文案、主图设计 —— 产出后停在「待确认」，由你采纳或打回
- **校对回退**：主管校对发现问题时，可沿回退边把任务退回文案 / 主图 / 详情图重新输出
- **并行生图**：主图 / 详情图按渠道分组并行生成（组间并行、组内串行），逐张上报进度，失败不阻塞

## Agent 工位

| 工位 | 角色 | 模型 | 职责 |
| --- | --- | --- | --- |
| 美美 | 文案 | deepseek-chat | 需求对齐、卖点文案、详情大纲、关键词 |
| 平平 | 设计师 | gpt-image-2 | 主图（3 张）、详情图（4 张） |
| 波波 | 主管 | deepseek-chat | 主管校对、终审放行 / 回退、交付归档 |

- 文本 Agent 调用真实 DeepSeek 接口；生图 Agent 调用真实图像生成接口（当前渠道 gpt-image-2）
- 未配置渠道或调用失败时自动降级为内置模拟内容，流程仍可端到端跑通
- **编排模式**：图编排（拍板点等人工确认，默认）/ 线性降级（拍板点自动通过，全自动跑完），可在左侧「设置」切换

## 技术栈

- **Monorepo**：pnpm workspaces（`frontend` / `backend` / `packages/shared`）
- **前端**：Vite 5 + React 18 + TypeScript + Tailwind CSS v4（Quiet Signal 设计语言基座；布局严格对照低保真线框可交互版）
- **后端**：Fastify 5 + WebSocket（@fastify/websocket）+ SQLite（node:sqlite，WAL）
- **共享**：`@workbench/shared` 类型包（Agent / Task / Event / Deliverable / Message / 工作流定义 / WS 协议），前后端契约一致
- **引擎**：状态图式工作流引擎（6 阶段节点 + 条件分支边 + 并行子任务分组 + 编排开关）

## 目录结构

```
.
├── frontend/                 # React 前端（Vite + Tailwind v4）
│   └── src/
│       ├── features/         # board / status / content / observability / chat / workstation / LeftPanel
│       ├── components/       # QS 风格 UI 基座（Btn/Badge/Card/Modal/StageFlow/Avatar）
│       ├── store/            # WorkbenchProvider（视图/任务/Agent/WS 订阅/审批）
│       └── lib/              # API 客户端 / WS 客户端
├── backend/                  # Fastify 后端
│   └── src/
│       ├── engine/           # 图定义 + 执行器 + 并行调度 + 事件总线
│       ├── agents/           # 运行时 / LLM / 生图 / 渠道配置 / 执行日志 / 播报
│       ├── db/               # node:sqlite 客户端 / schema / 种子
│       ├── routes/           # tasks / workflows / agents / executions / chat / settings
│       └── ws/               # WebSocket 广播与消息处理
├── packages/shared/          # @workbench/shared 共享类型与工作流常量
├── openspec/                 # OpenSpec 变更文档（proposal / design / tasks / specs）
└── docs/                     # 验收清单（含大白话版）
```

## 快速启动

要求：Node.js ≥ 22（内置 `node:sqlite`）、pnpm ≥ 9。

```bash
# 1. 安装依赖（跳过构建脚本；无原生编译依赖）
pnpm install --ignore-scripts

# 2. 配置渠道密钥（可选，不配置则用内置模拟内容跑通全流程）
#    复制 backend/.env.local.example 为 backend/.env.local 并填写：
#    LLM_API_URL / LLM_API_KEY / LLM_MODEL / IMAGE_API_URL / IMAGE_API_KEY / IMAGE_MODEL
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
```

前端验收请见 `docs/验收清单-大白话版.md`（逐步操作 + 预期表现）与 `docs/前端UI验证清单.md`、`docs/前端操作测试清单.md`。

## 设计说明

- **布局基准**：`2026-09-08-电商新品上架工作流设计/低保真线框-可交互版-多Agent电商工作台.html`（三栏结构、工位栏、四列看板、任务详情页、内容交付两栏、审批条）
- **视觉语言**：Quiet Signal（近白画布 / 黑色信息层级 / 衬线 Display + 等宽 Metadata / 有限紫色信号 / 无阴影 / 大结构直角），注入 gpt-taste 排版与动效品味
- **功能约束**：任务在「确认并开工」前不会启动任何 Agent；审批集中在「内容交付」页（文案整包 + 图片逐张 + 底部审批条）；执行日志与任务活动日志互不污染
