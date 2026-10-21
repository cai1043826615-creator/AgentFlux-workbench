/**
 * 沙盒拦截层（作品集「沙盒体验版」）
 *
 * 为什么在 fetch 层拦截，而不是改业务代码：
 *   前端全部后端调用收敛在 `src/lib/api.ts` 的 55 处 fetch + 少量组件内直连 fetch，
 *   只要在 React 渲染前劫持 `window.fetch` / `window.WebSocket`，业务代码一行都不用改，
 *   沙盒与真实模式的差异被完全关在这一个文件里。
 *
 * 三条硬约束：
 *   1. **绝不触达真实后端**——不匹配的 /api 请求返回 404 + 中文说明，绝不 fall through 到网络；
 *      非 /api 请求（页面、静态资源、图片）原样透传，否则整个应用加载不出来。
 *   2. **写操作在内存里真生效**——访客点「采纳 / 打回 / 新建任务 / 归档」都要看到界面变化，
 *      所以内存库里维护一份可变状态；但**不持久化**，刷新即回到初始演示数据。
 *   3. **降级绝对安全**——`isSandbox()` 为 false 时 `installSandbox()` 直接返回，
 *      连 fetch 引用都不碰，正常开发模式与生产行为完全一致。
 */

import { makeZip, type ZipEntry } from './zip.ts';
import {
  AGENTS,
  CHAT_MESSAGES,
  DELIVERABLES,
  EXECUTIONS,
  HOT_ATTENTION,
  HOT_PANEL,
  KNOWLEDGE_DIRS,
  KNOWLEDGE_STATS,
  STAGE_LABELS,
  TASK_EVENTS,
  TASKS,
  WORKFLOWS,
} from './demo-data.ts';

/* ==========================================================================
   一、开关判定
   ========================================================================== */

/**
 * 是否处于沙盒模式。
 * 两个入口（满足任一即开）：构建期 `VITE_SANDBOX=1`、运行期 URL 带 `?sandbox=1`。
 * 运行期入口是给「公开部署的作品集站点」用的：同一份产物，普通访客带参数进沙盒，
 * 开发者自己不带参数仍走真实后端。
 */
export function isSandbox(): boolean {
  try {
    if (import.meta.env?.VITE_SANDBOX === '1') return true;
  } catch {
    /* import.meta 在某些测试运行器下不可用：按非沙盒处理 */
  }
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('sandbox') === '1';
  } catch {
    return false;
  }
}

/* ==========================================================================
   二、内存演示库（写操作改这里，刷新即还原）
   ========================================================================== */

/** 深拷贝初始数据，避免写操作污染 demo-data 模块级常量（多次安装互不影响） */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

type AnyRec = Record<string, unknown>;

const now = () => new Date().toISOString();

/**
 * 时间归一化：demo-data 里的时间戳是写死的 2026-10 日期，直接上屏会显示成「几百天前」，
 * 访客第一眼就觉得是过期假数据。这里把「演示数据里的最晚时间」映射为**当前时间**，
 * 其余按原有先后顺序等距平移——既保留"谁先谁后"的真实叙事，又让界面显示「刚刚 / N 小时前」。
 * 为什么不改 demo-data：那份数据的文案与时间线是人写的，平移放在拦截层更安全、可回滚。
 */
const TIME_ANCHOR = '2026-10-17T03:00:00.000Z';
const TIME_SHIFT_MS = Date.parse(TIME_ANCHOR) - Date.now();

function shiftTime(v: unknown): unknown {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return new Date(t - TIME_SHIFT_MS).toISOString();
  }
  if (Array.isArray(v)) return v.map(shiftTime);
  if (v && typeof v === 'object') {
    const out: AnyRec = {};
    for (const [k, val] of Object.entries(v)) out[k] = shiftTime(val);
    return out;
  }
  return v;
}

/** 看板列 ↔ 阶段 的推进表：写操作让「确认/采纳」把任务真实往前推一格 */
const COLUMN_ORDER: Record<string, number> = { planned: 0, progress: 1, awaiting: 2, done: 3 };

/** 阶段 → 看板列（与后端状态机同源的简化映射，够沙盒演示用） */
function columnOfStage(stage: string): string {
  if (stage.startsWith('xhs-')) {
    if (stage === 'xhs-topic') return 'planned';
    if (stage === 'xhs-deliver') return 'done';
    if (stage === 'xhs-copy' || stage === 'xhs-cover') return 'progress';
    return 'awaiting';
  }
  if (stage === 'requirement') return 'planned';
  if (stage === 'deliver') return 'done';
  if (stage === 'review') return 'awaiting';
  return 'progress';
}

/** 内存状态：所有写操作只改这一份（时间戳统一平移到「现在」附近，见 shiftTime） */
const db = {
  tasks: shiftTime(clone(TASKS)) as AnyRec[],
  deliverables: shiftTime(clone(DELIVERABLES)) as Record<string, AnyRec[]>,
  events: shiftTime(clone(TASK_EVENTS)) as Record<string, AnyRec[]>,
  agents: clone(AGENTS) as AnyRec[],
  settings: {
    // 沙盒里渠道一律「已配置」：否则界面会显示「未连接」并禁用大部分操作，
    // 但演示中绝不发起真实请求（channelTest 由本文件直接伪造成功）。
    orchestrationMode: 'graph',
    llmChannels: {
      'agent-supervisor': { baseUrl: 'https://sandbox.invalid/v1', apiKey: 'sandbox-placeholder-key', model: 'gpt-6-luna' },
      'agent-copy': { baseUrl: 'https://sandbox.invalid/v1', apiKey: 'sandbox-placeholder-key', model: 'deepseek-flash' },
      'agent-assistant': { baseUrl: 'https://sandbox.invalid/v1', apiKey: 'sandbox-placeholder-key', model: 'deepseek-flash' },
      'agent-design': { baseUrl: 'https://sandbox.invalid/v1', apiKey: 'sandbox-placeholder-key', model: 'gpt-image-2.5-sunburst' },
    },
    imageChannel: { baseUrl: 'https://sandbox.invalid/v1', apiKey: 'sandbox-placeholder-key', model: 'gpt-image-2.5-sunburst' },
  } as AnyRec,
  chat: shiftTime(clone(CHAT_MESSAGES)) as AnyRec[],
  hotAttention: clone(HOT_ATTENTION.config) as AnyRec,
  kbRefs: {} as Record<string, AnyRec[]>,
  hotRefs: {} as Record<string, AnyRec[]>,
  /** 会话内新导入的知识库文档（上传/小红书拆解落在这里，刷新即消失） */
  kbImportedDocs: [] as AnyRec[],
  seq: 900000,
};

function nextId(): number {
  db.seq += 1;
  return db.seq;
}

/** 阶段推进：取该工作流阶段序列的下一格 */
function nextStage(workflowId: string, stage: string): string {
  const wf = WORKFLOWS.find((w) => w.id === workflowId);
  const keys = wf ? workflowStageKeys(wf.id) : [];
  const i = keys.indexOf(stage);
  if (i < 0) return stage;
  return keys[Math.min(i + 1, keys.length - 1)];
}

/** 工作流阶段序列（与 packages/shared/workflow.ts 的节点顺序一致；此处只需顺序，不引后端依赖） */
function workflowStageKeys(workflowId: string): string[] {
  return workflowId === 'xhs-note'
    ? ['xhs-topic', 'xhs-copy', 'xhs-cover', 'xhs-inner', 'xhs-review', 'xhs-deliver']
    : ['requirement', 'copy', 'main-image', 'detail-image', 'review', 'deliver'];
}

/** 任务 → 列表项（补齐 TaskListItem 的展示元字段，否则卡片会空白） */
function toListItem(t: AnyRec): AnyRec {
  const agent = db.agents.find((a) => a.id === t.ownerAgentId);
  const refs = db.kbRefs[String(t.id)] ?? [];
  const del = db.deliverables[String(t.id)] ?? [];
  const updatedAt = del.reduce<string>((acc, d) => {
    const at = String(d.updatedAt ?? '');
    return at > acc ? at : acc;
  }, String(t.createdAt ?? ''));
  return {
    ...t,
    ownerName: (agent?.name as string) ?? '未指派',
    stageLabel: STAGE_LABELS[t.stage as keyof typeof STAGE_LABELS] ?? String(t.stage),
    // platforms 数组是客户端筛选的真实数据源（applyTaskFilters 优先读它）
    platforms: t.platforms ?? String(t.platform ?? '').split(/[、,，]/).filter(Boolean),
    kbRefsTotal: refs.length,
    kbRefsInvalid: refs.filter((r) => r.valid === false).length,
    updatedAt,
  };
}

/** 任务详情里用的任务主体（保留 archived 布尔语义） */
function toTask(t: AnyRec): AnyRec {
  return { ...t, archived: t.archived === 1 || t.archived === true };
}

/** 追加一条活动日志（写操作后让时间线「长出新记录」，界面显得是活的） */
function pushEvent(taskId: number, type: string, actor: string, text: string): AnyRec {
  const key = String(taskId);
  const list = db.events[key] ?? (db.events[key] = []);
  const ev = { id: nextId(), taskId, type, actor, text, payload: { text }, createdAt: now(), at: now() };
  list.push(ev);
  return ev;
}

/** 事件广播（WS mock 用 setTimeout 异步推，避免与当前请求的响应乱序） */
const wsClients = new Set<(msg: unknown) => void>();

function broadcast(msg: unknown): void {
  for (const send of wsClients) {
    setTimeout(() => send(msg), 60);
  }
}

function broadcastTask(task: AnyRec): void {
  broadcast({ type: 'task:update', task: toTask(task) });
}

/**
 * Agent 字段归一化。
 *
 * demo-data 里的 Agent 用了 `status: 'busy'|'idle'` 与 `avatarColor`，而前后端契约
 * （packages/shared/types.ts）要的是 `onlineStatus: AgentOnlineStatus`，
 * 且 agentStatus.ts 的映射表按该字段直接取值——字段名不对会 `undefined.label` 直接崩掉整棵组件树。
 * 归一化放在拦截层：既不改 demo-data 的写法，也不动业务组件。
 */
const AGENT_STATUS = new Set(['online', 'busy', 'idle', 'unconfigured']);

