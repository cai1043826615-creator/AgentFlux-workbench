/**
 * 产出溯源（T1-B1 · deliverable-provenance）
 *
 * 事实项抽取 / 归一化 / 匹配 / 溯源率计算 / 结果组装。
 *
 * 事实项覆盖四类：① 数值+单位；② 认证或标准编号；③ 材质与成分词；④ 文本型事实（功能宣称、场景描述等陈述性语句）。
 * 匹配依据始终为「实际注入给 Agent 的关联资料片段文本」（loadTaskKbFragments 的可用片段，
 * state==='missing' 不参与匹配）。纯函数部分与 Vault / DB 解耦，便于单测。
 */
import type { CopyPackage, FactField, FactItem, FactType, ProvenanceRefMeta, ProvenanceResult } from '@workbench/shared';
import { get } from '../db/client.ts';
import { KT } from '../knowledge/schema.ts';
import { listTaskKbRefs, loadTaskKbFragments, type KbFragment } from '../knowledge/refs.ts';
import { listDeliverables } from './store.ts';

/** 文本型事实命中阈值（可配置参数） */
export const DEFAULT_TEXTUAL_COVERAGE_THRESHOLD = 0.8;

/** 材质成分词表（大小写不敏感的包含匹配） */
export const DEFAULT_MATERIAL_WORDS: string[] = [
  '铝合金',
  'ABS',
  'PC',
  '硅胶',
  '锂聚合物',
  '不锈钢',
  'Tritan',
  '聚碳酸酯',
  '亚克力',
  '锌合金',
  '陶瓷',
  '玻璃',
  '尼龙',
  '皮革',
  'TPU',
  'PU',
];

/** 数值+单位（含可选小数，数字与单位之间允许空白） */
const NUMBER_UNIT_RE = /\d+(?:\.\d+)?\s*(?:mAh|Ah|Wh|W|V|A|g|kg|mm|cm|ml|L|小时|天|个月|年|元|%|Hz|rpm|转|次|m|km)/gi;

/** 认证 / 标准编号 */
const CERTIFICATION_RE = /(?:GB\s?\d+(?:\.\d+)?|UN\s?38\.3|\b(?:RoHS|FCC|CE|3C|UL|PSE|SGS|CCC)\b)/gi;

/** 文本型事实分句分隔符（冒号 / 斜杠 / 顿号不分句） */
const SENTENCE_SPLIT_RE = /[。！？；，,\n\s]+/;

/** 文本型事实停用词表（完全相等才丢弃） */
const TEXTUAL_STOP_WORDS = new Set([
  '了解更多',
  '更多',
  '欢迎',
  '请',
  '立即',
  '马上',
  '点击',
  '查看',
  '详情',
  '联系我们',
  '敬请期待',
  '等你',
  '等你来',
  '新品上市',
  '新品上架',
]);

/**
 * 基础归一化：
 * 1. trim 去首尾空白
 * 2. 全角转半角（\uFF01-\uFF5E 全角 ASCII 区统一减 0xFEE0；全角空格 \u3000 → ' '；顿号/句号等非 ASCII 区字符保留）
 * 3. 数字与单位之间的空格去掉（10000 mAh → 10000mAh）
 * 4. 统一小写
 */
export function normalizeText(s: string): string {
  let out = '';
  for (const ch of String(s ?? '').trim()) {
    const code = ch.codePointAt(0)!;
    if (code === 0x3000) out += ' ';
    else if (code >= 0xff01 && code <= 0xff5e) out += String.fromCodePoint(code - 0xfee0);
    else out += ch;
  }
  out = out.replace(/(\d)\s+(?=mAh|Ah|Wh|W|V|A|g|kg|mm|cm|ml|L|Hz|rpm|%|个月|小时|天|年|元|次|转)/g, '$1');
  return out.toLowerCase();
}

/**
 * 抽取事实项：遍历 CopyPackage 的 title（index=-1）/ points[i]（index=i）/ outline（index=-1）/ keywords[i]（index=i），
 * 对每段文本依次做 4 类抽取（数值+单位 / 认证编号 / 材质成分词 / 文本型事实），
 * 按 (type, normalizeText(text)) 去重（保留第一次出现的 field/index）。
 * 初始 traced=false、sources=[]、coverage=null。
 */
