# Aceternity UI 组件库调研报告（为电商多 Agent 工作台选型）

> 调研对象：https://ui.aceternity.com/components
> 调研日期：2026-09-08
> 方法：浏览器实访组件列表页 + 逐个核实 12 类目标组件详情页（HTTP 200/404 验证），并抓取 6 个核心组件页的真实 CSS 细节（圆角/阴影/配色/动效类名）。
> 技术栈背景：目标应用为 React + Tailwind CSS v4，Quiet Signal 视觉规范（近白表面 + 黑灰 + 稀疏紫色，大结构直角、小控件 4px 圆角、默认无阴影、禁用玻璃拟态/渐变/光晕/层层圆角）。

---

## 一、站点总体结论（先说重点）

Aceternity UI 的**定位是「营销落地页组件库」**（自称 "for beautiful landing pages"），主打动效与氛围组件：光晕、渐变、玻璃拟态、胶囊圆角、滚动/视差、3D。其大部分组件默认就是**深色 + 发光 + 大圆角**的展示风格，与 Quiet Signal「近白克制」规范**根本性冲突**，**不能直接照搬**。

但它的价值在于：
1. **组件「结构/交互」思路可借鉴**（如状态按钮、步骤加载、胶囊 Tab 的激活态滑动、Bento 网格密度、Empty States 排版），借鉴后把视觉改为 Quiet Signal 的细线 + 白底 + 4px 圆角即可。
2. **基础组件（Button/Input/Modal/Tabs/Table/Dropdown/Accordion/Toast/Skeleton/Badge）Aceternity 并不提供**——这些页面全部 404。它们依赖 shadcn/ui 提供基础实现，Aceternity 只做「炫技层」。所以本项目的基础组件仍应由自己/ shadcn 体系承担，Aceternity 仅作视效参考。

---

## 二、站点组件目录（实访列表页所得，URL 均已验证）

组件页侧边栏即权威目录，按分类列出代表性组件（约 60+，此处选与工作台相关者）：

### 2.1 背景与特效（绝大多数与 Quiet Signal 冲突，仅列参考）
| 组件 | URL |
|---|---|
| Sparkles 星光粒子 | https://ui.aceternity.com/components/sparkles |
| Aurora Background 极光 | https://ui.aceternity.com/components/aurora-background |
| Background Beams 光束 | https://ui.aceternity.com/components/background-beams |
| Grid and Dot Backgrounds 网格/点阵 | https://ui.aceternity.com/components/grid-and-dot-backgrounds |
| Spotlight 聚光 | https://ui.aceternity.com/components/spotlight |
| Glowing Effect 发光描边 | https://ui.aceternity.com/components/glowing-effect |
| Background Gradient 渐变背景 | https://ui.aceternity.com/components/background-gradient |
| Wavy Background 波浪 | https://ui.aceternity.com/components/wavy-background |

### 2.2 卡片类（工作台高频）
| 组件 | URL |
|---|---|
| Bento Grid 网格卡片 | https://ui.aceternity.com/components/bento-grid |
| Card Spotlight 高光卡片 | https://ui.aceternity.com/components/card-spotlight |
| Glare Card 眩光卡片 | https://ui.aceternity.com/components/glare-card |
| 3D Card Effect 3D 卡片 | https://ui.aceternity.com/components/3d-card-effect |
| Card Hover Effect 悬停滑动高亮 | https://ui.aceternity.com/components/card-hover-effect |
| Wobble Card 位移缩放卡片 | https://ui.aceternity.com/components/wobble-card |
| Focus Cards 聚焦模糊卡片 | https://ui.aceternity.com/components/focus-cards |
| Expandable Card 展开卡片 | https://ui.aceternity.com/components/expandable-card |
| Cards Sections Free 免费卡片区块 | https://ui.aceternity.com/components/cards-free |

