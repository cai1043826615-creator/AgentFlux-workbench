# 21st.dev UI 组件市场调研报告（为电商多 Agent 工作台选型）

> 调研对象：https://21st.dev/ ｜ 调研日期：2026-09-08 ｜ 方法：浏览器实访（firecrawl/read_page 200 OK）
> 技术栈背景：React + Tailwind CSS v4，Quiet Signal 规范（近白表面、黑灰主色、稀疏紫色焦点、大结构直角、小控件 4px 圆角、默认无阴影、禁玻璃拟态/渐变光晕）。

## 一、平台组织方式（实测）

21st.dev 定位「The living library of interfaces」——12,000+ 手工 React 组件，按 **Registry（注册表）模型**组织：

- **按类型（主入口）**：Marketing Blocks（Heroes 1152 / Backgrounds 365 / Navigation 477 / FAQs 191 / Stats 153…）与 UI Components（Buttons 2043 / Cards 1780 / Inputs 949 / Forms 1522 / Tables 313 / Toasts 79 / Dropdowns 506 / Accordions 234 / Tabs 239 / Progress 375 / Dashboards 400 / Sidebars 95 / Empty States 77 / Avatars 597 / Badges 605 / Steppers 124 / AI Chats 248…）。
- **按作者/库**：https://21st.dev/community/libraries 共 134 个库（shadcn/ui、Origin UI、Geist、Aceternity UI、Magic UI、Ant Design、AI Elements、Agent Elements…）。
- **URL 结构**：`21st.dev/@作者/components/组件名[/变体]`；分类页 `21st.dev/community/components/s/分类`；库页 `21st.dev/community/<slug>/library/<lib>`。
- **交付方式**：每个组件 = 交互预览 + TSX 源码 + 依赖 + License + shadcn CLI 安装命令（`npx shadcn@latest add <registry-url>`）。

## 二、登录与访问性

浏览全站免费无需登录（首页/分类/详情页均 200 OK）。仅复制、收藏、发布、买模板需账号。

## 三、核心组件清单与 URL（企业工作台适用）

| 组件 | 首选 URL | 备选 |
|---|---|---|
| Button | https://21st.dev/@shadcn/components/button | 分类（2043） |
| Input | https://21st.dev/@shadcn/components/input | https://21st.dev/@uiable/components/input-form |
| Textarea | https://21st.dev/@shadcn/components/textarea | — |
| Select | https://21st.dev/@shadcn/components/select | chrono-select |
| Badge | https://21st.dev/community/components/s/badge（605） | badge-delta/solid |
| Card | https://21st.dev/@ShadcnStudio/components/card-studio/card-seven | preetsuthar17/card |
| Dialog | https://21st.dev/@efferd/components/dialog | modal（328） |
| Toast | https://21st.dev/community/components/s/toast（79）＋ Sonner | — |
| Stepper | https://21st.dev/community/components/s/steps（124） | onboarding（53） |
| Progress | https://21st.dev/@sean0205/components/progress | 分类（375） |
| Tabs | https://21st.dev/@sean0205/components/tabs | 分类（239） |
| Empty State | https://21st.dev/community/components/s/empty-state（77） | — |
| Avatar | https://21st.dev/@originui/components/avatar/with-badge | avatar-online |
| Table | https://21st.dev/@shadcn/components/table | originui tanstack 分页表 |
| Accordion | https://21st.dev/@shadcn/components/accordion | accordion-six |
| Dropdown | https://21st.dev/community/components/s/dropdown（506） | command |
| Sidebar | https://21st.dev/community/components/s/sidebar（95） | — |
| Dashboard | https://21st.dev/community/components/s/dashboard（400） | Circle（Linear 风格） |
| AI Chat | https://21st.dev/community/components/s/ai-chat（248） | AIcss 库 |

## 四、适配评估（克制型企业工作台）

- **✅ 直接可用（调参后）**：Button（radius→4px、主 CTA 用紫）、Input/Textarea/Select（天然近白）、Badge（浅底细边+色点）、Progress（默认即克制）、Tabs（下划线式）、Avatar（4px 状态点）、Sidebar/Dashboard（工作台骨架首选）、Empty State、Accordion、Skeleton。
- **✅ 需调整**：Card（去 shadow-sm、直角 4-8px、层级靠边框+灰阶）、Dialog（遮罩 bg-black/50、直角）、Table（行 hover 降强度、表头 12-13px 灰字、行高 h-10）、Dropdown（弹出层轻阴影是唯一例外）。
- **⚠️ 需甄别**：AI Chat 类多偏绚（渐变/玻璃），只看交互结构（tool-call 折叠、thinking 收起）而自制视觉。
- **❌ 避开**：渐变按钮、彩虹边框、glass、shader、background-beams 类花哨组件。

## 五、落地建议

四步改造适配克制风格：① `--radius` 0.5rem → 大结构 4-8px；② 去默认阴影改边框+灰阶分层；③ 主色从近黑改为「稀疏紫色焦点」仅用于主 CTA/激活态/进度填充；④ 明确避开渐变/玻璃类组件。shadcn/ui（83 组件）与 Origin UI（企业向、tanstack 表格）为第一优先级参考。

> 注：视效参数（配色/圆角/阴影）基于 shadcn/ui 公开标准为推断；URL 与平台结构为实测。
