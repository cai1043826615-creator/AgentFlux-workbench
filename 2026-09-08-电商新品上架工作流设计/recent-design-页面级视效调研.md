# Recent Design（category=agency）UI/UX 调研报告

> 调研目标：为「电商多 Agent 工作台 Web 应用」（React + Tailwind v4，Quiet Signal 克制风格：近白表面+黑灰主色+稀疏紫色焦点+大结构直角+小控件4px圆角+默认无阴影+禁用玻璃拟态/渐变光晕）寻找**页面级视效/布局/动效**灵感。
> 调研日期：2026-09-09。方法：真实浏览器访问 + 站点公开 API（api.recent.design/rpc/items/list）批量取案例描述与风格标签 + 视觉桥（modlens）核验关键截图。

---

## 1. 该站展示了哪些类型的网站设计

**Recent Design**（https://recent.design/）是一个每日精选的「网页设计灵感」聚合站。入口结构：

- **Browse 板块**：Design（首页）、Websites（网页站）、OG Images（社交分享图）、App Screenshots（应用商店截图）、App Icons（应用图标）
- **Resources 板块**：Tools / Skills / Jobs
- 每个案例 = 全页截图或录制 + 一句话描述 + 风格标签（Style / Color / Type / Framework）+ 数据（impressions / opens / outbounds）

**Websites 分类清单**（站点顶部 filter）：`All / AI / Agency / Portfolio / SaaS / Ecommerce / Startup / Product / Technology / Finance / Food & Drink / Music / Art / Photography / Architecture / Health / Education / Entertainment / Web3 / Crypto / Editorial / Personal`。

**category=agency 实际内容**（本次抓取到 21 例，均为创意工作室/代理公司官网作品集类）：
Displace、Podium、dirt、Area Technology、Ragged Edge、UNVEIL、Bigpicture Company、reboot、Spring/Summer、Fora、Atlason、Unknown Untitled、PORTO ROCHA、TWOMUCH、ARTWORLD、Little Troop、ALT STUDIOS、OPX Studio、MAD、NewTab、Studio Lathe。

> **关键判断**：`category=agency` 本质是**「创意工作室作品集」站群**，几乎都不是 dashboard / 数据产品页。真正与「企业工作台 / 数据密集页面」气质接近的，是其中**克制、高密度、排版驱动**的那几个（Studio Lathe、PORTO ROCHA、Area Technology、reboot），以及其它分类（SaaS / Product）里更贴近数据产品页的站（Interfere、X Advertising）。下文第 2 节按此给出，并明确标注来源分类。

---

## 2. 挑选的 3-6 个「企业工作台 / dashboard / 数据密集」气质案例

### 来自 category=agency（主挑，4 个）

**① Studio Lathe — 高密度排版型列表页** ⭐最贴近
- 案例页：https://studiolathe.com/ ｜ Recent 收录页：https://recent.design/i/vjmnjxu-studio-lathe
- 官方描述：以「干净的排版式客户列表 + 小型 pill 服务标签」呈现作品集，米白底、极简。
- 实测：`#F6F4F2` 米白底 + 纯黑字 + 系统字体；全站即一份约 20 行的项目索引（无 hero 大图）。

**② PORTO ROCHA — 编辑感数据流索引页**
- 案例页：https://www.portorocha.com/ ｜ Recent 收录页：https://recent.design/i/t2nnldv-porto-rocha
- 官方描述：实时时间戳 + 可滚动项目索引，外加户外海报大图，编辑新闻室感。
- 实测：白底黑字（sf-pro-text）；首屏顶部含**实时时钟**（`Wednesday, September 9 / London, 10:37:42`）+「Show all projects / Show Less」折叠控件；正文为左列高密度索引（每个项目 H2 + 一行描述，约每 106px 一条）+ 右侧大图；后接带日期的 Updates 新闻流。

**③ Area Technology — 极简首屏**
- 案例页：https://www.area.tech/ ｜ Recent 收录页：https://recent.design/i/22utv8y-area-technology
- 实测：纯白底黑字，首屏 = 巨号 SVG 标识 + 一行小字「DESIGN STUDIO FOR ADVANCED VISUAL TECHNOLOGY」+ 两个链接（PROJECTS / INFORMATION）。零装饰、零阴影。

