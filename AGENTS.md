# AGENTS.md — multi-agent-ecom-workbench

> 本文件是 AI 编码代理的项目级说明书，每轮自动加载。**只放"下一轮可能被违反"的硬约束**。
> 历史事故复盘见 `docs/开发文档/开发注意事项.md`（档案，非规则）；UI 设计细节见 `docs/规范/01_UI设计与组件规范_0908.md`（权威）。
> 全局行为准则见 `~/.dsh/AGENTS.md`（本文件与之冲突时，**本文件优先**）。

---

## 一、安全红线（最高优先级）

1. **UI 上填写的 API Key 绝不能进 GitHub**，无论填在哪个界面（Agent 设置 / 渠道配置等）。
   - 真实密钥一律只写 `backend/.env.local`（已 gitignore）。
   - 提交前由 `.git/hooks/pre-commit` → `backend/scripts/check-secrets.mjs` 强制扫描，命中即 exit 1。
   - `git add -A` 前肉眼核对 `git status --ignored`。
   - ⚠️ **钩子只装在本机 `.git/hooks`（不入库），换机需重装**；脚本已入库可分发。

## 二、UI 设计硬约束（对应用户痛点：UI 设计不规范）

> ### ⛔ 强制前置检查（不可跳过）
>
> **你要新建或修改任何 `.tsx` / `.css` 文件了吗？**
> 如果是 → 在写第一行 UI 代码前，**必须先做这两件事**：
>
> 1. **读本节的《规范摘要卡》**（就在下面，已内嵌，无需跳转）
> 2. **写完代码后运行**：`node frontend/scripts/check-ui-rules.mjs`
>    （提交时 pre-commit 会自动跑；**被拦截时按提示改，不要用 `--no-verify` 绕过**）
>
> 若需**完整 token 表 / 组件清单 / 视效规划**，再读 `docs/规范/01_UI设计与组件规范_0908.md`。
> **不读那个文件不算违规；但本节的摘要卡与校验脚本是强制的。**

### 📋 规范摘要卡（直接可用，无需跳转）

**颜色令牌**（写在 `frontend/src/index.css` 的 `@theme`，只能用这些）：

| 用途 | 令牌 | 值 |
|---|---|---|
| 页面底 / 卡片 | `--color-canvas` / `--color-surface` | `#fafafa` / `#ffffff` |
| 内收区 | `--color-sunken` | `#f4f4f5` |
| 文字三级 | `--color-ink` / `--color-ink-soft` / `--color-ink-faint` | `#0a0a0a` / `#52525b` / `#a1a1aa` |
| 描边两级 | `--color-line` / `--color-line-strong` | `#ececee` / `#dcdce0` |
| **主色（紫，稀疏用）** | `--color-signal` / `--color-signal-strong` / `--color-signal-soft` | `#7c3aed` / `#6d28d9` / `#f3effe` |
| 状态 | `--color-ok` / `--color-warn` / `--color-danger` | `#15803d` / `#b45309` / `#b91c1c` |
| 状态浅底 | `--color-ok-soft` / `--color-warn-soft` / `--color-danger-soft` | `#ecfdf3` / `#fff8e6` / `#fef2f2` |

**其他令牌**：

| 类别 | 可用值 |
|---|---|
| 圆角 | **只有两档**：`0`（大结构，`.qs-card` 直角）｜`4px`（小控件）。`pill` 999px 仅限极短状态标签 |
| 间距 | `var(--space-1..6)` = 4 / 8 / 12 / 16 / 20 / 24 px |
| 字体 | `--font-display`（Noto Serif SC，标题）｜`--font-body`（Noto Sans SC，正文）｜`--font-mono`（JetBrains Mono，元信息） |
| 动效 | 时长 `--dur-fast` 160ms / `--dur-standard` 220ms / `--dur-deliberate` 300ms；曲线 `--ease-standard` |
| 阴影 | **默认无**。仅真实抬升浮层（Toast / Modal / 下拉）允许 |

