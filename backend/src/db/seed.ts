import { ECOM_WORKFLOW, WORKFLOW_ID, WORKFLOW_NAME, XHS_WORKFLOW, XHS_WORKFLOW_ID, XHS_WORKFLOW_NAME, type WorkflowDefinition } from '@workbench/shared';
import { CHANNEL } from '../config.ts';
import { get, run, tx } from './client.ts';
import { BUILTIN_AGENT_MOUNTS } from './agent-mounts.ts';
import { ensureSchema } from './ensure.ts';

/**
 * 工作流定义阶段存在性自检（D-01 补齐：同步前校验内部一致性，启动日志可见）。
 * 检查项：阶段 id 非空且唯一；每条边（next/approval/rollback）的 from/to 都指向已存在的阶段；
 * 并行分组 items 非空（items 是子任务 id，不要求等于阶段 id）。
 * 校验失败 → 打强告警日志并拒绝覆盖（保留库内既有定义），
 * 避免把「悬空边 / 重复阶段」的坏定义写入运行时权威表导致阶段推进静默找不到节点。
 */
function validateWorkflowDefinition(def: WorkflowDefinition): boolean {
  const ids = (def.nodes ?? []).map((n) => n.id);
  const idSet = new Set(ids);
  const problems: string[] = [];
  if (ids.length === 0) problems.push('nodes 为空（工作流没有任何阶段）');
  if (idSet.size !== ids.length) problems.push('存在重复的阶段 id');
  for (const e of def.edges ?? []) {
    if (!e.from || !idSet.has(e.from)) problems.push(`边起点阶段不存在：${e.from ?? '(空)'}`);
    if (!e.to || !idSet.has(e.to)) problems.push(`边目标阶段不存在：${e.to ?? '(空)'}`);
  }
  for (const n of def.nodes ?? []) {
    for (const g of n.parallelGroups ?? []) {
      if (!Array.isArray(g.items) || g.items.length === 0) problems.push(`阶段「${n.id}」存在空并行分组`);
    }
  }
  if (problems.length === 0) return true;
  console.error(
    `[workbench] 工作流「${def.name ?? def.id}」定义自检未通过（${problems.length} 处），已拒绝同步覆盖：\n- ${problems.slice(0, 8).join('\n- ')}`,
  );
  return false;
}

/**
 * 内置工作流同步（启动自检）：
 * 库内 stages_json 是运行时权威定义，但历史上出现过与代码不一致（如 detail-image 的
 * approvalPoint 丢失 → 详情图跳过人工确认直通归档；XHS 阶段重排后库里仍是旧结构）。
 * 原 if(!wf) 幂等插入不覆盖已有记录，导致「代码改了却不生效」。
 * 这里改为：内置工作流以代码常量为准强制同步，不一致时覆盖并打日志。
 * （自定义工作流 id 不在内置表里，不受影响。）
 * 同步前先做阶段存在性校验（validateWorkflowDefinition）：定义损坏时拒绝覆盖，保留库内旧定义。
 */
function syncBuiltinWorkflow(id: string, name: string, def: unknown): void {
  if (!validateWorkflowDefinition(def as WorkflowDefinition)) return;
  const row = get<{ name: string; stages_json: string }>('SELECT name, stages_json FROM workflows WHERE id = ?', [id]);
  const json = JSON.stringify(def);
  if (!row) {
    run('INSERT INTO workflows (id,name,stages_json) VALUES (?,?,?)', [id, name, json]);
    console.log(`[workbench] 工作流已创建：${id}`);
    return;
  }
  if (row.stages_json === json) return;
  run('UPDATE workflows SET name = ?, stages_json = ? WHERE id = ?', [name, json, id]);
  console.warn(`[workbench] 工作流定义与代码不一致，已同步覆盖：${id}`);
}

/**
 * 预置 Agent 岗位（线框原型：美美/平平/波波/依依；模型为默认值，可在工位设置中修改）。
 * 挂载（skills / files / 分份）不在此处硬写，统一取自 agent-mounts.ts 的 BUILTIN_AGENT_MOUNTS，
 * 与 ensure.ts 的旧库回填共用同一份权威表，避免两处各写一份而漂移。
 */