### 2.3 按钮 / 表单 / 悬浮层（工作台高频）
| 组件 | URL |
|---|---|
| Tailwind CSS buttons 按钮合集 | https://ui.aceternity.com/components/tailwindcss-buttons |
| Magnetic Button 磁吸按钮 | https://ui.aceternity.com/components/magnetic-button |
| Stateful Button 状态按钮 | https://ui.aceternity.com/components/stateful-button |
| Moving Border 流动边框 | https://ui.aceternity.com/components/moving-border |
| Placeholders And Vanish Input 输入框 | https://ui.aceternity.com/components/placeholders-and-vanish-input |
| Signup Form 注册表单 | https://ui.aceternity.com/components/signup-form |
| File Upload 文件上传 | https://ui.aceternity.com/components/file-upload |
| Animated Modal 动画模态框 | https://ui.aceternity.com/components/animated-modal |
| Animated Tooltip 动画气泡 | https://ui.aceternity.com/components/animated-tooltip |
| Link Preview 链接预览 | https://ui.aceternity.com/components/link-preview |

### 2.4 导航 / 数据呈现 / 加载
| 组件 | URL |
|---|---|
| Tabs 动画标签页 | https://ui.aceternity.com/components/tabs |
| Sidebar 侧边栏 | https://ui.aceternity.com/components/sidebar |
| Floating Dock 悬浮坞 | https://ui.aceternity.com/components/floating-dock |
| Multi Step Loader 步骤加载器 | https://ui.aceternity.com/components/multi-step-loader |
| Loader 加载器合集 | https://ui.aceternity.com/components/loader |
| Timeline 时间线 | https://ui.aceternity.com/components/timeline |
| Images Badge 图片徽章 | https://ui.aceternity.com/components/images-badge |
| Codeblock 代码块 | https://ui.aceternity.com/components/code-block |
| Compare 对比控件 | https://ui.aceternity.com/components/compare |

### 2.5 付费 Pro 区块（Blocks，需 All-Access）
| 区块 | URL |
|---|---|
| Empty States 空态 | https://ui.aceternity.com/blocks/empty-states |
| FAQs 手风琴 FAQ | https://ui.aceternity.com/blocks/faqs |
| Cards 卡片区块 | https://ui.aceternity.com/blocks/cards |
| Stats Sections 数据统计 | https://ui.aceternity.com/blocks/stats-sections |
| Sidebars 侧边栏区块 | https://ui.aceternity.com/blocks/sidebars |

### 2.6 实测不存在的组件（全部 404，勿引用）
Toast/Toaster、Table、Accordion、Dropdown Menu、Popover、Skeleton、Progress、Stepper、Textarea、独立 Button、独立 Input、独立 Badge —— **均无独立详情页**。基础组件依赖 shadcn/ui 体系（Aceternity 与 shadcn 兼容）。

---

## 三、12 类目标组件逐项视效借鉴要点

> 每项：可借鉴点（✔）+ 与 Quiet Signal 的冲突点（✘）。URL 均为实测有效。

### 1. 按钮 Button
URL: https://ui.aceternity.com/components/tailwindcss-buttons（合集，含 20+ 款）/ https://ui.aceternity.com/components/stateful-button

- ✔ **Stateful Button** 的「点击 → loading → 成功」三态自动切换交互非常值得照抄进工作台（如「保存」「生成」按钮），它演示了如何用极小动效表达异步完成。
- ✔ 合集里 **Next.js Blue / Simple** 两款是「hover 加深投影 + 轻微上移」的克制做法，可留作微调基准。
- ✔ **Favourite** 款（纯黑底白字、hover 降透明度）视觉最接近我们规范，圆角需从 6px 改 4px。
- ✘ **大多数款式不可照搬**：Gradient（蓝渐变胶囊）、Border Magic / Moving Border（流动渐变边框）、Shimmer（流光）、SPOTIFY（胶囊 + hover 缩放 105%）、BRUTAL（多层硬阴影）、Backdrop blur（玻璃拟态）、Tailwind Connect（渐变描边胶囊）——这些正是规范禁止的渐变/光晕/大面积圆角/炫技 hover。
- ✘ 默认圆角多为 rounded-full（胶囊）或 6–12px，需统一降为 4px。