**写法示例**：

```tsx
// ✅ 正确
<div className="rounded-[4px] p-4"
     style={{ background: 'var(--color-surface)', color: 'var(--color-ink)', border: '1px solid var(--color-line)' }} />

// ❌ 错误（会被校验脚本拦截）
<div className="rounded-[3px]" style={{ background: '#fff', color: '#7C3AED', padding: '6px' }} />
```

#### 规则条列

1. **禁止硬编码颜色**。只用上表 `var(--color-*)`。
   - ❌ 禁止 `#7C3AED`、`rgba(0,0,0,0.04)` 这类裸值写进组件（`index.css` 令牌定义处除外）。
2. **禁止非法圆角**：只允许 `0` 与 `4px`。禁止 `rounded-[3px]` / `[6px]` / `[8px]` 等中间值。
3. **间距只用 4 的倍数**，优先引用 `var(--space-1..6)`。
4. **动效必须含 `prefers-reduced-motion` 降级**。
5. **风格禁止项**：不做玻璃拟态 / 渐变光晕 / 层层圆角 / 卡片墙 / 胶囊泛滥 / 装饰性 3D / 无意义循环动效。**紫色仅作焦点与关键状态，稀疏使用**。
6. **新功能优先复用既有浏览/阅读体系**，不要造重复 UI（历史打回：「为什么不能直接用现有的阅读卡片看」）。产出应进既有目录结构，点开走既有阅读卡片。
7. **改一致性类问题时，改完必须全局 grep 复查**（历史漏改「未连接」分支第 4 处）。

> **例外机制**：确需突破上述规则时，在该行加注释 `ui-rules-ignore` **并写明理由**，否则校验脚本会拦截。

## 三、架构铁律

10. **知识库与多 Agent 工作流是平行独立板块**，互不阻塞、互不影响。
    - 唯一耦合点 = 任务关联资料（新建任务时从知识库勾选，板块 A 对板块 B **只读消费**）。
    - 知识库未配置/异常 → 工作流照常；知识库独立表，不触碰工作流状态机。
11. **代码不得持续拥有运行期配置**。任何「按代码里的权威表覆盖用户配置」的启动迁移，**必须写成一次性迁移并在 `settings` 写标记**。
    - 反例：`repairBuiltinAgentMounts` 曾挂在 `ensureSchema()` 里每次启动覆盖用户挂载 → 用户改完重启就被打回。
    - 代码仍持续拥有的**只有两样**：内置 Agent 显示名、内置工作流阶段定义。其余（persona/model/skills/files/挂载）全归用户。
12. **分份挂载语义：空数组是有效值**（表示"这条工作流不挂"），**不会被全局兜底顶掉**；回退只在**键不存在**时发生。
    - 改 `buildSystemPrompt` 的 `if (part) return part;` 时务必保住该语义。
13. **挂载按「工作流 × Agent」分份存储**，不是全局挂载+过滤（分类过滤方案已被用户实测打回）。
14. **skill 与文件同层级同待遇**：配置弹窗各行独立「＋ 挂载」与 × 定向移除，不对称即被打回。
15. **系统工作流组件 ≠ 用户挂载素材**：如《小红书合规违禁词清单》是系统级流程组件，不该让用户去技能目录翻文件挂。
16. **渠道必须整组一致选择**：配了专属 key 就整套用它，否则整套用默认渠道。**严禁 baseUrl 与 apiKey 拆开拼**（曾致 401）。

## 四、工作纪律