**④ reboot — 面向软件初创的克制营销页**
- 案例页：https://reboot.studio/ ｜ Recent 收录页：https://recent.design/i/xd0so2n-reboot
- 官方描述：为软件初创做营销站的巴塞罗那工作室，muted/minimal/clean。
- 实测：浅色白底、Inter 字体；首屏 = 顶部小字角标（Hiring · Web Designer）+ 大字主句 + 3 张产品截图；中段以逐句短文本叙事 + 团队人像 + 数据点（`8+ years`、`8 weeks`）；结尾单 CTA。

### 补充（非 agency 分类，但与本项目气质最贴的数据密集页面）

**⑤ Interfere — 数据密集产品页（最强工作台参照）** ⭐⭐
- 案例页：https://interfere.com/（SaaS 分类收录）｜ Recent 收录页：https://recent.design/i/mysyrbt-interfere
- 为什么最贴：它做的是「App 问题发现与分诊」产品（issue 分诊 = 电商多 Agent 的任务分诊同构），页面直接内嵌**真实产品 UI**（issue 卡片、带行号代码 diff、时间线）。

**⑥ X Advertising — 电商广告数据页**
- 案例页：https://business.x.com/en/advertising（SaaS 分类收录）
- 为什么贴：电商广告平台 = 本项目的「电商」场景参照；结构含统计卡、编号步骤（01-04）、编号广告格式卡（01-07，含 Collection+shoppable、Dynamic product ads 等电商格式）。

### 访问受限/不可用，如实说明
- **Unknown, Untitled**（https://unknown-untitled.com/en，agency 分类收录 https://recent.design/i/k040nyq-unknown-untitled）：实测域名已跳转到 **GoDaddy 域名停放页**（失效），无法看到真实站点；仅能依据官方描述「spare typographic homepage」（Facebook / Rimowa / Logitech 作品，B&W/Typographic/Minimal）。如需采用须先确认其是否还活着。
- **Mixpanel**（https://mixpanel.com/，SaaS 分类收录）：实测**连接被关闭**（`ERR_CONNECTION_CLOSED`，两次），无法访问。不采用。

---

## 3. 可借鉴的**页面级视效**（每条标注来源 URL）

### 3.1 首屏布局结构
- **极简首屏「一行字 + 两个链接」**：Area Technology 把首屏做到只剩标识、一句定位语、两个导航链接，空白本身即是设计（来源：https://www.area.tech/）。
- **「主句 + 产品截图 + 角标」式首屏**：reboot 用一行大字主句 + 3 张产品截图 + 顶部小字 Hiring 角标，首屏信息量小但指向明确（来源：https://reboot.studio/）。
- **「H1(56px/字重500) + 副句 + 双 CTA + 信任 logo 跑马灯」**：Interfere 首屏克制：标题不压黑、用中等字重，情绪靠留白而非重色（来源：https://interfere.com/）。
- **「H1 + 数据 chip + 副句 + 双 CTA」**：X Advertising 首屏把「10x ROAS」「$500 广告额度」做成小 chip 直接钉在标题旁，数据前置（来源：https://business.x.com/en/advertising）。

### 3.2 章节间距节奏（vertical rhythm）
- **大间距 + 发丝线分隔**：Interfere 用 Tailwind 级大间距（hero `py-36`，功能节 `py-24`，changelog `py-30`），节与节之间用 `border-b` 发丝线而非卡片/投影分隔——非常契合 Quiet Signal「无阴影、靠层级与留白」的主张（来源：https://interfere.com/）。
- **高度差参差的整页滚动节奏**：X Advertising 各 section 高度 607–1707px 不等，形成「短读+长读」交替的节奏，避免节奏单调（来源：https://business.x.com/en/advertising）。

### 3.3 标题排版（typography）
- **中等字重大标题（font-weight 500 / 48–56px）**：Interfere 的 H1 = 56px/500，X Ads 的 H1 = 48px/500——克制风格用「中等字重 + 大字号」而非「超粗字重」制造存在感（来源：https://interfere.com/、https://business.x.com/en/advertising）。
- **排版驱动（Typographic-first）**：Studio Lathe、PORTO ROCHA、Area Technology 均以文字编排为视觉主体，无插画无贴图，层级靠字号/字重/留白（来源：https://studiolathe.com/、https://www.portorocha.com/、https://www.area.tech/）。
- **编号引导型标题（01 / 02 / 03）**：Interfere 与 X Ads 都用「编号 + 短标题」组织大段内容，页面自带扫描路径（来源：https://interfere.com/、https://business.x.com/en/advertising）。