export function extractFacts(copy: CopyPackage): FactItem[] {
  const facts: FactItem[] = [];
  const seen = new Set<string>();
  let n = 0;

  const emit = (type: FactType, text: string, field: FactField, index: number): void => {
    const normalized = normalizeText(text);
    const key = `${type}\u0000${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    n += 1;
    facts.push({ id: `f${n}`, type, text, field, index, traced: false, sources: [], coverage: null, normalized });
  };

  extractFromText(copy.title, 'title', -1, emit);
  (copy.points ?? []).forEach((t, i) => extractFromText(t, 'points', i, emit));
  extractFromText(copy.outline, 'outline', -1, emit);
  (copy.keywords ?? []).forEach((t, i) => extractFromText(t, 'keywords', i, emit));

  return facts;
}

/** 对单段文本依次做 4 类抽取 */
function extractFromText(
  t: string,
  field: FactField,
  index: number,
  emit: (type: FactType, text: string, field: FactField, index: number) => void,
): void {
  const text = String(t ?? '');
  // 1. 数值+单位
  for (const m of text.matchAll(NUMBER_UNIT_RE)) emit('number-unit', m[0].trim(), field, index);
  // 2. 认证 / 标准编号
  for (const m of text.matchAll(CERTIFICATION_RE)) emit('certification', m[0].trim(), field, index);
  // 3. 材质成分词（大小写不敏感；text = 词表中词）
  const lower = text.toLowerCase();
  for (const w of DEFAULT_MATERIAL_WORDS) {
    if (lower.includes(w.toLowerCase())) emit('material', w, field, index);
  }
  // 4. 文本型事实：分句 → 过滤（空 / 长度<2 / 含数字 / 完全等于停用词）→ 生成
  for (const raw of text.split(SENTENCE_SPLIT_RE)) {
    const seg = raw.trim();
    if (!seg || seg.length < 2) continue;
    if (/\d/.test(seg)) continue;
    if (TEXTUAL_STOP_WORDS.has(seg)) continue;
    emit('textual', seg, field, index);
  }
}

/**
 * 文本型事实覆盖率：按分隔符（冒号/斜杠/顿号/逗号/分号/竖线/点号/空白）切词段，
 * 命中词段必须完整出现在资料中；覆盖率 = 命中词段字符数 / 全部词段字符数。
 */
function textualCoverage(statementNorm: string, docNorm: string): number {
  const segs = statementNorm
    .split(/[、，,;；：:/\·|\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  const totalLen = segs.reduce((n, s) => n + s.length, 0);
  if (totalLen === 0) return 0;
  let hit = 0;
  for (const s of segs) if (docNorm.includes(s)) hit += s.length;
  return hit / totalLen;
}

/** 是否可用片段（state==='missing' 不参与匹配；anchor-missing 已降级整篇，仍参与） */
function isUsableFragment(f: KbFragment): f is KbFragment & { content: string } {
  return f.state !== 'missing' && f.content != null;
}

/**
 * 匹配事实项（原地填充 traced / sources / coverage 并返回）。
 * - number-unit / certification / material：facts.normalized 被任一可用片段归一化文本包含 → 命中
 * - textual：对每个可用片段计算覆盖率取最大值作为 coverage；coverage ≥ threshold → 命中
 */
export function matchFacts(facts: FactItem[], fragments: KbFragment[], threshold: number = DEFAULT_TEXTUAL_COVERAGE_THRESHOLD): FactItem[] {
  const docs = fragments.filter(isUsableFragment).map((f) => ({ title: f.ref.title, norm: normalizeText(f.content) }));
  for (const fact of facts) {
    if (fact.type === 'textual') {
      let best = 0;
      const hits: string[] = [];
      for (const d of docs) {
        const c = textualCoverage(fact.normalized, d.norm);
        if (c > best) best = c;
        if (c >= threshold) hits.push(d.title);
      }
      fact.coverage = Number(best.toFixed(4));
      fact.traced = best >= threshold;
      fact.sources = fact.traced ? hits : [];
    } else {
      const hits: string[] = [];
      for (const d of docs) {
        if (d.norm.includes(fact.normalized)) hits.push(d.title);
      }
      fact.traced = hits.length > 0;
      fact.sources = hits;
    }
  }
  return facts;
}

/**
 * 溯源率：percent = Math.round(tracedCount / totalCount * 100)。
 * 无事实项（totalCount===0）时 noFacts=true、percent=null。
 */
export function computeProvenanceRate(facts: FactItem[]): {
  percent: number | null;
  tracedCount: number;
  untracedCount: number;
  totalCount: number;
  noFacts: boolean;
} {
  const totalCount = facts.length;
  const tracedCount = facts.filter((f) => f.traced).length;
  const untracedCount = totalCount - tracedCount;
  const noFacts = totalCount === 0;
  const percent = noFacts ? null : Math.round((tracedCount / totalCount) * 100);
  return { percent, tracedCount, untracedCount, totalCount, noFacts };
}

/**
 * 组装溯源结果：
 * 1. listTaskKbRefs → hasRefs
 * 2. loadTaskKbFragments → 可用片段（state!=='missing' && content!=null）→ refCount
 * 3. extractFacts → matchFacts → computeProvenanceRate
 * 4. refsMeta：knowledge_docs 的 mtime/hash（查不到用空串）
 * 5. generatedAt = 当前 ISO 时间
 */
export async function buildProvenanceResult(taskId: number, copy: CopyPackage): Promise<ProvenanceResult> {
  const refs = listTaskKbRefs(taskId);
  const hasRefs = refs.length > 0;

  const fragments = await loadTaskKbFragments(taskId);
  const usable = fragments.filter(isUsableFragment);
  const refCount = usable.length;

  const facts = matchFacts(extractFacts(copy), fragments);
  const rate = computeProvenanceRate(facts);

  const refsMeta: ProvenanceRefMeta[] = usable.map((f) => {
    const row = get<{ mtime: string; hash: string }>(`SELECT mtime, hash FROM ${KT.docs} WHERE path = ?`, [f.ref.docPath]);
    return { title: f.ref.title, mtime: row?.mtime ?? '', hash: row?.hash ?? '' };
  });

  return { ...rate, hasRefs, refCount, facts, refsMeta, generatedAt: new Date().toISOString() };
}

/**
 * 读取任务最新持久化的溯源结果（B1 · 2.5 查询通道）。
 * 取 deliverable kind='provenance' 的最新版本；文案阶段尚未产出（无该行）时返回 null。
 * hasRefs/refCount/facts 等均已随结果持久化，无需重算。
 */
export function getProvenanceResult(taskId: number): ProvenanceResult | null {
  const rows = listDeliverables(taskId).filter((d) => d.kind === 'provenance');
  const latest = rows[rows.length - 1];
  if (!latest) return null;
  try {
    return JSON.parse(latest.content) as ProvenanceResult;
  } catch {
    return null;
  }
}