17. **改对方向前先确认对象**：用户说"某卡和其他卡不一致"时，先澄清**改哪一个**再动手（历史：把三张卡全放大，实际是另一张对齐）。
18. **接口返回"已配置"类判定，一律用后端权威字段**（如 `channelConfigured`、`isAgentConfigured(agentId)`），不要在组件里自己 `baseUrl && apiKey` 算。
19. **接手任务前先核实**是否已被其他任务/会话做过（查 archive、README、主 spec），并看最近提交；**新 change 立项前**先 `openspec list --json` 并检查 `openspec/changes/archive/` 有无同 scope 已归档 change。
20. **多会话共享仓库**：只 `git add` 本任务文件，核对 `git status --short`；**不代推别人未完成的提交**；不擅自处理别人的工作区内容。文档被并行维护时，edit 报"file changed since it was read" → **先重读再改**。
21. **用户说"不做了"= 砍掉该项**，change 范围立即收窄，删掉对应 delta spec / proposal 条目，不留残留。
22. **用户报"不生效"类问题，先查上游**再改代码（历史：热点"不更新"实为上游源停更，修复方向是信息口径透明）。

## 五、环境与命令

23. **端口**：后端 `4311`，前端 dev `4310`。改代理端口必须与后端 `PORT` 对表（历史「全站离线」根因就是 `vite.config.ts` 代理指到空端口）。
24. **启动服务不要用并发 `pnpm dev`**：pnpm 每次 `run` 前会触发依赖检查 → 并发 install 互相踩（EBUSY/EEXIST）。
    - 推荐直接用本地 bin：后端 `cd backend && .\node_modules\.bin\tsx.cmd watch src/index.ts`；前端 `cd frontend && .\node_modules\.bin\vite.cmd`。
25. **验收基线**（提交前必须全绿）：
    - `pnpm --filter ./backend test` 通过；`pnpm typecheck` 0 error。
    - `node backend/scripts/check-secrets.mjs` 0 命中。
    - `openspec validate --specs` 全通过（过滤 pnpm WARN）。
26. **验收四层按序**：① 接口断言 → ② DOM 断言 → ③ 截图 → ④ **用户参与项放最后**。
27. **`git commit` 多行中文**：用 `git commit -F 临时文件`，不要 `-m "多行"`。

## 六、文档体系定位

| 路径 | 定位 | 何时读 |
|---|---|---|
| `AGENTS.md`（本文件） | **规则**，每轮自动加载 | 总是 |
| `docs/00_文档索引.md` | docs 目录地图 | 找文档时 |
| `docs/规范/` | **规范权威**：UI 设计与组件规范、工作流阶段定义 | 动 UI / 改阶段前 |
| `docs/设计/` | 设计决策与方案 | 做设计变更前 |
| `docs/验收/` | 验收清单与核对单 | 验收时 |
| `docs/改动记录/` | 历轮修改意见落地记录 | 追溯改动时 |
| `docs/调研/` | 外部组件库/视效调研 | 选型时 |
| `docs/归档/` | **已失效文档，勿依据其实施**（见 `归档/00_归档说明.md`） | 仅历史追溯 |
| `docs/开发文档/开发注意事项.md` | **事故档案**（384 行历史复盘） | 排查同类问题时 |
| `docs/开发文档/开发日志记录.md` | 进展日志 | 了解上下文时 |
| `openspec/` | **需求权威**：21 capability spec | 改功能前 |

### 文档命名与维护规范

28. **新文档命名格式**：`序号_文件名_日期`（如 `01_UI设计与组件规范_0908.md`）。序号两位，日期 `MMDD`。
    - 归档文件追加失效后缀：`_已失效` / `_部分被取代`，使失效状态在文件列表中即可辨认。
    - 无序号的历史文件（`开发日志记录.md` 等）保持原名不动，避免破坏既有引用。
29. **改规则只改本文件**；事故复盘进 `开发注意事项.md`；不要把两者混写。
30. **文档失效 → 移入 `docs/归档/`** + 加失效后缀 + 在 `归档/00_归档说明.md` 登记失效时间与原因。**归档 ≠ 删除**，历史记录不追溯改写。
31. **移动文档后必须全局修正引用路径**（`grep -rn "旧路径"`）。改完再自查一遍：`grep` 旧路径应为 0 命中（`openspec/changes/archive/` 历史归档除外，那些是快照不改）。