/** demo-data 的 status → 契约 onlineStatus（缺省按资产已配置的待命态） */
function toAgent(a: AnyRec, channelConfigured = true): AnyRec {
  const raw = String(a.onlineStatus ?? a.status ?? 'idle');
  const onlineStatus = AGENT_STATUS.has(raw) ? raw : 'idle';
  return {
    id: a.id,
    name: a.name,
    role: a.role,
    // 人设与挂载：demo-data 未写，这里补上（少字段会让 Agent 设置弹窗一片空白）
    persona: a.persona ?? agentPersona(String(a.role ?? '')),
    model: a.model ?? '',
    skills: (a.skills as string[] | undefined) ?? [],
    files: (a.files as string[] | undefined) ?? [],
    workflowSkills: (a.workflowSkills as AnyRec | undefined) ?? {},
    workflowFiles: (a.workflowFiles as AnyRec | undefined) ?? {},
    onlineStatus,
    activity: a.activity ?? ACTIVITY[String(a.id)] ?? '',
    lastActiveAt: a.lastActiveAt ?? now(),
    channelConfigured,
  };
}

/** Agent 活动文案（demo-data 没有该字段，补上让工位卡第二行有内容） */
const ACTIVITY: Record<string, string> = {
  'agent-supervisor': '正在排产今日 6 个任务',
  'agent-copy': '正在写「冬日暖手宝开箱」文案',
  'agent-design': '正在生成手机壳主图 4/5',
  'agent-assistant': '正在整理热点进灵感库',
};

/** 角色默认人设（与内置 Agent 定位一致，仅供沙盒展示） */
function agentPersona(role: string): string {
  const map: Record<string, string> = {
    主管: '负责拆解需求、排产与派活，把关交付质量；产出前先对齐事实来源，不替用户做确认决策。',
    文案: '负责卖点文案与笔记撰写：先读产品资料再动笔，参数必须可溯源，禁用绝对化用语。',
    设计师: '负责主图与内页设计：按《电商主图规范》出图，每张图只讲一个卖点，图内文字不超过 12 字。',
    助理: '负责知识库整理与检索：只读接入 Vault，整理产出统一落到 知识库/灵感库/。',
  };
  return map[role] ?? '';
}

/**
 * 交付物归一化。
 *
 * demo-data 里 image 交付物的 content 写成了 `{ images: [{ id, url, label, status }] }`，
 * 而前后端契约（`ImageItem` + api.ts 的 `parseImages`）要求的是**裸数组**且字段名为 `name`/`kind`：
 *   - `parseImages()` 直接 `JSON.parse` 后当数组用 → 传对象会让调用处 `out.push(...list)` 抛
 *     「Spread syntax requires ...iterable」，整块内容交付视图直接崩掉；
 *   - 图片名走 `name`（还有排序函数按 name 对照工作流声明顺序），`label` 会让所有图片标题空白。
 * 归一化放在拦截层，是「沙盒适配真实契约」而不是「改业务代码迁就假数据」。
 */
function normalizeImageContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    // 兼容两种写法：{ images: [...] } 或已经是裸数组
    const arr = Array.isArray(parsed) ? parsed : ((parsed as AnyRec)?.images as AnyRec[] | undefined);
    if (!Array.isArray(arr)) return content;
    const norm = arr.map((img, i) => ({
      id: String(img.id ?? `img-${i + 1}`),
      // name 优先；没有就用 label（demo-data 的写法），再兜底序号
      name: String(img.name ?? img.label ?? `图 ${i + 1}`),
      // kind 是契约必填（main|sub|detail）；沙盒里按位置给一个合理值
      kind: String(img.kind ?? (i === 0 ? 'main' : 'sub')),
      url: String(img.url ?? ''),
      status: String(img.status ?? 'pending'),
      ...(img.note ? { note: String(img.note) } : {}),
      ...(img.error ? { error: String(img.error) } : {}),
      ...(img.attempts != null ? { attempts: Number(img.attempts) } : {}),
    }));
    return JSON.stringify(norm);
  } catch {
    return content;
  }
}

/** 取交付物 JSON 里的图片数组（不论裸数组还是 { images } 包装） */
function imagesOf(content: string): AnyRec[] {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (Array.isArray(parsed)) return parsed as AnyRec[];
    const inner = (parsed as AnyRec)?.images;
    return Array.isArray(inner) ? (inner as AnyRec[]) : [];
  } catch {
    return [];
  }
}

/**
 * 文案交付物归一化：把 demo-data 里**人写的中文文案**（纯文本/Markdown 风格）转成契约要求的
 * `CopyPackage` JSON（title / points / outline / keywords）。
 *
 * 为什么必须转：api.ts 的 `parseCopy()` 直接 `JSON.parse(deliverable.content)`，
 * 纯文本会解析失败返回 null，于是内容交付页显示「文案包尚未产出，请稍候…」——
 * 数据明明在，界面却说没有，作品集里最扎眼的就是这种自相矛盾。
 *
 * 转换规则（尽量保留原文案的全部信息量，不重写、不缩水）：
 *   - 第一行非空文本 → title（去掉【主标题】/【标题】这类标签）
 *   - 「【...】」小节 → outline（取第一个小节标题作为大纲描述）
 *   - 「1. / 2. / ✅ / · 」开头的行 → points（去掉序号标记）
 *   - 「#话题」→ keywords
 *   - 其余正文行 → 拼进 outline（保证长文案正文不丢）
 */
function normalizeCopyContent(content: string): string {
  const text = String(content ?? '');
  // 已经是合规 CopyPackage（有 title + points 数组）就直接放行
  try {
    const parsed = JSON.parse(text) as AnyRec;
    if (parsed && typeof parsed === 'object' && typeof parsed.title === 'string' && Array.isArray(parsed.points)) return text;
  } catch {
    /* 不是 JSON：继续按纯文本转换 */
  }

  const lines = text.split(/\r?\n/);
  const clean = (s: string) => s.replace(/^[【\[]|[】\]]$/g, '').trim();

  let title = '';
  const points: string[] = [];
  const outlineParts: string[] = [];
  const keywords: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // 话题标签：#桌面收纳 #理线器
    const tags = line.match(/#[^\s#]+/g);
    if (tags && tags.join('') === line.replace(/\s+/g, '')) {
      keywords.push(...tags.map((t) => t.slice(1)));
      continue;
    }

    // 【小标题】
    const section = /^【(.+?)】\s*(.*)$/.exec(line);
    if (section) {
      const head = section[1].trim();
      const rest = section[2].trim();
      if (!title && /标题|title/i.test(head)) {
        title = rest || head;
        continue;
      }
      outlineParts.push(rest ? `${head}：${rest}` : head);
      continue;
    }

    // 有序/符号列表项
    const bullet = /^(?:\d+[.、)]|[·•\-*]|✅|✔)\s*(.+)$/.exec(line);
    if (bullet) {
      points.push(clean(bullet[1]));
      continue;
    }

    if (!title) {
      title = clean(line);
      continue;
    }
    outlineParts.push(line);
  }

  // 兜底：标题没解析出来就用首行，points 为空时用大纲首句，避免结构残缺又变成"无产出"
  return JSON.stringify({
    title: title || lines.find((l) => l.trim())?.trim() || '未命名文案',
    points: points.length ? points : outlineParts.slice(0, 3),
    outline: outlineParts.join('\n'),
    keywords,
  });
}

/** 写回图片数组（统一写裸数组，与契约一致） */
function setImagesOf(target: AnyRec, images: AnyRec[]): void {
  target.content = JSON.stringify(images);
  target.updatedAt = now();
}

function toDeliverable(d: AnyRec, taskId: number): AnyRec {
  return {
    id: d.id,
    taskId: d.taskId ?? taskId,
    stage: d.stage,
    kind: d.kind,
    content:
      d.kind === 'image'
        ? normalizeImageContent(String(d.content))
        : d.kind === 'copy'
          ? normalizeCopyContent(String(d.content))
          : String(d.content),
    status: d.status,
    version: d.version,
    updatedAt: d.updatedAt ?? now(),
  };
}

/** 交付物列表输出（统一出口，保证每次返回都过一遍归一化） */
function deliverablesOf(taskId: string): AnyRec[] {
  return (db.deliverables[taskId] ?? []).map((d) => toDeliverable(d, Number(taskId)));
}

/**
 * 生成沙盒「交付包」ZIP（真实可解压）。
 *
 * 包结构（用户定案：**只要文案 + 图片清单**）：
 *   README.txt            —— 说明这是作品集演示包
 *   文案/<序号>-<阶段>.txt —— 正文类文案（卖点文案 / 选题方向 / 笔记文案）
 *   图片/清单.txt          —— 已采纳图片的名称 / 状态 / 路径清单
 *
 * 不含：主管校对报告、交付归档清单、溯源统计（这些是质检与审计数据，不属于交付内容）。
 *
 * 为什么图片只放清单、不放图片本体：
 *   拦截层是**同步**设计（`Response | null`），而取回图片字节需要异步 fetch；
 *   为一个演示功能把整层改成异步风险过大。清单同样说明了「交付包含哪些图」，
 *   访客也可在任务页面直接看到图；包体积小、一定能解压。
 */