### 3.4 数据展示方式（stat 卡片 / 图表 / 列表）
- **排版式高密度列表 + pill 标签**：Studio Lathe 的客户列表每行 = 名称 + 大写服务标签 chip（DEVELOPMENT / DIGITAL / E-COMMERCE / IDENTITY）+ 右侧记号，是「任务/Agent/渠道列表」的直接范本（来源：https://studiolathe.com/）。
- **实时数据元素**：PORTO ROCHA 顶部实时时钟（日期+城市+秒）——工作台顶部放「当前时间/运行状态」的思路可借鉴（来源：https://www.portorocha.com/）。
- **真实 UI 内嵌作为数据展示**：Interfere 用「issue 卡片（#编号 + 标题 + Investigating 状态 + 优先级徽标）」「带行号的代码 diff」「时间线」直接当插图——比抽象图表更有信息密度、更像工作台（来源：https://interfere.com/）。
- **统计 chip 与 stat 卡带**：X Ads 的「0.0x / 0%」统计带 + 首屏数据 chip；PORTO ROCHA 的 Updates 日期流（12 March 2026…）——注意 X Ads 的数字是动效计数（真实渲染被掩码为 0.0x，实为跑数动画）（来源：https://business.x.com/en/advertising）。
- **「Show all / Show Less」渐进式展开**：PORTO ROCHA 的索引折叠控件，适合工作台列表的按需加载（来源：https://www.portorocha.com/）。

### 3.5 hover 与滚动动效
- **克制路线：无装饰、滚动即结构**：Studio Lathe / Area Technology 基本无花哨动效；PORTO ROCHA 用长滚动 + 折叠展开代替逐条动画。这正是 Quiet Signal 需要的「低动效」方向（来源：https://studiolathe.com/、https://www.area.tech/、https://www.portorocha.com/）。
- **编号步骤 + 逐步揭示**：X Ads 的 01-04 stepper 与 01-07 格式卡，适合「Agent 工作流编排」页面的分步引导（来源：https://business.x.com/en/advertising）。
- **信任 logo 跑马灯**：Interfere 首屏投资方 logo 横向滚动，属于可接受范围的轻动效（来源：https://interfere.com/）。
- 反面提醒：agency 分类里大量 GSAP ScrollTrigger / 3D / 自定义光标（如 Podium、Ragged Edge）——这些与本项目「默认无阴影、克制」的取向冲突，详见第 4 节。

### 3.6 导航与侧栏处理
- **极简顶栏（左 logo + 右链接/CTA）**：Interfere「logo + Product/Careers/Changelog/Blog/Docs/Contact + Login/Sign up」、Studio Lathe「logo+副标题 + Information」、reboot「角标 + 单 CTA」——都是无侧栏、靠顶栏承载导航（来源：https://interfere.com/、https://studiolathe.com/、https://reboot.studio/）。
- **左窄栏 + 主内容**：Recent Design 自身即「左 220px 固定导航栏 + 内容区」，是索引型/浏览型页面的标准布局参考（来源：https://recent.design/websites?category=agency）。
- **状态条**：Interfere 页脚有「● All systems operational」实时状态条，工作台顶栏/侧栏放运行状态是好习惯（来源：https://interfere.com/）。
- **主题切换**：X Ads 页脚提供 System/Light/Dark 三态切换（来源：https://business.x.com/en/advertising）。

---

## 4. 风格适合性判定

### ❌ 不适合本项目（过于华丽/艺术化/暗黑霓虹/3D/渐变）
均来自 category=agency 或对照组，以下为**反例清单**：

| 案例 | URL | 原因 |
|---|---|---|
| NewTab | https://www.newtab-studio.com/ | 亮粉底 + 超大字 + 倾斜错乱拼贴，故意「混沌」 |
| Displace | https://displace.agency/ | 暗色 Mac 桌面交互（apps/notes/terminal），暗色 + 游戏化 |
| Podium | https://podium.global/ | 黑白云动效 + 视频秀 + GSAP/Three.js，过于「动」 |
| dirt | https://dirtverse.co/ | 大字 + 3D 动画，先锋艺术向 |
| Ragged Edge | https://raggededge.com/ | 渐变 + 暗色 + Three.js + playful |
| TWOMUCH | https://www.twomuch.studio/ | 3D 翻滚物体 + 每次重排，玩味向 |
| Little Troop | https://littletroop.com/ | 鲜艳 + 3D 旋转几何形状 |
| MAD | https://mad.ac/ | 粉彩渐变 + playful 拼贴 |
| UNVEIL | https://unveil.fr/ | 鲜艳 + 自定义光标 + 对角线斜卡 |
| Spring/Summer | https://springsummer.dk/ | 红/奶油时装编辑向 |
| Fora | https://www.fora-concept.com/ | 衬线编辑向（大字衬线） |
| ARTWORLD | https://artworld.agency/ | 衬线 + 大字编辑向 |
| Bigpicture Company | https://www.bpco.kr/ | 超大字 + 跑马灯 + 编辑摄影 |
| Spring/Summer 等其余 | — | 普遍是「作品集美学」而非「工具美学」 |