### 2. 卡片 / Bento Grid / 背景
URL: https://ui.aceternity.com/components/bento-grid / https://ui.aceternity.com/components/cards-free / https://ui.aceternity.com/components/card-spotlight

- ✔ **Bento Grid** 的**栅格结构与信息密度**（卡片内标题 + 说明 + 底部可视组件，`rounded-xl border border-neutral-200 bg-white p-4`）可直接作为工作台「看板/概览」布局模板；hover 时 `hover:shadow-xl` 的过渡时序（duration-200）可借鉴，但阴影强度需降为无/极轻。
- ✔ **Card Hover Effect** 的「整组卡片共享一个滑动高亮层」思路，可用来做「Agent 工作台」的卡片组选中态（把高亮改为细紫色边框/浅紫底色即可，正好用上规范里的稀疏紫色）。
- ✘ **Card Spotlight / Glare Card / 3D Card Effect / Wobble Card / Evervault Card** 是典型的「光晕 + 玻璃 + 3D 倾斜 + 渐变」，全部禁照搬。
- ✘ Bento 内部块常用 `bg-gradient-to-br` 渐变图块与圆点背景，需替换为纯色/细线。

### 3. 输入框 Input / Textarea
URL: https://ui.aceternity.com/components/placeholders-and-vanish-input / https://ui.aceternity.com/components/signup-form

- ✔ **Vanish Input** 的**占位符轮播**思路（placeholder 文字在框内横向滑动切换）很适合工作台搜索框，实现上是轻量的位置动画，不违反规范；其**提交后内容「消失收拢」**的反馈动画也可借鉴做「清空/提交」瞬间反馈。
- ✔ **Signup Form** 是构建在 shadcn Input + Label 之上的表单结构，说明它并不自定义基础输入框——本项目输入框仍用自家 4px 圆角组件。
- ✘ Vanish Input 的**容器是 rounded-full 胶囊**（实测 `rounded-full overflow-hidden bg-white shadow-[0px_2px_3px_-1px_rgba(0,0,0,0.1),...]`），需改 4px 圆角、去阴影、白底加 1px 细线。
- ✘ **Gooey Input**（SVG 黏性滤镜展开动画）禁止照搬。

### 4. 模态框 / 对话框
URL: https://ui.aceternity.com/components/animated-modal

- ✔ **Animated Modal 的「触发 → 展开」共享布局动画**（模态从按钮位置生长出来）交互上很优雅，适合工作台的「新建任务」「Agent 配置」弹窗；若保留，需把动画控制在 150–200ms 内、只做位移动画不做缩放炫技。
- ✔ 实测其**内容容器本身是克制的**：`bg-white rounded-lg shadow-sm border`（白底、轻阴影、细边框）——这个「表面」可直接沿用。
- ✘ 触发按钮默认是纯黑胶囊，动画偏「营销化」；本项目建议回归 4px 圆角按钮 + 极简淡入淡出。

### 5. 提示 Toast / Notification
URL: 无独立组件（https://ui.aceternity.com/components/toast → 404，https://ui.aceternity.com/components/toaster → 404）

- ✘ **Aceternity 不提供 Toast**。若希望站内风格统一，可从 shadcn/ui 的 sonner 或自家 Toast 入手，视觉按 Quiet Signal（白底、1px 细线、4px 圆角、成功/错误用稀疏紫色与红灰点缀）。
- ✔ 可参考 **Stateful Button** 的「loading→success」动画节奏，作为 Toast 内「进行中→完成」的状态切换参考。

### 6. 进度条 / 步骤指示器
URL: https://ui.aceternity.com/components/multi-step-loader / https://ui.aceternity.com/components/loader / https://ui.aceternity.com/components/timeline

