/**
 * 交付物相邻版本差异（delivery-ops B3 · Requirement「相邻版本差异提示」）
 *
 * - copy：卖点行按「trim + 折叠连续空白（含全角空格）」归一化后求差集/交集；
 *   另标注标题、详情大纲、关键词变化（含前后值）。
 * - image：按 ImageItem.id 集合求差集，输出新增/删除图片 id。
 */
import type { CopyPackage, DeliverableDiff, DeliverableVersion, ImageItem } from '@workbench/shared';

/** 归一化卖点行：trim + 折叠内部连续空白（\s 含 U+3000 全角空格） */
export function normalizePoint(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

/** copy 差异：返回差异字段（不含版本号/无对比态等元信息） */
function diffCopy(from: CopyPackage, to: CopyPackage): Pick<
  DeliverableDiff,
  'addedPoints' | 'removedPoints' | 'keptPoints' | 'titleChanged' | 'outlineChanged' | 'title' | 'outline' | 'keywordChanges' | 'identical'
> {
  const fromPoints = (from.points ?? []).map(normalizePoint).filter(Boolean);
  const toPoints = (to.points ?? []).map(normalizePoint).filter(Boolean);
  const fromSet = new Set(fromPoints);
  const toSet = new Set(toPoints);

  const addedPoints = toPoints.filter((p) => !fromSet.has(p));
  const removedPoints = fromPoints.filter((p) => !toSet.has(p));
  const keptPoints = toPoints.filter((p) => fromSet.has(p));

  const titleChanged = normalizePoint(from.title) !== normalizePoint(to.title);
  const outlineChanged = normalizePoint(from.outline) !== normalizePoint(to.outline);

  const fromKws = (from.keywords ?? []).map(normalizePoint).filter(Boolean);
  const toKws = (to.keywords ?? []).map(normalizePoint).filter(Boolean);
  const fromKwSet = new Set(fromKws);
  const toKwSet = new Set(toKws);
  const keywordChanges = {
    added: toKws.filter((k) => !fromKwSet.has(k)),
    removed: fromKws.filter((k) => !toKwSet.has(k)),
  };

  const identical =
    !titleChanged && !outlineChanged && keywordChanges.added.length === 0 && keywordChanges.removed.length === 0 && addedPoints.length === 0 && removedPoints.length === 0;

  return {
    addedPoints,
    removedPoints,
    keptPoints,
    titleChanged,
    outlineChanged,
    title: { from: from.title ?? '', to: to.title ?? '' },
    outline: { from: from.outline ?? '', to: to.outline ?? '' },
    keywordChanges,
    identical,
  };
}

/** image 差异：按 id 集合求差集 */
function diffImages(from: ImageItem[], to: ImageItem[]): Pick<DeliverableDiff, 'addedImages' | 'removedImages' | 'identical'> {
  const fromIds = new Set(from.map((i) => i.id));
  const toIds = new Set(to.map((i) => i.id));
  const addedImages = to.filter((i) => !fromIds.has(i.id)).map((i) => ({ id: i.id, name: i.name }));
  const removedImages = from.filter((i) => !toIds.has(i.id)).map((i) => ({ id: i.id, name: i.name }));
  const identical = addedImages.length === 0 && removedImages.length === 0;
  return { addedImages, removedImages, identical };
}

function parseCopyJson(content: string): CopyPackage | null {
  try {
    return JSON.parse(content) as CopyPackage;
  } catch {
    return null;
  }
}

function parseImagesJson(content: string): ImageItem[] | null {
  try {
    return JSON.parse(content) as ImageItem[];
  } catch {
    return null;
  }
}

/**
 * 计算相邻版本差异。kind 必须与两个版本的 kind 一致；不一致时按「无上一版可对比」处理并置 identical=false。
 * 返回结构始终完整（非 null、非空对象）。
 */
export function diffDeliverableVersions(from: DeliverableVersion, to: DeliverableVersion): DeliverableDiff {
  const base: DeliverableDiff = {
    fromVersion: from.version,
    toVersion: to.version,
    hasPrevious: true,
    identical: false,
    addedPoints: [],
    removedPoints: [],
    keptPoints: [],
    titleChanged: false,
    outlineChanged: false,
    keywordChanges: { added: [], removed: [] },
    addedImages: [],
    removedImages: [],
  };

  if (from.kind !== to.kind) {
    base.identical = false;
    return base;
  }

  if (from.kind === 'copy') {
    const fp = parseCopyJson(from.content);
    const tp = parseCopyJson(to.content);
    if (!fp || !tp) return base;
    return { ...base, ...diffCopy(fp, tp) };
  }

  const fi = parseImagesJson(from.content);
  const ti = parseImagesJson(to.content);
  if (!fi || !ti) return base;
  return { ...base, ...diffImages(fi, ti) };
}

/** 无上一版可对比的明确状态（仅 v1 时） */
export function noPreviousDiff(version: number): DeliverableDiff {
  return {
    fromVersion: null,
    toVersion: version,
    hasPrevious: false,
    identical: false,
    addedPoints: [],
    removedPoints: [],
    keptPoints: [],
    titleChanged: false,
    outlineChanged: false,
    keywordChanges: { added: [], removed: [] },
    addedImages: [],
    removedImages: [],
  };
}
