/**
 * 目录中文显示名映射（意见 #5，用户定案）。
 *
 * 边界（重要）：**绝不重命名 Vault 内的真实文件夹**——真实重命名会改动用户的 Obsidian
 * 文件系统，并使既有 wiki 链接失效。这里只做「界面显示名」映射：
 * - 目录树显示中文名（产品资料 / 品牌规范 / 灵感库 …）
 * - 真实路径始终保留在 title 提示与「知识库设置」里，用户随时可查
 *
 * 匹配规则：按路径的**最后一段**查表；查不到则原样显示该段（不认识的结构不会被误改名）。
 */

/** 已知目录段 → 中文显示名。键名小写比较，兼容大小写差异。 */
const SEGMENT_LABELS: Record<string, string> = {
  // 常见 Vault 结构
  products: '产品资料',
  product: '产品资料',
  brand: '品牌规范',
  brands: '品牌规范',
  wiki: '知识库',
  docs: '文档',
  doc: '文档',
  topics: '主题',
  topic: '主题',
  inbox: '收件箱',
  inspiration: '灵感库',
  inspirations: '灵感库',
  ideas: '灵感库',
  drafts: '草稿',
  draft: '草稿',
  skills: 'Skill 素材',
  skill: 'Skill 素材',
  assets: '素材',
  archive: '归档',
  // 数字前缀的原料层（Obsidian 常见编号约定）
  '10_raw': '原始资料',
  '20_products': '产品资料',
  '30_topics': '主题',
  '40_output': '产出',
  raw: '原始资料',
  output: '产出',
};

/**
 * 取目录的中文显示名。
 * @param dir 相对 Vault 根的目录路径，如 `10_raw/products`
 * @returns 中文显示名；未收录的段回退为原段名（不做猜测）
 */
export function dirDisplayName(dir: string): string {
  if (!dir) return '全部文档';
  const seg = dir.split('/').filter(Boolean).pop() ?? dir;
  return SEGMENT_LABELS[seg.toLowerCase()] ?? seg;
}

/** 目录的中文全路径显示名，如 `10_raw/products` → `原始资料 / 产品资料` */
export function dirDisplayPath(dir: string): string {
  if (!dir) return '全部文档';
  return dir
    .split('/')
    .filter(Boolean)
    .map((s) => SEGMENT_LABELS[s.toLowerCase()] ?? s)
    .join(' / ');
}