- ✔ **Multi Step Loader** 的「多步骤逐个点亮 + 文案随步骤变化」交互，正是本项目 StageStepper 可借鉴的结构（把胶囊点改为 4px 直角小块、完成态用紫色填充即可）。
- ✔ **Loader** 合集提供多种极简微加载器，其中「线条/点状」款式可挑一款改单色。
- ✔ **Timeline** 的「sticky 标题 + 纵向时间线」结构适合「订单流转」「Agent 执行历史」。
- ✘ 均无标准 Progress 条组件；需自建。禁止照搬其常用的渐变进度色与发光光束（Tracing Beam）。

### 7. 徽章 / 标签 Badge
URL: https://ui.aceternity.com/components/images-badge

- ✔ **Images Badge** 是「头像堆叠 + hover 展开更多」的交互，适合工作台的「任务协作者」「Agent 群组」头像显示——它本身是头像组件而非文本徽章。
- ✘ 无标准文本 Badge/Tag 组件（404）。本项目 Badge 保持 Quiet Signal 既有实现（细线 + 4px 圆角 + 稀疏紫色/中性灰），Aceternity 无可借鉴视觉。

### 8. 标签页 Tabs
URL: https://ui.aceternity.com/components/tabs

- ✔ **Animated Tabs 的「激活态背景滑动」**是核心亮点：激活 Tab 有一块浅色背景随点击滑动到目标位（layoutId 动画），其余 Tab 静止。这个交互可直接借用到工作台「任务/商品/报表」分区切换——把胶囊圆角改为 4px、滑动底色改为浅紫即可完全兼容规范。
- ✔ 附带 FadeInDiv 内容淡入，切换内容过渡柔和。
- ✘ 默认胶囊形（`rounded-full px-4 py-2`，实测）需改直角/4px；深色激活态需改浅紫。

### 9. 折叠 / 手风琴 Accordion
URL: 无独立组件（https://ui.aceternity.com/components/accordion → 404）；FAQs 付费区块 https://ui.aceternity.com/blocks/faqs

- ✔ **FAQs 区块**的「激活项展开 + 分隔线动效」结构可借鉴做「运行日志折叠」「规则配置折叠」；交互层级（标题 → 展开内容）是标准手风琴。
- ✘ 该区块为 Pro 付费且带「虚线网格动画」（active item 显示动画虚线），视觉偏营销，需按 Quiet Signal 重做（细线分隔 + 无动画）。

### 10. 下拉菜单 / Popover
URL: 无独立组件（https://ui.aceternity.com/components/dropdown-menu → 404，popover → 404）；相关：https://ui.aceternity.com/components/link-preview / https://ui.aceternity.com/components/animated-tooltip / https://ui.aceternity.com/components/navbar-menu

- ✘ **Aceternity 不提供 Dropdown/Popover 基础组件**。本项目下拉菜单应自建或沿用 shadcn，视觉按 Quiet Signal（白底、细线、4px 圆角、无阴影或极轻）。
- ✔ **Link Preview**（悬浮链接显示内容卡片）的「悬浮浮层」交互可借鉴为工作台「Agent 链接预览」「商品链接悬浮卡」；浮层表面同样按白底细线重做。
- ✘ Animated Tooltip / Navbar Menu 的跟随鼠标/大导航动效属于营销向，不照搬。

### 11. 表格 Table
URL: 无独立组件（https://ui.aceternity.com/components/table → 404）

- ✘ **Aceternity 完全没有表格组件**（连近似组件也没有，仅 Compare/Codeblock 相关）。本项目表格保持 Quiet Signal 既有实现（细线行列、表头中性灰、无斑马渐变）。Aceternity 无可借鉴。

### 12. 空态 / 加载 Skeleton / Empty
URL: 空态 https://ui.aceternity.com/blocks/empty-states（Pro）/ 加载 https://ui.aceternity.com/components/loader / https://ui.aceternity.com/components/multi-step-loader

