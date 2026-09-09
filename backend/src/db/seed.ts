import { ECOM_WORKFLOW, WORKFLOW_ID, WORKFLOW_NAME } from '@workbench/shared';
import { CHANNEL } from '../config.ts';
import { get, run, tx } from './client.ts';
import { ensureSchema } from './ensure.ts';

/** 预置 Agent 岗位（线框原型：美美/平平/波波；模型为默认值，可在工位设置中修改） */
export const SEED_AGENTS = [
  {
    id: 'agent-copy',
    name: '美美',
    role: '文案',
    persona: '产品文案专家，擅长提炼卖点与转化话术；输出结构化文案包（标题/5条核心卖点/详情大纲/关键词清单）。语气专业、简洁。',
    model: 'deepseek-chat',
    skills: JSON.stringify(['电商文案模板', 'SEO 关键词']),
    files: JSON.stringify(['品牌手册.pdf']),
  },
  {
    id: 'agent-design',
    name: '平平',
    role: '设计师',
    persona: '电商视觉设计师，负责主图与详情图；构图干净、卖点清晰，输出白底图+场景图组。',
    model: 'gpt-image-2',
    skills: JSON.stringify(['电商视觉规范']),
    files: JSON.stringify(['品牌视觉规范.pdf']),
  },
  {
    id: 'agent-supervisor',
    name: '波波',
    role: '主管',
    persona: '质检主管，跨产出物一致性校对（文案与图片信息一致、规格完整、平台合规），输出校对报告与修改意见单。',
    model: 'deepseek-chat',
    skills: JSON.stringify(['质检清单']),
    files: JSON.stringify([]),
  },
] as const;

/** 确保预置数据存在（幂等） */
export function seed(): void {
  ensureSchema();
  tx(() => {
    const now = new Date().toISOString();
    for (const a of SEED_AGENTS) {
      const exists = get<{ id: string }>('SELECT id FROM agents WHERE id = ?', [a.id]);
      if (!exists) {
        run(
          'INSERT INTO agents (id,name,role,persona,model,skills,files,online_status,activity,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [a.id, a.name, a.role, a.persona, a.model, a.skills, a.files, 'idle', '待命', now],
        );
      }
    }
    const wf = get<{ id: string }>('SELECT id FROM workflows WHERE id = ?', [WORKFLOW_ID]);
    if (!wf) {
      run('INSERT INTO workflows (id,name,stages_json) VALUES (?,?,?)', [WORKFLOW_ID, WORKFLOW_NAME, JSON.stringify(ECOM_WORKFLOW)]);
    }
    const mode = get<{ key: string }>('SELECT key FROM settings WHERE key = ?', ['orchestrationMode']);
    if (!mode) {
      run('INSERT INTO settings (key,value) VALUES (?,?)', ['orchestrationMode', JSON.stringify({ mode: 'graph' })]);
    }
    const llm = get<{ key: string }>('SELECT key FROM settings WHERE key = ?', ['llmChannels']);
    if (!llm) {
      // 默认 LLM 渠道（DeepSeek 官方，密钥来自 backend/.env.local，仅存本机）
      run('INSERT INTO settings (key,value) VALUES (?,?)', [
        'llmChannels',
        JSON.stringify({
          'agent-copy': { baseUrl: CHANNEL.llm.baseUrl, apiKey: CHANNEL.llm.apiKey, model: CHANNEL.llm.model },
          'agent-supervisor': { baseUrl: CHANNEL.llm.baseUrl, apiKey: CHANNEL.llm.apiKey, model: CHANNEL.llm.model },
        }),
      ]);
    }
    const img = get<{ key: string }>('SELECT key FROM settings WHERE key = ?', ['imageChannel']);
    if (!img) {
      // 默认生图渠道（dsh-imagegen 默认渠道 gpt-image-2）
      run('INSERT INTO settings (key,value) VALUES (?,?)', [
        'imageChannel',
        JSON.stringify({ baseUrl: CHANNEL.image.baseUrl, apiKey: CHANNEL.image.apiKey, model: CHANNEL.image.model }),
      ]);
    }
  });
}

export function getOrchestrationMode(): 'graph' | 'linear' {
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['orchestrationMode']);
  try {
    const v = row ? (JSON.parse(row.value) as { mode?: string }) : undefined;
    return v?.mode === 'linear' ? 'linear' : 'graph';
  } catch {
    return 'graph';
  }
}
