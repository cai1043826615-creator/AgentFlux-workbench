# GodUI 动效组件库调研报告（为电商多 Agent 工作台选型）

> 调研对象：https://godui.design/ ｜ 调研日期：2026-09-08 ｜ 方法：read_page 本地引擎抓取（sitemap.xml 核实全部 URL）+ 浏览器实访
> 技术栈背景：React + Tailwind CSS v4，Quiet Signal 规范（近白表面、黑灰主色、稀疏紫色焦点、大结构直角、小控件 4px 圆角、默认无阴影、禁玻璃拟态/渐变光晕）。

## 一、站点定位

GodUI 是开源（MIT）**动效组件库**：React + TypeScript + Tailwind CSS v4 + Motion + shadcn/ui 生态。**纯代码组件**（非 Figma/设计规范），通过 `npx shadcn@latest add "https://godui.design/r/<组件>.json"` 安装。另有 MCP Server、Animated Icons 子站、Motion Principles/Patterns 设计文档。公开可访问无需登录。

## 二、目录（10 大类约 90+ 组件，URL 经官方 sitemap 核实）

Buttons 10 / Inputs 2 / Navigation 11 / Overlays 7 / Layout 29 / Text 7 / AI 7 / Collaboration 4 / Visualizations 6 / Effects 17 / Backgrounds 10 / Glass 2。组件页均为 `/docs/components/<分类>/<组件>`。

## 三、对本项目的借鉴结论

### ✅ 直接用
| 组件 | 要点 | URL |
|---|---|---|
| Toast | 堆叠+滑动关闭+imperative API+success/error 变体+Undo action | https://godui.design/docs/components/overlays/toast |
| Stepper | spring 进度线+数字→勾 morph，水平/垂直 | https://godui.design/docs/components/layout/stepper |
| Scroll Progress | 3px 顶部进度条+回顶圆环 | https://godui.design/docs/components/navigation/scroll-progress |
| Segmented Control | iOS 滑动 pill | https://godui.design/docs/components/navigation/segmented-control |
| Dropdown Menu / Combobox | 键盘导航/async loading/子菜单交互规范 | https://godui.design/docs/components/navigation/dropdown-menu |
| Accordion | smooth 模式无过冲 | https://godui.design/docs/components/layout/accordion |
| Avatar Group | 头像组堆叠 | https://godui.design/docs/components/collaboration/avatar-group |
| **Agent Flow** | 可拖拽 Agent 节点图+数据包流动——与多 Agent 工作台契合度最高 | https://godui.design/docs/components/ai/agent-flow |
| **Agent Timeline** | Agent 步骤时间线+状态+可折叠工具输出 | https://godui.design/docs/components/ai/agent-timeline |
| **Prompt Composer** | AI 输入框：auto-grow/附件 chips/发送→停止 morph | https://godui.design/docs/components/ai/prompt-composer |
| **Motion Principles** | Restraint「subtle beats flashy」、只动画 transform/opacity/filter、prefers-reduced-motion——最值得采纳的克制动效规范 | https://godui.design/docs/motion/principles |

### ⚠️ 改造后用（去 3D/彩虹/玻璃，保留状态机与交互）
- 按钮：Progress Fold Button 内嵌进度、Hold/Slide Confirm 破坏操作确认。
- Magic Input：idle→loading→success→error 完整状态生命周期+内嵌进度条（宝藏）。
- Morphing Dialog：Escape/背板关闭/scroll lock/reduced-motion 规范照抄，morph 动效可去。
- Filter Bar：过滤条+计数徽章+chips（电商筛选利器）。
- Bento Grid：布局结构 + rounded-2xl border 细边框基线（圆角收敛 4px）。

### ❌ 明确禁用（整类排除）
全部 3D 按钮变体、Tilt/Holographic/Liquid Glass 卡片、全部 Backgrounds（光晕/渐变/粒子）、全部 Text 特效、Border Beam/Confetti/Spotlight、Dynamic Island、Dock、Swipe Deck、Split-Flap、Cover Flow、光标特效。

### ❌ 缺失（全库没有，需 shadcn/ui 或自建）
表格 Table、普通状态徽章、空态 Empty State、文本域 Textarea。

## 四、落地路线

shadcn/ui 打底基础组件（表格/徽章/空态/文本域）+ GodUI 精选 AI 与状态类组件（Agent Flow/Timeline/Stepper/Toast）+ 采纳 Motion Principles 作为动效规范。

> 注：本环境 web_fetch 报「godui.design 解析到非公网 IP」属 DNS 判定误报；read_page 本地引擎全部 200 抓取成功。