- ✔ **Empty States 区块**的排版结构（居中图标 + 主副文案 + 单主操作按钮）是标准空态范式，布局可照抄；且它明确标注适用于 dashboards，定位契合。
- ✔ **Skeleton 思路**：Bento Grid 内部用 `rounded-full bg-gray-100 h-4` 模拟骨架条——把胶囊改为 4px 直角灰条即可做工作台表格/卡片骨架屏。
- ✘ Empty States 为付费 Pro 区块且带动效；Skeleton 无独立组件，需自建。骨架动画仅用轻微透明度脉动即可，勿用炫目 shimmer。

---

## 四、Quiet Signal 适配分级汇总（决策速查）

### 🚫 不适合直接照搬（玻璃拟态/光晕/渐变/大圆角/炫技动效）
- Sparkles、Aurora、Background Beams、Vortex、Meteors、Shooting Stars、Glowing Stars、Glowing Effect、Spotlight(+New)、Lamp Effect、Background Gradient(+Animation)、Wavy Background、Dotted Glow、Noise、Background Boxes、Google Gemini Effect、Tracing Beam、SVG Mask Effect、Canvas Reveal Effect
- 3D Pin、3D Card、3D Globe、Comet Card、Evervault Card、Glare Card、Wobble Card、Card Spotlight、Draggable Card、Magnetic Button、Moving Border、Hover Border Gradient
- Gooey Input、Vanish Input 的胶囊外观、Animated Modal 的展开动画、Animated Tabs 的胶囊外观、Tailwindcss-buttons 中 Gradient/BRUTAL/Shimmer/Backdrop blur/SPOTIFY 等款式、Hero Parallax / Macbook Scroll / Sticky Scroll 等营销滚动类
- 所有 Pro Backgrounds/Text Animations 区块

### ✅ 克制、适合企业工作台（细线、白底、轻阴影、小圆角）——推荐借鉴
- **Stateful Button**：三态按钮交互（改 4px 圆角）
- **Bento Grid**：栅格密度与卡片基础形（`border + bg-white + p-4`，去掉 hover:shadow-xl）
- **Cards Sections Free / blocks/cards**：卡片排版结构
- **Signup Form**：基于 shadcn 的表单结构
- **Multi Step Loader**：步骤点亮交互（改直角 + 紫色完成态）
- **Loader**：极简加载器（挑单色款式）
- **Timeline**：sticky 标题 + 纵向时间线结构
- **Images Badge**：头像堆叠 + hover 展开交互
- **Empty States（Pro）**：空态排版范式（图标+文案+主按钮）
- **blocks/stats-sections（Pro）**：数字统计排版结构
- **Sidebar / blocks/sidebars**：侧边栏展开折叠交互（改细线）

### ⚠️ 直接缺位、需自建（Aceternity 无对应组件）
Toast / Toaster、Table、Dropdown Menu、Popover、Skeleton、Progress / Stepper、标准 Badge、标准 Textarea、标准 Input/Button 基础件 —— 基础组件层由 shadcn/ui 体系或项目自有组件承担，Aceternity 不提供。

---

## 五、给团队的一句话落地建议

1. **基础组件层别用 Aceternity**——它没有；本项目现有 Button/Input/Card/Modal/Toast/Table/Badge/Tabs/Accordion/Popover/StageStepper 维持 Quiet Signal 实现即可。
2. **只借「结构 + 交互」**：优先吸收 Stateful Button、Bento Grid 密度、Multi Step Loader、Images Badge、Empty States、Timeline 六类；视觉一律转换为细线 + 白底 + 4px 圆角 + 稀疏紫色 + 无阴影。
3. **明确禁用名单**：所有光晕/渐变/玻璃/胶囊/3D/滚动炫技组件不进工作台，最多用于对外营销落地页（若有）。