function buildSandboxPackage(taskId: string): Response {
  const task = db.tasks.find((x) => String(x.id) === taskId);
  if (!task) return notFound(`/api/tasks/${taskId}/deliverable-package`);
  const list = db.deliverables[taskId] ?? [];
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [];

  entries.push({
    name: 'README.txt',
    data: enc.encode(
      [
        '多 Agent 电商工作台 · 沙盒演示交付包',
        `任务：#${task.id} ${task.title}`,
        `生成时间：${new Date().toISOString()}`,
        '',
        '说明：',
        '本文件由作品集沙盒生成，内容取自作品集的真实案例演示数据（非编造样例）。',
        '沙盒环境不连接真实后端、不调用 AI 接口，因此包内不含新生成的产物。',
        '',
      ].join('\n'),
    ),
  });

  // 文案交付物：只收**正文类文案**阶段（用户定案：交付包只要文案 + 图片清单）。
  // 排除项说明：
  //   · review   —— 主管校对报告（是质检结论，不是交付内容）
  //   · deliver  —— 交付归档清单（是打包索引，不是交付内容）
  //   · provenance —— 溯源统计（是审计数据）
  //   这些 stages 的条目在真实交付包里也不该作为「文案」出现。
  const COPY_STAGES = new Set(['copy', 'xhs-topic', 'xhs-copy']);
  let copyIndex = 0;
  for (const d of list) {
    if (d.kind !== 'copy') continue;
    if (!COPY_STAGES.has(String(d.stage))) continue;
    copyIndex += 1;
    const stageLabel = STAGE_LABELS[d.stage as keyof typeof STAGE_LABELS] ?? String(d.stage);
    const text = readableCopy(String(d.content));
    entries.push({
      name: `文案/${String(copyIndex).padStart(2, '0')}-${stageLabel}.txt`,
      data: enc.encode(`${stageLabel}（${d.status}，v${d.version}）\n\n${text}\n`),
    });
  }

  // 图片清单（沙盒包不含图片二进制，原因见函数头注释）
  const imageLines: string[] = ['图片清单（沙盒演示包不含图片本体，可在任务页面查看）', ''];
  let imageIndex = 0;
  for (const d of list) {
    if (d.kind !== 'image') continue;
    const stageLabel = STAGE_LABELS[d.stage as keyof typeof STAGE_LABELS] ?? String(d.stage);
    for (const img of imagesOf(normalizeImageContent(String(d.content)))) {
      imageIndex += 1;
      imageLines.push(
        `${String(imageIndex).padStart(2, '0')}. [${stageLabel}] ${String(img.name ?? '')} —— ${String(img.status ?? '')} —— ${String(img.url ?? '')}`,
      );
    }
  }
  imageLines.push('', `合计 ${imageIndex} 张`);
  entries.push({ name: '图片/清单.txt', data: enc.encode(imageLines.join('\n')) });

  const zip = makeZip(entries);
  const safeTitle = String(task.title).replace(/[\\/:*?"<>|\r\n\t]/g, '_').slice(0, 40);
  const filename = `交付包-任务${task.id}-${safeTitle}.zip`;
  // 用 Blob 包一层：Uint8Array 直接作为 BodyInit 在部分 TS lib 版本下类型不兼容，
  // 且 Blob 能让浏览器正确按二进制处理（避免被当文本）。
  const body = new Blob([zip as unknown as BlobPart], { type: 'application/zip' });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'X-Sandbox': '1',
    },
  });
}

/** 把文案类交付物的 JSON 转成人类可读文本（用于打进交付包） */
function readableCopy(content: string): string {
  try {
    const parsed = JSON.parse(content) as AnyRec;
    const lines: string[] = [];
    if (parsed.title) lines.push(`【标题】${String(parsed.title)}`);
    const points = parsed.points;
    if (Array.isArray(points) && points.length > 0) {
      lines.push('', '【要点】');
      for (const p of points) lines.push(`· ${String(p)}`);
    }
    if (parsed.outline) lines.push('', '【正文/大纲】', String(parsed.outline));
    if (Array.isArray(parsed.keywords) && parsed.keywords.length > 0) {
      lines.push('', `【关键词】${parsed.keywords.map(String).join(' / ')}`);
    }
    return lines.length > 0 ? lines.join('\n') : content;
  } catch {
    return content;
  }
}

/* ==========================================================================
   三、假响应工具
   ========================================================================== */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body ?? {}), {
    status,
    statusText: status === 200 ? 'OK' : 'Sandbox',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Sandbox': '1' },
  });
}

/** api.ts 的 j() 只会读 body.error；不匹配的 /api 一律 404 + 中文说明，绝不落到网络 */
function notFound(path: string): Response {
  return json({ error: `沙盒未覆盖该接口：${path}` }, 404);
}

function bodyOf(init?: RequestInit): AnyRec {
  const raw = init?.body;
  if (typeof raw !== 'string' || !raw) return {};
  try {
    return JSON.parse(raw) as AnyRec;
  } catch {
    return {};
  }
}

/* ==========================================================================
   四、知识库假数据（后端返回的形状见 packages/shared/src/knowledge.ts）
   ========================================================================== */

/** 演示 Vault 根目录：纯字符串，不指向任何真实磁盘路径 */
const VAULT_ROOT = 'D:\\作品集演示\\电商知识库Vault';