export const SEED_AGENTS = [
  {
    id: 'agent-copy',
    name: '美美',
    role: '文案',
    persona: '产品文案专家，擅长提炼卖点与转化话术；输出结构化文案包（标题/5条核心卖点/详情大纲/关键词清单）。语气专业、简洁。',
    model: 'deepseek-chat',
  },
  {
    id: 'agent-design',
    name: '平平',
    role: '设计师',
    persona: '电商视觉设计师，负责主图与详情图；构图干净、卖点清晰，输出白底图+场景图组。',
    model: 'gpt-image-2',
  },
  {
    id: 'agent-supervisor',
    name: '波波',
    role: '主管',
    persona: '质检主管，跨产出物一致性校对（文案与图片信息一致、规格完整、平台合规），输出校对报告与修改意见单。',
    model: 'deepseek-chat',
  },
  {
    // P2·F3：知识库小助理「依依」。不参与电商工作流（AGENT_BY_ROLE 三角色白名单不含「助理」），
    // 只做知识库侧整理（文档→md / 热点素材卡 / 知识库体检），产出一律进草稿区，对 Vault 只读。
    id: 'agent-assistant',
    name: '依依',
    role: '助理',
    persona: '知识库整理助理，负责把产品资料与每日热点素材整理成结构化 Markdown（保留关键事实与来源路径），并能对知识库做体检给出整理建议（重复主题/缺失标签/可互链孤岛）。只读知识库，绝不修改 Vault 内任何文件。',
    model: 'deepseek-chat',
  },
] as const;

/** 确保预置数据存在（幂等） */
export function seed(): void {
  ensureSchema();
  tx(() => {
    const now = new Date().toISOString();
    for (const a of SEED_AGENTS) {
      const exists = get<{ id: string; name: string }>('SELECT id, name FROM agents WHERE id = ?', [a.id]);
      if (!exists) {
        const mount = BUILTIN_AGENT_MOUNTS[a.id];
        run(
          'INSERT INTO agents (id,name,role,persona,model,skills,files,workflow_skills,workflow_files,online_status,activity,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          [
            a.id,
            a.name,
            a.role,
            a.persona,
            a.model,
            JSON.stringify(mount?.skills ?? []),
            JSON.stringify(mount?.files ?? []),
            JSON.stringify(mount?.workflowSkills ?? {}),
            JSON.stringify(mount?.workflowFiles ?? {}),
            'idle',
            '待命',
            now,
          ],
        );
      } else if (exists.name !== a.name) {
        // P2·新1：内置 Agent 的显示名以 seed 为准同步（如小助理「涵涵」→「依依」）。
        // 只同步姓名——人设/模型/技能/挂载仍归用户，不被 seed 覆盖。
        // 注意：显示名是**代码持续拥有**的（每次启动都会同步）；挂载只在旧库做过一次性修复，
        // 之后完全归用户（见 ensure.ts 的 repairBuiltinAgentMounts 与 settings 标记）。
        run('UPDATE agents SET name = ? WHERE id = ?', [a.name, a.id]);
      }
    }
    // ===== 工作流定义同步（启动自检）=====
    // 背景：库内的 stages_json 是「运行时的权威定义」，但历史上出现过库与代码不一致
    // （例：detail-image 的 approvalPoint 丢失 → 详情图跳过人工确认直通归档；
    //   XHS 阶段重排后库里仍是旧结构）。seed 的 if(!wf) 幂等插入不会覆盖已有记录，
    // 于是代码改了却不生效。这里改为：**内置工作流以代码常量为准强制同步**，
    // 不一致时覆盖并打日志（自定义工作流 id 不在内置表里，不受影响）。
    syncBuiltinWorkflow(WORKFLOW_ID, WORKFLOW_NAME, ECOM_WORKFLOW);
    syncBuiltinWorkflow(XHS_WORKFLOW_ID, XHS_WORKFLOW_NAME, XHS_WORKFLOW);
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