> 共性：**高频动效、3D、渐变、亮色、自定义光标、超大装饰性字体、编辑/艺术向排版**——与本项目「近白表面+黑灰主色+稀疏紫色焦点+默认无阴影+禁渐变光晕」的 Quiet Signal 取向直接冲突。

### ✅ 可借鉴（克制、信息密度高、层级清晰）

| 案例 | URL | 借鉴点 |
|---|---|---|
| **Studio Lathe** ⭐ | https://studiolathe.com/ | 米白底高密度排版列表 + pill 标签 + 系统字体 = 列表视图与 tag chip 的教科书 |
| **Interfere** ⭐⭐ | https://interfere.com/ | 数据密集产品页：编号节、真实 UI 内嵌、发丝线分隔、大留白、状态条、changelog 日期流——工作台页面骨架的最佳参照 |
| **PORTO ROCHA** | https://www.portorocha.com/ | 实时数据元素 + 折叠式高密度索引 + 日期流 + 分栏布局 |
| **X Advertising** | https://business.x.com/en/advertising | 电商场景：统计 chip + 编号步骤 + 编号格式卡 + FAQ 手风琴 + 主题切换 |
| **Area Technology** | https://www.area.tech/ | 极简首屏（标识+一句+两链接），纯白无装饰 |
| **reboot** | https://reboot.studio/ | 克制叙事 + 单数据点 + 产品截图嵌入，浅色 Inter 排版 |

---

## 5. 结论与落地提示（供设计/实现参考）

1. **页面骨架走「Interfere 型」**：极简顶栏 → H1(中等字重 48–56px) → 编号分节 → 真实功能模块（任务/Agent/渠道列表）内嵌 → 状态条/日志流 → 页脚。分隔用发丝线与大留白，**不加投影、不加渐变**。
2. **列表走「Studio Lathe 型」**：高密度排版列表 + 大写/小写 pill 标签 + 右对齐元信息；电商 Agent 列表、任务列表、渠道列表直接套用该密度与层级。
3. **数据走「实时 + 卡片」**：顶部/侧栏放实时状态（借鉴 PORTO ROCHA 时钟 + Interfere 状态条）；关键指标用 chip/stat 卡（借鉴 X Ads），复杂数据用真实 UI 缩略（借鉴 Interfere 的 issue 卡/代码 diff）而非抽象图表。
4. **动效底线**：只用轻量「编号逐步揭示、折叠展开、状态闪烁、logo 跑马灯」；明确**不采用** agency 榜单里常见的 GSAP 视差/3D/自定义光标/大字动画。
5. **导航**：无侧栏或 220px 左右窄栏；电商 Agent 工作台若需侧栏，参照 Recent Design 自己的「左窄栏 + 内容区」模式。
6. **已失效链接**：Unknown, Untitled（域名停放）、Mixpanel（连接失败）——不可作为依据。

### 附：数据来源与访问状态
- 可访问并已实测（DOM/配色/结构）：recent.design（列表+API）、studiolathe.com、portorocha.com、area.tech、reboot.studio、interfere.com、business.x.com/en/advertising、podium.global、littletroop.com
- 视觉桥（modlens）核验截图：Studio Lathe（米白底三列索引确认）、PORTO ROCHA（左密列+右大图+时钟确认）、NewTab（亮粉混乱确认）
- 仅依据 Recent Design 官方描述/标签（未逐一实访）：Displace、dirt、Ragged Edge、UNVEIL、Bigpicture、Spring/Summer、Fora、Atlason、TWOMUCH、ARTWORLD、ALT STUDIOS、OPX、MAD
- 不可访问：unknown-untitled.com（GoDaddy 停放页）、mixpanel.com（连接被关闭）