/** 知识库演示文档（内容按真实业务写，星图/阅读区/搜索/健康度全靠这一份） */
const vaultMarkdown = import.meta.glob('../../../docs/示例Vault/**/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const KB_DOCS = Object.entries(vaultMarkdown)
  .flatMap(([modulePath, content]) => {
    const normalized = modulePath.replaceAll('\\', '/');
    const marker = '/示例Vault/';
    const markerAt = normalized.indexOf(marker);
    if (markerAt < 0) return [];
    const path = normalized.slice(markerAt + marker.length);
    if (!path || path.startsWith('.obsidian/') || path.startsWith('归档/')) return [];
    const title = content.match(/^#\s+(.+?)\s*$/m)?.[1] ?? path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
    const tagLine = content.match(/^tags:\s*\[(.*?)\]\s*$/m)?.[1];
    const tags = tagLine
      ? tagLine.split(',').map((tag) => tag.trim().replace(/^['\"]|['\"]$/g, '')).filter(Boolean)
      : [path.split('/')[0] ?? '内容'];
    const links = [...content.matchAll(/\[\[([^\]#|]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map((match) => match[1].trim());
    const anchorTitles = [...content.matchAll(/^#{2,3}\s+(.+?)\s*$/gm)].map((match) => match[1]);
    return [{ path, title, tags, links, anchorTitles, content }];
  })
  .map((doc, _, docs) => ({
    ...doc,
    links: doc.links.map((target) => {
      const cleanTarget = target.replace(/\.md$/i, '');
      const match = docs.find((candidate) =>
        candidate.title === target ||
        candidate.path.replace(/\.md$/i, '') === cleanTarget ||
        candidate.path.split('/').pop()?.replace(/\.md$/i, '') === cleanTarget,
      );
      return match?.path ?? target;
    }),
  }));

function kbSummary(d: (typeof KB_DOCS)[number]): AnyRec {
  return {
    path: d.path,
    title: d.title,
    dir: d.path.split('/').slice(0, -1).join('/'),
    tags: d.tags,
    mtime: '2026-10-12T06:00:00.000Z',
    size: d.content.length,
  };
}

/** 会话内导入的文档也按同一形状返回 */
function allKbDocs(): AnyRec[] {
  return [...KB_DOCS.map(kbSummary), ...db.kbImportedDocs];
}

function kbStatsPayload(): AnyRec {
  const docs = allKbDocs();
  return {
    ...KNOWLEDGE_STATS,
    docCount: docs.length,
    tagCount: new Set(docs.flatMap((doc) => doc.tags as string[])).size,
    dirCount: new Set(docs.map((doc) => String(doc.dir))).size,
    edgeCount: KB_DOCS.reduce((count, doc) => count + doc.links.filter((path) => KB_DOCS.some((target) => target.path === path)).length, 0),
    recent: docs.slice(0, 5),
  };
}

function kbStatusPayload(): AnyRec {
  return {
    state: 'connected',
    root: VAULT_ROOT,
    source: 'settings',
    range: {
      includeDirs: [],
      excludeDirs: ['.git', '.obsidian', '.trash', 'node_modules', '.pnpm-store', 'dist', '.DS_Store'],
    },
    indexing: false,
    presets: { type: 'dir', products: '原始资料/产品资料', brand: '知识库/品牌规范' },
    presetEntries: [
      { id: 'products', label: '产品资料', dir: '原始资料/产品资料' },
      { id: 'brand', label: '品牌规范', dir: '知识库/品牌规范' },
    ],
  };
}

/** 知识星图：文档节点 + 标签节点 + 文档间链接边 + 文档-标签归属边 */
function kbGraphPayload(): AnyRec {
  const docs = allKbDocs();
  const tagNames = [...new Set(docs.flatMap((d) => d.tags as string[]))];
  const nodes: AnyRec[] = [];
  const edges: AnyRec[] = [];

  for (const d of docs) {
    const out = (KB_DOCS.find((x) => x.path === d.path)?.links ?? []).filter((p) => docs.some((x) => x.path === p));
    const tagDeg = (d.tags as string[]).length;
    nodes.push({
      id: `doc:${d.path}`,
      kind: 'doc',
      label: d.title,
      path: d.path,
      tags: d.tags,
      degree: out.length * 2 + tagDeg,
      isolated: out.length === 0 && tagDeg === 0,
    });
    for (const t of d.tags as string[]) edges.push({ source: `doc:${d.path}`, target: `tag:${t}`, kind: 'tag' });
    for (const p of out) edges.push({ source: `doc:${d.path}`, target: `doc:${p}`, kind: 'link' });
  }
  for (const t of tagNames) {
    const count = docs.filter((d) => (d.tags as string[]).includes(t)).length;
    nodes.push({ id: `tag:${t}`, kind: 'tag', label: t, path: null, tags: [t], degree: count });
  }
  return { nodes, edges };
}

/* ==========================================================================
   五、路由匹配（按路径 + 方法分发）
   ========================================================================== */

/** `:id` 占位符匹配 */
function match(pattern: string, path: string): AnyRec | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: AnyRec = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

/* ==========================================================================
   六、接口实现
   ========================================================================== */

function handleTasks(path: string, method: string, url: URL, init?: RequestInit): Response | null {
  let m = match('/api/tasks', path);
  if (m && method === 'GET') {
    const q = url.searchParams;
    const includeArchived = q.get('includeArchived') === '1';
    const platforms = q.getAll('platform');
    let list = db.tasks.filter((t) => includeArchived || !t.archived);
    if (platforms.length) list = list.filter((t) => platforms.some((p) => String(t.platform).includes(p)));
    const owner = q.get('owner');
    if (owner) list = list.filter((t) => t.ownerAgentId === owner);
    const kw = q.get('q')?.toLowerCase();
    if (kw) list = list.filter((t) => `${t.title}${t.description}`.toLowerCase().includes(kw));
    const items = list.map(toListItem);
    const sort = q.get('sort');
    const order = q.get('order') === 'asc' ? 1 : -1;
    if (sort === 'progress') items.sort((a, b) => (Number(a.progress) - Number(b.progress)) * order);
    else if (sort === 'createdAt') items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) * order);
    // 默认：电商工作流优先，其次按创建时间倒序（对齐后端顺序，避免首屏顺序跳变）
    else items.sort((a, b) => (a.workflowId === b.workflowId ? String(b.createdAt).localeCompare(String(a.createdAt)) : a.workflowId === 'ecom-new-listing' ? -1 : 1));
    return json({ tasks: items });
  }

  if (m && method === 'POST') {
    const body = bodyOf(init);
    const title = String(body.title ?? '').trim();
    const workflowId = String(body.workflowId ?? 'ecom-new-listing');
    const isXhs = workflowId === 'xhs-note';
    const platforms = Array.isArray(body.platforms) ? body.platforms.map(String) : [];
    const referenceImage = String(body.referenceImage ?? '');
    if (!title || !WORKFLOWS.some((workflow) => workflow.id === workflowId) || (!isXhs && (!platforms.length || !referenceImage))) {
      return json({ error: '任务信息不完整：请填写标题，并为电商任务选择平台与参考图。' }, 400);
    }
    const task: AnyRec = {
      id: nextId(),
      title,
      workflowId,
      stage: isXhs ? 'xhs-topic' : 'requirement',
      column: 'planned',
      ownerAgentId: 'agent-copy',
      description: String(body.description ?? ''),
      platform: (isXhs ? ['小红书'] : platforms).join('、'),
      platforms: isXhs ? ['小红书'] : platforms,
      referenceImage: referenceImage || undefined,
      brief: isXhs ? (body.brief ?? null) : null,
      progress: 0,
      stageNote: isXhs ? '选题策划 · 待开始' : '需求对接 · 待开始',
      archived: false,
      createdBy: '你',
      createdAt: now(),
    };
    db.tasks.unshift(task);
    pushEvent(Number(task.id), 'TASK_CREATED', '你', `创建任务「${title}」`);
    broadcastTask(task);
    return json({ task: toTask(task) });
  }

  m = match('/api/tasks/:id', path);
  if (m && method === 'GET') {
    const t = db.tasks.find((x) => String(x.id) === m!.id);
    return t ? json({ task: toTask(t) }) : notFound(path);
  }

  m = match('/api/tasks/:id/confirm', path);
  if (m && method === 'POST') {
    const t = db.tasks.find((x) => String(x.id) === m!.id);
    if (!t) return notFound(path);
    t.stage = nextStage(String(t.workflowId), String(t.stage));
    t.column = columnOfStage(String(t.stage));
    t.progress = Math.max(Number(t.progress), 25);
    t.stageNote = `${STAGE_LABELS[t.stage as keyof typeof STAGE_LABELS] ?? t.stage} · 已确认，进入下一阶段`;
    pushEvent(Number(t.id), 'TASK_CONFIRMED', '你', `确认需求，进入「${STAGE_LABELS[t.stage as keyof typeof STAGE_LABELS] ?? t.stage}」`);
    broadcastTask(t);
    return json({ task: toTask(t) });
  }

  m = match('/api/tasks/:id/archive', path);
  if (m && method === 'POST') {
    const t = db.tasks.find((x) => String(x.id) === m!.id);
    if (!t) return notFound(path);
    t.archived = 1;
    pushEvent(Number(t.id), 'STAGE_COMPLETED', '你', '已归档任务');
    broadcastTask(t);
    return json({ task: toTask(t) });
  }

  m = match('/api/tasks/:id/restore', path);
  if (m && method === 'POST') {
    const t = db.tasks.find((x) => String(x.id) === m!.id);
    if (!t) return notFound(path);
    t.archived = 0;
    pushEvent(Number(t.id), 'STAGE_STARTED', '你', '已从归档恢复回看板');
    broadcastTask(t);
    return json({ task: toTask(t) });
  }

  m = match('/api/tasks/:id/events', path);
  if (m && method === 'GET') {
    // 字段归一：导出数据里事件时间叫 `at`，而前端契约要求 `createdAt`——
    // 不映射的话活动日志的时间列会是空的（用户实测发现）。这里统一补齐两个字段。
    const list = (db.events[m.id as string] ?? []).map((ev) => ({
      ...ev,
      createdAt: String(ev.createdAt ?? ev.at ?? now()),
    }));
    return json({ events: list });
  }

  m = match('/api/tasks/:id/deliverables', path);
  if (m && method === 'GET') return json({ deliverables: deliverablesOf(m.id as string) });

  m = match('/api/tasks/:id/deliverables/decide', path);
  if (m && method === 'POST') {
    const key = m.id as string;
    const t = db.tasks.find((x) => String(x.id) === key);
    if (!t) return notFound(path);
    const body = bodyOf(init);
    const kind = body.kind as string;
    const decision = body.decision as string;
    const list = db.deliverables[key] ?? (db.deliverables[key] = []);
    const target = list.find((d) => d.kind === kind);
    const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'skipped';
    if (target) {
      target.status = status;
      target.version = Number(target.version) + 1;
      target.updatedAt = now();
      // 图片类交付物：统一按裸数组读写（先归一化，再改状态）
      if (kind === 'image') {
        let imgs = imagesOf(normalizeImageContent(String(target.content)));
        // 单张决策只动那一张；整组决策（未传 imageId）动全部
        imgs = imgs.map((img) => (body.imageId && img.id !== body.imageId ? img : { ...img, status }));
        setImagesOf(target, imgs);
      }
    }
    // 采纳图片后把仍处于「生成中/待确认」的图一并置为已采纳：演示「点了确实往前走了」
    if (target && kind === 'image' && (decision === 'approve' || decision === 'skip')) {
      setImagesOf(
        target,
        imagesOf(normalizeImageContent(String(target.content))).map((img) =>
          img.status === 'generating' || img.status === 'pending' ? { ...img, status: 'approved' } : img,
        ),
      );
    }
    if (decision === 'approve' || decision === 'skip') {
      // 【沙盒特例】采纳**不推进阶段**（真实环境会推进到下一阶段，由对应 Agent 继续产出）。
      // 为什么：沙盒没有真实的 AI 产出能力，一旦推进到「设计师作图」这类需要新交付物的阶段，
      // 界面就会永远显示「该板块图片尚未产出」卡住（用户实测踩到过）。
      // 因此这里只记录「你采纳了这个交付物」这一动作，任务停在当前阶段——体验完整且不会掉进空阶段。
      t.progress = Math.min(100, Number(t.progress) + 10);
      t.stageNote = `${STAGE_LABELS[t.stage as keyof typeof STAGE_LABELS] ?? t.stage} · 已采纳（演示模式不推进阶段）`;
      pushEvent(Number(t.id), 'DELIVERABLE_DECIDED', '你', `采纳${kind === 'copy' ? '文案' : '配图'}（v${target?.version ?? 1}）`);
    } else if (decision === 'reject') {
      // 打回：状态回退到当前阶段重做（保留版本号递增，便于「历史版本」面板有内容）
      t.column = 'progress';
      t.progress = Math.max(0, Number(t.progress) - 10);
      t.stageNote = `${STAGE_LABELS[t.stage as keyof typeof STAGE_LABELS] ?? t.stage} · 已打回返工中`;
      pushEvent(Number(t.id), 'REJECTED', '你', `打回${kind === 'copy' ? '文案' : '配图'}：${(body.note as string) || '未填写意见'}`);
    }
    broadcastTask(t);
    if (target) broadcast({ type: 'deliverable:update', deliverable: toDeliverable(target, Number(t.id)) });
    return json({ task: toTask(t), deliverables: deliverablesOf(key) });
  }

  m = match('/api/tasks/:id/deliverables/images/:imageId/retry', path);
  if (m && method === 'POST') {
    const key = m.id as string;
    const imageId = m.imageId as string;
    const list = db.deliverables[key] ?? (db.deliverables[key] = []);
    const target = list.find((d) => d.kind === 'image');
    let image: AnyRec = { id: imageId, name: imageId, kind: 'main', status: 'approved', url: '/sandbox/placeholder-main-5.svg', attempts: 1 };
    if (target) {
      // 先归一化再改：demo-data 的 { images: [...] } 包装会在这一步被摊平成契约要求的裸数组
      setImagesOf(
        target,
        imagesOf(normalizeImageContent(String(target.content))).map((img) =>
          img.id === imageId ? { ...img, status: 'generating', error: undefined, attempts: Number(img.attempts ?? 0) + 1 } : img,
        ),
      );
    }
    pushEvent(Number(key), 'STAGE_STARTED', '平平', `重试生成图片 ${imageId}`);
    // 延迟「生成完成」：让访客看到 generating → approved 的过程
    setTimeout(() => {
      if (!target) return;
      setImagesOf(
        target,
        imagesOf(normalizeImageContent(String(target.content))).map((img) => (img.id === imageId ? { ...img, status: 'approved' } : img)),
      );
      image = { id: imageId, name: imageId, kind: 'main', status: 'approved', url: '/sandbox/placeholder-main-5.svg', attempts: 1 };
      broadcast({ type: 'deliverable:update', deliverable: toDeliverable(target, Number(key)) });
      pushEvent(Number(key), 'STAGE_COMPLETED', '平平', `图片 ${imageId} 已重新生成完成`);
    }, 2200);
    return json({ deliverable: target ? toDeliverable(target, Number(key)) : null, image, deliverables: deliverablesOf(key) });
  }

  m = match('/api/tasks/:id/review', path);
  if (m && method === 'POST') {
    const t = db.tasks.find((x) => String(x.id) === m!.id);
    if (!t) return notFound(path);
    const body = bodyOf(init);
    if (body.decision === 'rollback') {
      const targetStage = (body.targetStage as string) ?? 'copy';
      t.stage = targetStage;
      t.column = 'progress';
      t.stageNote = `${STAGE_LABELS[targetStage as keyof typeof STAGE_LABELS] ?? targetStage} · 主管回退返工中`;
      pushEvent(Number(t.id), 'REVIEW_ROLLBACK', '波波', `校对回退：${(body.note as string) || '未填写意见'}`);
    } else {
      t.stage = nextStage(String(t.workflowId), String(t.stage));
      t.column = columnOfStage(String(t.stage));
      t.progress = Math.min(100, Number(t.progress) + 15);
      t.stageNote = '主管校对通过 · 交付完成';
      pushEvent(Number(t.id), 'REVIEW_PASSED', '波波', '主管校对通过，交付归档');
    }
    broadcastTask(t);
    return json({ task: toTask(t) });
  }

  m = match('/api/tasks/:id/kb-refs', path);
  if (m) {
    const key = m.id as string;
    if (method === 'GET') return json({ refs: db.kbRefs[key] ?? [] });
    if (method === 'PUT') {
      const body = bodyOf(init);
      const refs = ((body.refs as AnyRec[] | undefined) ?? []).map((r) => ({
        id: nextId(),
        taskId: Number(key),
        docPath: r.docPath,
        title: allKbDocs().find((d) => d.path === r.docPath)?.title ?? String(r.docPath),
        anchor: r.anchor ?? null,
        note: r.note,
        createdAt: now(),
        valid: true,
      }));
      db.kbRefs[key] = refs;
      pushEvent(Number(key), 'STAGE_STARTED', '你', `更新关联资料（${refs.length} 份）`);
      return json({ refs });
    }
  }

  m = match('/api/tasks/:id/hot-refs', path);
  if (m) {
    const key = m.id as string;
    if (method === 'GET') return json({ refs: db.hotRefs[key] ?? [] });
    if (method === 'PUT') {
      const body = bodyOf(init);
      const refs = ((body.refs as AnyRec[] | undefined) ?? []).map((r) => ({
        ...r,
        id: nextId(),
        taskId: Number(key),
        createdAt: now(),
        valid: true,
      }));
      db.hotRefs[key] = refs;
      return json({ refs });
    }
  }

  m = match('/api/tasks/:id/provenance', path);
  if (m && method === 'GET') {
    const key = m.id as string;
    const task = db.tasks.find((x) => String(x.id) === key);
    const refs = db.kbRefs[key] ?? [];
    const copy = (db.deliverables[key] ?? []).find((d) => d.kind === 'copy');
    if (!task || !copy || refs.length === 0) return json({ provenance: null });
    const facts = [
      { id: 'f1', type: 'number-unit', text: '10000mAh', field: 'title', index: -1, traced: true, sources: ['磁吸充电宝'], coverage: null, normalized: '10000 mah' },
      { id: 'f2', type: 'number-unit', text: '22.5W', field: 'points', index: 0, traced: true, sources: ['磁吸充电宝'], coverage: null, normalized: '22.5 w' },
      { id: 'f3', type: 'number-unit', text: '198g', field: 'points', index: 1, traced: true, sources: ['磁吸充电宝'], coverage: null, normalized: '198 g' },
      { id: 'f4', type: 'textual', text: '磁吸即充', field: 'points', index: 2, traced: true, sources: ['磁吸理线器'], coverage: 0.82, normalized: '磁吸即充' },
      { id: 'f5', type: 'number-unit', text: '15 分钟', field: 'outline', index: -1, traced: false, sources: [], coverage: null, normalized: '15 分钟' },
    ];
    const tracedCount = facts.filter((f) => f.traced).length;
    return json({
      provenance: {
        percent: Math.round((tracedCount / facts.length) * 100),
        tracedCount,
        untracedCount: facts.length - tracedCount,
        totalCount: facts.length,
        noFacts: false,
        hasRefs: true,
        refCount: refs.length,
        facts,
        refsMeta: refs.map((r) => ({ title: String(r.title), mtime: '2026-10-12T06:00:00.000Z', hash: 'sandbox' })),
        generatedAt: now(),
      },
    });
  }

  m = match('/api/tasks/:id/rework', path);
  if (m && method === 'GET') {
    const records = (db.events[m.id as string] ?? [])
      .filter((e) => e.type === 'REJECTED' || e.type === 'REVIEW_ROLLBACK')
      .map((e) => ({ stage: String((e.payload as AnyRec)?.stage ?? 'copy'), note: String(e.text ?? '').replace(/^打回[^：]*：/, ''), at: String(e.createdAt) }));
    return json({ rework: { count: records.length, records } });
  }

  m = match('/api/tasks/:id/deliverables/:kind/versions', path);
  if (m && method === 'GET') {
    const list = deliverablesOf(m.id as string).filter((d) => d.kind === m!.kind);
    const cur = list[0];
    if (!cur) return json({ versions: [] });
    const versions = Array.from({ length: Number(cur.version) }, (_, i) => ({
      id: nextId(),
      deliverableId: cur.id,
      taskId: Number(m!.id),
      stage: cur.stage,
      kind: cur.kind,
      version: i + 1,
      content: cur.content,
      status: i + 1 === Number(cur.version) ? cur.status : 'approved',
      createdAt: cur.updatedAt ?? now(),
    }));
    return json({ versions });
  }

  m = match('/api/tasks/:id/deliverables/:kind/diff', path);
  if (m && method === 'GET') {
    const list = deliverablesOf(m.id as string).filter((d) => d.kind === m!.kind);
    const cur = list[0];
    const curVer = Number(cur?.version ?? 1);
    const hasPrev = curVer > 1;
    return json({
      diff: {
        fromVersion: hasPrev ? curVer - 1 : null,
        toVersion: curVer,
        hasPrevious: hasPrev,
        identical: !hasPrev,
        addedPoints: hasPrev ? ['198g 机身——比一瓶矿泉水还轻，放包里几乎无感'] : [],
        removedPoints: [],
        keptPoints: ['磁吸即充——上车贴住就充，不用找线', '22.5W 有线快充——午休半小时，回血 60%'],
        titleChanged: hasPrev,
        outlineChanged: false,
        title: hasPrev ? { from: '磁吸充电，通勤路上不断电', to: '磁吸即充，通勤路上的第二次满电' } : undefined,
        outline: undefined,
        keywordChanges: { added: hasPrev ? ['磁吸即充'] : [], removed: [] },
        addedImages: [],
        removedImages: [],
      },
    });
  }

  m = match('/api/tasks/:id/deliverable-package', path);
  if (m && method === 'GET') {
    // 交付包：打包成**真正可解压的 ZIP**（含任务文案 + 已采纳的真实图片），不触达后端。
    // 之前这里返回的是「后缀 .zip 但内容是纯文本」的假包，访客下载后打不开（比不能下载更糟）。
    return buildSandboxPackage(m.id as string);
  }

  m = match('/api/tasks/:id/cost', path);
  if (m && method === 'GET') {
    const key = String(m.id);
    const runs = (db.events[key] ?? []).length + 6;
    // 费用按**真实计费口径**估算（用户明确要求）：
    //   ① 文本模型按 token 计费，单价与 backend/data/model-pricing.json 一致（deepseek-flash：输入 ¥1/百万、输出 ¥4/百万）
    //   ② 生图按张计费：¥0.05/张（用户指定）
    //   ③ 金额保留 2 位小数
    // 之前这里写死 ¥3.62，与实际相差近百倍，被用户指出。
    const INPUT_PER_1M = 1; // 元/百万 token
    const OUTPUT_PER_1M = 4;
    const PER_IMAGE = 0.05; // 元/张
    const inputTokens = 18_420;
    const outputTokens = 6_180;
    const imageCount = 3; // 与本任务真实产出的图片张数对应
    const textCost = (inputTokens / 1_000_000) * INPUT_PER_1M + (outputTokens / 1_000_000) * OUTPUT_PER_1M;
    const imageCost = imageCount * PER_IMAGE;
    const amount = Math.round((textCost + imageCost) * 100) / 100;
    return json({
      summary: {
        taskId: Number(key),
        totalDurationMs: 62_400,
        runs,
        successRuns: runs - 1,
        failedRuns: 1,
        byStage: [
          { stage: 'copy', stageLabel: '卖点文案', runs: 2, durationMs: 16_800, successRuns: 2, failedRuns: 0 },
          { stage: 'main-image', stageLabel: '主图设计', runs: 4, durationMs: 38_200, successRuns: 3, failedRuns: 1 },
          { stage: 'review', stageLabel: '主管校对', runs: 1, durationMs: 7_400, successRuns: 1, failedRuns: 0 },
        ],
        byAgent: [
          { agentId: 'agent-copy', agentName: '美美', runs: 2, durationMs: 16_800 },
          { agentId: 'agent-design', agentName: '平平', runs: 4, durationMs: 38_200 },
        ],
        models: ['deepseek-flash', 'gpt-image-2.5-sunburst'],
        tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens, tokensEstimated: true },
        imageCount,
        cost: { currency: 'CNY', amount, estimated: true, pricingSource: 'local-default', unpricedModels: [] },
        firstStartedAt: '2026-10-14T02:25:00.000Z',
        lastFinishedAt: '2026-10-14T05:00:00.000Z',
      },
    });
  }

  return null;
}

function handleAgents(path: string, method: string, init?: RequestInit): Response | null {
  if (path === '/api/agents' && method === 'GET') {
    return json({ agents: db.agents.map((a) => toAgent(a, true)) });
  }

  if (path === '/api/agents/skills' && method === 'GET') {
    return json({
      skills: [
        { id: '小红书合规违禁词清单', name: '小红书合规违禁词清单', description: '笔记发布前的合规自检清单（绝对化用语 / 功效宣称 / 站外引流）', category: '小红书' },
        { id: '电商文案模板', name: '电商文案模板', description: '主标题 + 副标题 + 三条卖点 + 场景的五段式结构', category: '电商' },
        { id: '电商主图规范', name: '电商主图规范', description: '主图尺寸、安全区与五张图分工', category: '电商' },
        { id: '爆款标题库', name: '爆款标题库', description: '场景型 / 对比型 / 数字型标题公式与示例', category: '小红书' },
        { id: '产品资料核对', name: '产品资料核对', description: '生成前核对参数，避免模型凭空编造规格', category: '通用' },
      ],
    });
  }

  if (path === '/api/agents/skills' && method === 'POST') {
    const body = bodyOf(init);
    return json({ skill: { id: String(body.name ?? '新技能'), name: String(body.name ?? '新技能') } });
  }

  if (path === '/api/agents/files' && method === 'GET') {
    return json({
      files: [
        { id: '知识库/商品事实与品牌表达/商品事实与宣称证据总则.md', name: '商品事实与宣称证据总则' },
        { id: '知识库/商品事实与品牌表达/品牌表达与语气指南.md', name: '品牌表达与语气指南' },
        { id: '知识库/电商内容/电商内容规范.md', name: '电商内容规范' },
        { id: '知识库/视觉制作/视觉制作与质检规范.md', name: '视觉制作与质检规范' },
        { id: '知识库/小红书内容/小红书内容规范.md', name: '小红书内容规范' },
      ],
    });
  }

  if (path === '/api/agents/files' && method === 'POST') {
    const body = bodyOf(init);
    return json({ file: { id: String(body.name ?? '新文件'), name: String(body.name ?? '新文件') } });
  }

  let m = match('/api/agents/:id/channel-test', path);
  if (m && method === 'POST') {
    // 绝不发起真实请求：直接返回一个「可用」的假检测结果（沙盒里所有 key 都是假的）
    return json({
      result: {
        ok: true,
        latencyMs: 268,
        model: 'deepseek-flash',
        baseUrlHost: 'sandbox.invalid',
        error: null,
        recentFailedRuns: 0,
      },
    });
  }

  m = match('/api/agents/:id/stats', path);
  if (m && method === 'GET') {
    return json({
      stats: {
        agentId: m.id,
        runs: 42,
        successCount: 40,
        successRate: 95.2,
        avgDurationMs: 9_400,
        byStage: [
          { stage: 'copy', runs: 18, successRate: 94.4, avgDurationMs: 8_200 },
          { stage: 'main-image', runs: 14, successRate: 92.9, avgDurationMs: 21_600 },
          { stage: 'review', runs: 10, successRate: 100, avgDurationMs: 5_100 },
        ],
      },
    });
  }

  m = match('/api/agents/:id', path);
  if (m && method === 'PUT') {
    const agent = db.agents.find((a) => a.id === m!.id);
    if (!agent) return notFound(path);
    Object.assign(agent, bodyOf(init));
    return json({ agent: toAgent(agent, true) });
  }

  if (path === '/api/executions' && method === 'GET') {
    // AgentExecution 字段：status success|failed / createdAt（demo-data 用的是 running/at，这里归一化）
    return json({
      executions: clone(EXECUTIONS).map((e) => ({
        ...e,
        status: e.status === 'running' ? 'success' : e.status,
        error: null,
        createdAt: (e as AnyRec).at,
      })),
    });
  }

  return null;
}

function handleMisc(path: string, method: string, url: URL, init?: RequestInit): Response | null {
  if (path === '/api/workflows' && method === 'GET') {
    // 工作流定义：结构必须完整（阶段条按 nodes 顺序渲染、确认点按 approvalPoint 标记）
    return json({
      workflows: WORKFLOWS.map((w) =>
        w.id === 'xhs-note'
          ? {
              id: w.id,
              name: w.name,
              nodes: [
                { id: 'xhs-topic', label: '选题策划', ownerRole: '文案', approvalPoint: true },
                { id: 'xhs-copy', label: '笔记撰写', ownerRole: '文案', approvalPoint: true },
                { id: 'xhs-cover', label: '首图设计', ownerRole: '设计师', approvalPoint: true, parallelGroups: [{ channel: 'img-1', items: ['首图'] }] },
                { id: 'xhs-inner', label: '内页设计', ownerRole: '设计师', approvalPoint: true, parallelGroups: [{ channel: 'img-2', items: ['内页图1', '内页图2'] }] },
                { id: 'xhs-review', label: '主管校对', ownerRole: '主管', autoNext: true },
                { id: 'xhs-deliver', label: '交付完成', ownerRole: '主管', autoNext: true },
              ],
              edges: [
                { from: 'xhs-topic', to: 'xhs-copy', label: '确认点1', condition: 'approved' },
                { from: 'xhs-copy', to: 'xhs-cover', label: '确认点2', condition: 'approved' },
                { from: 'xhs-cover', to: 'xhs-inner', label: '确认点3', condition: 'approved' },
                { from: 'xhs-inner', to: 'xhs-review', label: '确认点4', condition: 'approved' },
                { from: 'xhs-review', to: 'xhs-deliver', label: '放行', condition: 'passed' },
              ],
            }
          : {
              id: w.id,
              name: w.name,
              nodes: [
                { id: 'requirement', label: '需求对接', ownerRole: '文案', autoNext: true },
                { id: 'copy', label: '卖点文案', ownerRole: '文案', approvalPoint: true },
                { id: 'main-image', label: '主图设计', ownerRole: '设计师', approvalPoint: true, parallelGroups: [{ channel: 'img-1', items: ['主图1', '副图2'] }, { channel: 'img-2', items: ['副图3'] }] },
                { id: 'detail-image', label: '详情图设计', ownerRole: '设计师', approvalPoint: true },
                { id: 'review', label: '主管校对', ownerRole: '主管', autoNext: false },
                { id: 'deliver', label: '交付完成', ownerRole: '主管', autoNext: true },
              ],
              edges: [
                { from: 'requirement', to: 'copy', label: '顺序' },
                { from: 'copy', to: 'main-image', label: '确认点1', condition: 'approved' },
                { from: 'main-image', to: 'detail-image', label: '确认点2', condition: 'approved' },
                { from: 'detail-image', to: 'review', label: '确认点3', condition: 'approved' },
                { from: 'review', to: 'deliver', label: '放行', condition: 'passed' },
              ],
            },
      ),
    });
  }

  if (path === '/api/settings') {
    if (method === 'GET') return json(db.settings);
    if (method === 'PUT') {
      Object.assign(db.settings, bodyOf(init));
      return json(db.settings);
    }
  }

  if (path === '/api/chat/history' && method === 'GET') {
    const to = url.searchParams.get('to') ?? '全体';
    // 私聊：**按聊天对象返回各自的内容** ——
    // 原实现无论点谁都返回 `db.chat`（只有依依的问答记录），
    // 导致点美美/平平/波波看到的还是依依的对话（用户反馈"点击对应的显示不对"）。
    const priv = (rows: { from: string; text: string; at: string }[], who: string) =>
      rows.map((m, i) => ({
        id: i + 1,
        chatKind: 'private',
        from: String(m.from),
        to: who,
        body: String(m.text),
        kind: 'msg' as const,
        createdAt: String(m.at),
      }));

    /** 各 Agent 的对话内容：与其角色职责一致（文案/设计/主管/助理） */
    const PRIVATE_CHATS: Record<string, { from: string; text: string; at: string }[]> = {
      依依: db.chat.map((m) => ({ from: String(m.from), text: String(m.text), at: String(m.at) })),
      美美: [
        { from: '你', text: '手机壳那单的卖点文案，重点突出哪两个？', at: '2026-10-17T02:10:00.000Z' },
        {
          from: '美美',
          text: '按产品资料，建议主打这两点：\n\n1. **四角气囊 + 1.2 米防摔** —— 有实测数据支撑，可信度最高\n2. **抗黄变 30 天实测** —— 直击「透明壳用久发黄」这个高频差评\n\n其余卖点（食品级材质、磨砂手感）建议放副标题，主图只留这两个。',
          at: '2026-10-17T02:10:08.000Z',
        },
        { from: '你', text: '标题能不能再短一点？', at: '2026-10-17T02:11:00.000Z' },
        {
          from: '美美',
          text: '可以。京东标题上限 60 字符，现在 58 字偏满。压缩版：\n\n「手机壳 防摔抗黄 磨砂亲肤 全包镜头 多色可选」（28 字）\n\n拆掉的是「京东自营同款」和「5G信号无阻」——前者属资质背书、适合放详情页，后者是行业通识、不构成差异点。',
          at: '2026-10-17T02:11:10.000Z',
        },
      ],
      平平: [
        { from: '你', text: 'macbook pro 这次出了几张主图？', at: '2026-10-17T02:20:00.000Z' },
        {
          from: '平平',
          text: '主图 3 张已出、详情图 4 张已出，全部通过视觉一致性校对：\n\n· 主图1 —— 白底正面，键盘与触控板清晰\n· 副图2 —— 侧面薄度对比\n· 副图3 —— 接口特写（雷雳口 / HDMI / SD）\n\n详情图那 4 张按「卖点图 → 参数图 → 场景图 → 细节图」的顺序排好了。',
          at: '2026-10-17T02:20:12.000Z',
        },
        { from: '你', text: '场景图想再生活化一点，别太影棚感', at: '2026-10-17T02:21:00.000Z' },
        {
          from: '平平',
          text: '收到。下一版场景图会改成：咖啡馆桌面 + 自然侧光 + 有人手入镜，去掉纯色背景和影棚打光。\n\n另外提醒一下：品牌视觉规范里要求「场景图主色占比 ≥ 60%」，我会按这条来调。',
          at: '2026-10-17T02:21:15.000Z',
        },
      ],
      波波: [
        {
          from: '波波',
          text: '今日 7 个任务已排产，其中 3 个停在待确认等你的决定：\n\n· #44 华米手表（小红书）—— 内页图待确认\n· #29 冬日暖手宝 —— 首图待确认\n· #8 轻磁 Pro 充电宝 —— 主图待确认\n\n其余 4 个在正常推进，暂无阻塞。',
          at: '2026-10-17T02:30:00.000Z',
        },
        { from: '你', text: '华米手表那个，合规那边有问题吗？', at: '2026-10-17T02:31:00.000Z' },
        {
          from: '波波',
          text: '合规审核已过：\n\n✓ 绝对化用语 —— 未发现「最」「第一」等\n✓ 医疗功效宣称 —— 未涉及\n✓ 配图与文案相符 —— 3 张一致\n\n可以直接进入发布包装。如果文案里要加「续航 14 天」这类参数，记得标注测试条件。',
          at: '2026-10-17T02:31:12.000Z',
        },
      ],
    };

    const targetName = String(AGENTS.find((agent) => agent.id === to)?.name ?? to);
    const existingGroupTaskIds = new Set([47, 44]);
    const currentTaskEvents = db.tasks
      .filter((task) => !task.archived && !existingGroupTaskIds.has(Number(task.id)))
      .map((task, index) => {
        const taskId = Number(task.id);
        const title = String(task.title);
        const stage = String(task.stage ?? '');
        const stageLabel = STAGE_LABELS[stage as keyof typeof STAGE_LABELS] ?? stage;
        const statusText =
          task.column === 'awaiting'
            ? `当前停留在「${stageLabel}」节点，等待确认。`
            : task.column === 'done'
              ? '当前状态：已完成交付。'
              : `当前进行到「${stageLabel}」节点。`;
        return {
          id: 100 + index,
          chatKind: 'group',
          from: '系统',
          to: 'group',
          body: `任务「${title}」${statusText}`,
          kind: 'evt' as const,
          taskId,
          createdAt: new Date(Date.parse('2026-10-17T02:05:30.000Z') + index * 50_000).toISOString(),
        };
      });
    const messages =
      to === '全体'
        ? [
            { id: 1, chatKind: 'group', from: '系统', to: 'group', body: '任务「macbook pro」主图 3 张、详情图 4 张已产出，等待确认', kind: 'evt', taskId: 47, createdAt: '2026-10-17T02:00:00.000Z' },
            { id: 2, chatKind: 'group', from: '系统', to: 'group', body: '任务「华米 T-REX 3 运动手表」笔记文案已产出，等待确认', kind: 'evt', taskId: 44, createdAt: '2026-10-17T02:05:00.000Z' },
            ...currentTaskEvents,
            { id: 3, chatKind: 'group', from: '波波', to: 'group', body: '今日 7 个任务已排产，3 个等你确认。', kind: 'msg', createdAt: '2026-10-17T02:10:00.000Z' },
          ]
        : priv(PRIVATE_CHATS[targetName] ?? [], targetName);
    return json({ messages });
  }

  if (path === '/api/uploads' && method === 'POST') {
    // 参考图上传：沙盒里不落盘，回一个内联 SVG dataURL（前端只把它当图片地址用）
    const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const surface = token('--color-sunken');
    const line = token('--color-line');
    const faint = token('--color-ink-faint');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${surface}" stroke="${line}"/><text x="200" y="204" font-size="20" fill="${faint}" text-anchor="middle" font-family="sans-serif">沙盒参考图</text></svg>`;
    return json({ url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` });
  }

  if (path === '/api/kb-assistant/organize' && method === 'POST') {
    const body = bodyOf(init);
    const item = (body.item ?? {}) as AnyRec;
    const title = String(item.title ?? '整理产出');
    const path2 = `知识库/灵感库/${title.slice(0, 24)}.md`;
    if (body.kind === 'hot') {
      db.kbImportedDocs.push({
        path: path2,
        title,
        dir: '知识库/灵感库',
        tags: ['灵感'],
        mtime: now(),
        size: 240,
      });
    }
    return json({ ok: true, draftId: nextId(), title, structured: true });
  }

  if (path === '/api/kb-drafts' && method === 'GET') return json({ drafts: [] });
  const draftDel = match('/api/kb-drafts/:id', path);
  if (draftDel && method === 'DELETE') return json({ deleted: true });

  if (path === '/api/deliverables/search' && method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim();
    if (!q) return json({ query: q, hits: [], truncated: false, hint: '请输入关键字' });
    const lower = q.toLowerCase();
    const hits: AnyRec[] = [];
    for (const [taskId, list] of Object.entries(db.deliverables)) {
      const task = db.tasks.find((t) => String(t.id) === taskId);
      for (const d of list) {
        const content = String(d.content ?? '');
        const idx = content.toLowerCase().indexOf(lower);
        if (idx < 0) continue;
        hits.push({
          taskId: Number(taskId),
          taskTitle: String(task?.title ?? `任务 #${taskId}`),
          stage: d.stage,
          kind: d.kind,
          version: d.version,
          field: 'point',
          snippet: content.slice(Math.max(0, idx - 24), idx + q.length + 36).replace(/\s+/g, ' ').trim(),
        });
      }
    }
    return json({ query: q, hits: hits.slice(0, 30), truncated: hits.length > 30 });
  }

  return null;
}

function handleHot(path: string, method: string, init?: RequestInit): Response | null {
  if (path === '/api/hot' && method === 'GET') {
    // HotItem 必填字段：summary/source/sourceCount/domains/reason/url/latestAt（demo-data 已给主要字段，这里补齐）
    const displaySet = (HOT_PANEL.displaySet as AnyRec[]).map((it) => ({
      id: it.id,
      title: it.title,
      summary: it.summary ?? null,
      source: it.source ?? '多源热点',
      sourceId: it.sourceId,
      sourceName: it.sourceName ?? it.source,
      vertical: 'ecommerce-news',
      sourceCount: 2,
      evidence: 'multi-source',
      latest: null,
      domains: [{ id: 'desk', label: '桌面办公' }],
      reason: '命中关注域「桌面办公」，且有多家信源报道',
      url: it.url ?? null,
      latestAt: '2026-10-17T03:00:00.000Z',
    }));
    return json({
      panel: {
        status: 'live',
        fetchedAt: HOT_PANEL.generatedAt,
        expiresAt: '2026-10-17T04:00:00.000Z',
        sourceName: '多源热点（沙盒演示）',
        sourceUrl: 'https://example.com/hot',
        sources: HOT_PANEL.sources.map((s) => ({ id: s.name, label: s.name, status: s.status === 'ok' ? 'ok' : 'degraded', itemCount: s.count })),
        daily: { date: '2026-10-17', count: 20, publishedAt: HOT_PANEL.generatedAt, url: 'https://example.com/daily', title: '电商热点日报' },
        error: null,
        counts: { upstream: 20, mustRead: 6, browse: 1, other: 1, selected24h: 8 },
        tiers: { mustRead: displaySet.slice(0, 6), browse: displaySet.slice(6, 7), other: displaySet.slice(7) },
        aiTags: HOT_PANEL.aiTags,
        aiTagged: HOT_PANEL.aiTagged,
        aiDegraded: HOT_PANEL.aiDegraded,
        displaySet,
        hiddenCount: HOT_PANEL.hiddenCount,
        rawCount: HOT_PANEL.rawCount,
        sourceCounts: HOT_PANEL.sourceCounts,
      },
    });
  }

  if (path === '/api/hot/attention') {
    if (method === 'GET') return json({ config: db.hotAttention });
    if (method === 'PUT') {
      db.hotAttention = bodyOf(init);
      return json({ config: db.hotAttention });
    }
  }

  return null;
}

function handleKnowledge(path: string, method: string, url: URL, init?: RequestInit): Response | null {
  if (path === '/api/knowledge/status' && method === 'GET') return json({ status: kbStatusPayload() });

  if (path === '/api/knowledge/config' && method === 'PUT') {
    const body = bodyOf(init);
    if (body.root === '') {
      // 断开连接：返回未连接状态（界面会切到「未连接」空态，这是真实存在的分支）
      return json({
        status: { state: 'disconnected', reason: '沙盒演示：已手动断开连接', root: null, source: 'none', range: { includeDirs: [], excludeDirs: [] }, indexing: false },
        reindexStarted: false,
      });
    }
    const st = kbStatusPayload();
    if (Array.isArray(body.presetEntries)) st.presetEntries = body.presetEntries;
    if (Array.isArray(body.includeDirs)) (st.range as AnyRec).includeDirs = body.includeDirs;
    return json({ status: st, reindexStarted: true });
  }

  if (path === '/api/knowledge/reindex' && method === 'POST') return json({ started: true, status: kbStatusPayload() });

  if (path === '/api/knowledge/stats' && method === 'GET') {
    return json({ stats: kbStatsPayload() });
  }

  if (path === '/api/knowledge/dirs' && method === 'GET') {
    const map = new Map<string, number>();
    for (const d of allKbDocs()) {
      const dir = String(d.dir);
      map.set('', (map.get('') ?? 0) + 1);
      if (dir) {
        const parts = dir.split('/');
        for (let i = 1; i <= parts.length; i++) {
          const key = parts.slice(0, i).join('/');
          map.set(key, (map.get(key) ?? 0) + 1);
        }
      }
    }
    const dirs = [...map.entries()].map(([dir, count]) => ({ dir, count }));
    dirs.sort((a, b) => (a.dir === '' ? -1 : b.dir === '' ? 1 : a.dir.localeCompare(b.dir)));
    return json({ dirs: dirs.length ? dirs : KNOWLEDGE_DIRS });
  }

  if (path === '/api/knowledge/tags' && method === 'GET') {
    const map = new Map<string, number>();
    for (const d of allKbDocs()) for (const t of d.tags as string[]) map.set(t, (map.get(t) ?? 0) + 1);
    return json({ tags: [...map.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count) });
  }

  if (path === '/api/knowledge/docs' && method === 'GET') {
    const dir = url.searchParams.get('dir');
    const tag = url.searchParams.get('tag');
    let docs = allKbDocs();
    if (tag) docs = docs.filter((d) => (d.tags as string[]).includes(tag));
    else if (dir != null) docs = docs.filter((d) => dir === '' ? true : String(d.dir) === dir || String(d.dir).startsWith(`${dir}/`));
    return json({ docs });
  }

  if (path === '/api/knowledge/doc' && method === 'GET') {
    const p = url.searchParams.get('path') ?? '';
    const src = KB_DOCS.find((d) => d.path === p);
    const imported = db.kbImportedDocs.find((d) => d.path === p);
    if (!src) {
      if (imported) {
        return json({ doc: { ...imported, content: `# ${imported.title}\n\n（沙盒演示：本文件由「收进灵感库」动作在内存中创建，刷新后消失。）\n`, anchors: [{ anchor: imported.title as string, level: 1, title: imported.title as string }] } });
      }
      return json({ error: `沙盒中不存在该文档：${p}` }, 404);
    }
    return json({
      doc: {
        ...kbSummary(src),
        content: src.content,
        anchors: src.anchorTitles.map((t, i) => ({ anchor: t, level: 2, title: t, index: i })),
      },
    });
  }

  if (path === '/api/knowledge/search' && method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim();
    if (!q) return json({ query: q, hits: [], hint: '请输入搜索关键字' });
    const lower = q.toLowerCase();
    const hits = allKbDocs()
      .map((d) => {
        const src = KB_DOCS.find((x) => x.path === d.path);
        const inTitle = String(d.title).toLowerCase().includes(lower);
        // 也匹配**目录路径**：像「电商」「小红书」这类分类词只出现在路径里
        // （如 技能库/电商/电商文案模板.md），不匹配路径就搜不到同分类的全部资料——
        // 沙盒按工作流预置这两个词，若命中不了会显示空结果。
        const inPath = String(d.path).toLowerCase().includes(lower);
        const body = src?.content ?? '';
        const idx = body.toLowerCase().indexOf(lower);
        if (!inTitle && !inPath && idx < 0) return null;
        const start = Math.max(0, idx - 30);
        const snippet =
          idx >= 0
            ? body.slice(start, idx + q.length + 40).replace(/\s+/g, ' ').trim()
            : inTitle
              ? `${d.title} —— 标题命中`
              : `${d.path} —— 目录命中（${d.dir}）`;
        return { path: d.path, title: d.title, dir: d.dir, tags: d.tags, snippet, matchMode: q.length >= 3 ? 'fts' : 'like', score: inTitle || inPath ? 0 : 1 };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .slice(0, 30);
    return json({ query: q, hits, hint: hits.length === 0 ? `没有找到与「${q}」相关的文档` : undefined });
  }

  if (path === '/api/knowledge/graph' && method === 'GET') return json({ graph: kbGraphPayload() });

  if (path === '/api/knowledge/node' && method === 'GET') {
    const id = url.searchParams.get('id') ?? '';
    const graph = kbGraphPayload();
    const node = (graph.nodes as AnyRec[]).find((n) => n.id === id);
    if (!node) return json({ error: `沙盒中不存在该节点：${id}` }, 404);
    const docs = allKbDocs();
    const mine = node.path as string | null;
    const out = mine ? (KB_DOCS.find((d) => d.path === mine)?.links ?? []).map((p) => docs.find((d) => d.path === p)).filter(Boolean) : [];
    const inLinks = mine ? KB_DOCS.filter((d) => d.links.includes(mine)).map(kbSummary) : [];
    const shared = mine
      ? docs.filter((d) => d.path !== mine && (d.tags as string[]).some((t) => (node.tags as string[]).includes(t))).slice(0, 8)
      : [];
    return json({ detail: { node, outLinks: out, inLinks, sharedTagDocs: shared } });
  }

  if (path === '/api/knowledge/health' && method === 'GET') {
    const docs = allKbDocs();
    const linked = new Set<string>();
    for (const refs of Object.values(db.kbRefs)) for (const r of refs) linked.add(String(r.docPath));
    const islands = KB_DOCS.filter((d) => d.links.length === 0).map((d) => d.path);
    return json({
      health: {
        usage: { linkedDocs: linked.size, totalDocs: docs.length, ratio: docs.length ? linked.size / docs.length : null },
        islands: { count: islands.length, paths: islands },
        computedAt: now(),
      },
    });
  }

  if (path === '/api/knowledge/import' && method === 'POST') {
    const name = '上传的文档.md';
    const path2 = `知识库/收件箱/${name}`;
    db.kbImportedDocs.push({ path: path2, title: '上传的文档', dir: '知识库/收件箱', tags: [], mtime: now(), size: 1200 });
    return json({ ok: true, path: path2, title: '上传的文档', sourceName: name, sourceType: 'text', charCount: 1200, reindexStarted: true });
  }

  if (path === '/api/knowledge/xhs/status' && method === 'GET') return json({ configured: true });

  if (path === '/api/knowledge/xhs-import' && method === 'POST') {
    const body = bodyOf(init);
    const text = String(body.text ?? '');
    const title = text.split('\n')[0].slice(0, 24) || '小红书笔记拆解';
    const path2 = `知识库/收件箱/小红书/${title}.md`;
    db.kbImportedDocs.push({ path: path2, title, dir: '知识库/收件箱/小红书', tags: ['小红书'], mtime: now(), size: 860 });
    return json({ ok: true, path: path2, title, images: ['/sandbox/placeholder-xhs-1.svg', '/sandbox/placeholder-xhs-2.svg'], videos: [], sourceUrl: null, degraded: '沙盒演示：未配置 Cookie，仅按粘贴文本解析', reindexStarted: true });
  }

  return null;
}

/* ==========================================================================
   七、总入口：把请求交给上面的实现
   ========================================================================== */

function route(input: RequestInfo | URL, init?: RequestInit): Response {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  // 同源相对路径直接解析；跨域绝对地址不在沙盒覆盖范围（也不该出现）
  const url = new URL(raw, window.location.origin);
  const path = url.pathname;
  const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET')).toUpperCase();

  const frozenAction =
    (method === 'POST' && (
      path === '/api/uploads' ||
      path === '/api/agents/files' ||
      path === '/api/agents/skills' ||
      path === '/api/knowledge/import' ||
      path === '/api/knowledge/xhs-import' ||
      /^\/api\/tasks\/[^/]+\/(confirm|deliverables\/decide|deliverables\/images\/[^/]+\/retry|review)$/.test(path)
    )) ||
    (method === 'PUT' && /^\/api\/tasks\/[^/]+\/(kb-refs|hot-refs)$/.test(path)) ||
    (method === 'GET' && /^\/api\/tasks\/[^/]+\/deliverable-package$/.test(path));
  if (frozenAction) return json({ error: '演示模式：此操作已冻结。' }, 403);

  return (
    handleTasks(path, method, url, init) ??
    handleAgents(path, method, init) ??
    handleHot(path, method, init) ??
    handleKnowledge(path, method, url, init) ??
    handleMisc(path, method, url, init) ??
    // 兜底：给一个「结构合理」的空响应而不是报错，避免界面白屏或弹红字。
    // 注意必须直接返回 Response —— 早期的 `{ ...json(x) }` 写法会把 Response 摊平成普通对象，
    // 丢掉原型上的 .json()/.text()，调用方一读就抛「json is not a function」。
    json(emptyShapeFor(path))
  );
}

/** 未覆盖接口的空结构兜底：宁可返回空列表，也不要 500/抛错 */
function emptyShapeFor(path: string): unknown {
  if (/\/stats$/.test(path)) return { stats: { docCount: 0, tagCount: 0, dirCount: 0, edgeCount: 0, recent: [], indexedAt: null, indexing: false } };
  if (/\/versions$/.test(path)) return { versions: [] };
  if (/\/events$/.test(path)) return { events: [] };
  if (/\/deliverables$/.test(path)) return { deliverables: [] };
  if (/\/refs$/.test(path)) return { refs: [] };
  return {};
}

/* ==========================================================================
   八、WebSocket mock
   ========================================================================== */

/**
 * 假 WebSocket：只实现 useWorkbench / ws.ts 用到的四种成员
 * （onopen / onmessage / onclose / send / close）。
 * `send` 收到 chat:send 时回一条「依依正在检索知识库」的确认，让聊天面板有真实反馈。
 */
class SandboxWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  private timers: number[] = [];

  constructor(url: string) {
    this.url = url;
    // 微任务后触发 onopen：与真实 WS 的异步语义一致（同步触发会让 axios/React 时序错乱）
    this.timers.push(
      window.setTimeout(() => {
        this.readyState = 1;
        this.onopen?.(new Event('open'));
        this.push({ type: 'heartbeat', ts: Date.now() });
      }, 30),
    );
    wsClients.add((msg) => this.push(msg));
  }

  private push(payload: unknown): void {
    if (this.readyState !== 1) return;
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }

  send(data: string): void {
    let msg: AnyRec = {};
    try {
      msg = JSON.parse(data) as AnyRec;
    } catch {
      return;
    }
    // 沙盒聊天输入已冻结：忽略通过其他入口发来的 chat:send。
    if (msg.type === 'chat:history' && msg.chatKind) {
      const to = String(msg.to ?? '全体');
      this.timers.push(
        window.setTimeout(() => {
          this.push({ type: 'chat:history', chatKind: String(msg.chatKind), messages: [] });
        }, 100),
      );
    }
  }

  close(): void {
    this.readyState = 3;
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
    this.onclose?.(new CloseEvent('close'));
  }
}

/* ==========================================================================
   九、安装
   ========================================================================== */

let installed = false;

/**
 * 安装沙盒拦截层。非沙盒模式下**什么都不做**（不替换任何全局对象）。
 * 必须在 React 渲染前调用，否则首批请求可能已经打到真实后端。
 */
export function installSandbox(): void {
  if (installed) return;
  if (!isSandbox()) return;
  installed = true;

  const realFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let pathname = '';
    try {
      pathname = new URL(raw, window.location.origin).pathname;
    } catch {
      pathname = raw;
    }
    // 只接管 /api/*：页面 HTML、JS/CSS、public 下的占位图必须原样放行，否则应用加载不出来
    if (!pathname.startsWith('/api/')) return realFetch(input, init);
    return Promise.resolve(route(input, init));
  }) as typeof window.fetch;

  // WebSocket：替换构造器，前端拿到的就是上面那个假实现
  const RealWS = window.WebSocket;
  const FakeWS = SandboxWebSocket as unknown as Record<string, unknown>;
  // 常量按真实 WebSocket 对齐（有些库会用 readyState 与常量比较，值必须一致）
  FakeWS.CONNECTING = RealWS.CONNECTING;
  FakeWS.OPEN = RealWS.OPEN;
  FakeWS.CLOSING = RealWS.CLOSING;
  FakeWS.CLOSED = RealWS.CLOSED;
  window.WebSocket = FakeWS as unknown as typeof WebSocket;

  // 让开发者在控制台一眼确认拦截层是否生效（也方便自动化验收脚本断言）
  (window as unknown as AnyRec).__SANDBOX__ = {
    active: true,
    endpoints: API_PATHS,
    install: () => undefined,
  };
  console.info('[sandbox] 已启用沙盒拦截层：所有 /api 请求由本地演示数据响应，不会触达真实后端。');

}

/** 拦截层覆盖的接口清单（供控制台与验收脚本核对，避免「以为覆盖了其实没有」） */
export const API_PATHS = [
  'GET /api/tasks',
  'POST /api/tasks',
  'GET /api/tasks/:id',
  'POST /api/tasks/:id/confirm',
  'POST /api/tasks/:id/archive',
  'POST /api/tasks/:id/restore',
  'GET /api/tasks/:id/events',
  'GET /api/tasks/:id/deliverables',
  'POST /api/tasks/:id/deliverables/decide',
  'POST /api/tasks/:id/deliverables/images/:imageId/retry',
  'POST /api/tasks/:id/review',
  'GET /api/tasks/:id/kb-refs',
  'PUT /api/tasks/:id/kb-refs',
  'GET /api/tasks/:id/hot-refs',
  'PUT /api/tasks/:id/hot-refs',
  'GET /api/tasks/:id/provenance',
  'GET /api/tasks/:id/rework',
  'GET /api/tasks/:id/deliverables/:kind/versions',
  'GET /api/tasks/:id/deliverables/:kind/diff',
  'GET /api/tasks/:id/deliverable-package',
  'GET /api/tasks/:id/cost',
  'GET /api/agents',
  'PUT /api/agents/:id',
  'POST /api/agents/:id/channel-test',
  'GET /api/agents/:id/stats',
  'GET /api/agents/skills',
  'POST /api/agents/skills',
  'GET /api/agents/files',
  'POST /api/agents/files',
  'GET /api/executions',
  'GET /api/workflows',
  'GET /api/settings',
  'PUT /api/settings',
  'GET /api/chat/history',
  'POST /api/uploads',
  'POST /api/kb-assistant/organize',
  'GET /api/kb-drafts',
  'DELETE /api/kb-drafts/:id',
  'GET /api/hot',
  'GET /api/hot/attention',
  'PUT /api/hot/attention',
  'GET /api/knowledge/status',
  'PUT /api/knowledge/config',
  'POST /api/knowledge/reindex',
  'GET /api/knowledge/stats',
  'GET /api/knowledge/dirs',
  'GET /api/knowledge/tags',
  'GET /api/knowledge/docs',
  'GET /api/knowledge/doc',
  'GET /api/knowledge/search',
  'GET /api/knowledge/graph',
  'GET /api/knowledge/node',
  'GET /api/knowledge/health',
  'POST /api/knowledge/import',
  'GET /api/knowledge/xhs/status',
  'POST /api/knowledge/xhs-import',
  'GET /api/deliverables/search',
];
