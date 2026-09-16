/**
 * 内置 Agent 的挂载意图 —— 唯一权威来源。
 *
 * 为什么单独抽一个模块：挂载意图此前散落在 seed.ts（新库）与 ensure.ts（旧库迁移）两处，
 * 两边各写一份、又没有共同的真相来源，于是出现「代码改了、存量库没改」的漂移
 * （workflow_skills / workflow_files 是后加的列，存量行只拿到 DEFAULT '{}'；
 *   而 seed() 对已存在的 Agent 只同步 name，persona/model/skills/files 属用户领地不被覆盖）。
 * 抽成单表后，新库（seed 直写）与旧库（ensure 回填修正）都从这里取值，不会再各写一份。
 *
 * 分份语义（用户定案：不同工作流只挂自己那一份）：
 * - workflowSkills[workflowId] / workflowFiles[workflowId] 是该工作流的份；
 * - **空数组是有效值**，表示「这条工作流上不挂任何东西」，不会被全局回退顶掉
 *   （回退只在「份缺失（键不存在）」时发生，空数组是 truthy，会原样生效）；
 * - 全局 skills / files 是各份的并集视图（只读派生，由路由层与回填逻辑维护）。
 */
export interface BuiltinAgentMount {
  /** 全局并集视图：分份齐备时由各份取并集；无分份的通用岗（如助理）直接用此值 */
  skills: string[];
  /** 全局并集视图（Vault 相对路径） */
  files: string[];
  /** 按工作流分份的技能挂载；键的工作流不存在时保留原值不覆盖 */
  workflowSkills?: Record<string, string[]>;
  /** 按工作流分份的文件挂载（Vault 相对路径） */
  workflowFiles?: Record<string, string[]>;
}

/** 内置工作流 id（与 packages/shared/src/workflow.ts 保持一致；此处为避免循环依赖用字面量） */
const ECOM = 'ecom-new-listing';
const XHS = 'xhs-note';

/**
 * 四个内置岗位的挂载意图。
 * 角色语义：美美文案（写作技能）、平平设计师（视觉规范）、波波主管（质检清单）、依依助理（知识库整理）。
 * 注意：平平的小红书份刻意留空 —— 技能库里目前没有「小红书视觉规范」这一件，
 * 按「不同工作流只挂自己那一份」的模型，空数组比把电商视觉规范串过去更正确；
 * 这是内容缺件（待补《小红书视觉规范》技能），不是配置错误。
 */
export const BUILTIN_AGENT_MOUNTS: Record<string, BuiltinAgentMount> = {
  'agent-copy': {
    skills: ['电商文案模板', 'SEO 关键词', '小红书合规违禁词清单'],
    files: ['知识库/品牌规范/品牌手册.md'],
    workflowSkills: {
      [ECOM]: ['电商文案模板', 'SEO 关键词'],
      [XHS]: ['小红书合规违禁词清单'],
    },
    workflowFiles: {
      [ECOM]: ['知识库/品牌规范/品牌手册.md'],
      [XHS]: [],
    },
  },
  'agent-design': {
    skills: ['电商视觉规范'],
    files: ['知识库/品牌规范/品牌视觉规范.md'],
    workflowSkills: {
      [ECOM]: ['电商视觉规范'],
      // 小红书视觉规范尚未沉淀；留空表示该工作流不挂（勿串电商技能）
      [XHS]: [],
    },
    workflowFiles: {
      [ECOM]: ['知识库/品牌规范/品牌视觉规范.md'],
      [XHS]: [],
    },
  },
  'agent-supervisor': {
    skills: ['质检清单'],
    files: [],
    // 质检清单是通用技能，两条工作流都要：显式给两份，避免依赖全局回退
    workflowSkills: {
      [ECOM]: ['质检清单'],
      [XHS]: ['质检清单'],
    },
  },
  'agent-assistant': {
    // 助理不参与任何工作流（AGENT_BY_ROLE 无「助理」），技能本身与工作流无关，
    // 故不设分份，直接用全局值（回退即正确值）。
    skills: ['知识库整理', '素材结构化'],
    files: [],
  },
};

/* ===== 分份挂载的 JSON 解析与并集工具（db 层共用，ensure.ts 与 agents/mount-repoint.ts 都取自这里） ===== */

/** 把分份 JSON 列安全解析为「工作流 id → 条目数组」；坏行/非对象一律回退 {}（保持既有容错语义） */
export function parseParts(json: string | null | undefined): Record<string, string[]> {
  if (!json) return {};
  try {
    const v = JSON.parse(json) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string[]> = {};
    for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
      if (Array.isArray(val) && val.every((x) => typeof x === 'string')) out[key] = val as string[];
    }
    return out;
  } catch {
    return {};
  }
}

/** 把 JSON 列安全解析为字符串数组；坏行/非数组一律回退 [] */
export function parseList(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 权威表的份覆盖到现值上：只覆盖表里声明的键，未声明的键（含未来新增工作流）保留原值 */
export function overlayParts(
  current: Record<string, string[]>,
  target: Record<string, string[]> | undefined,
): Record<string, string[]> {
  if (!target) return current;
  return { ...current, ...target };
}

/** 各份取并集（去重、保持首现顺序）——全局 skills/files 是只读派生视图 */
export function unionOfParts(parts: Record<string, string[]>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of Object.values(parts)) {
    for (const item of list) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}
