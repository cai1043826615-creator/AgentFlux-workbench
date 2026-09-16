/**
 * 挂载随改名/移动自动跟随（OpenSpec change mount-rename-follow，独立进程测试）。
 *
 * 覆盖：认定规则（改名/歧义/删除/无基线/防串认）、改写语义（分份+并集同步、去重、命名空间隔离、
 * 多 Agent 全跟随）、幂等、以及技能目录扫描的端到端接入（含首轮建基线、无基线不跟随）。
 * 环境：临时 DB + 临时技能目录，不碰真实数据。
 */
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'workbench-mount-rename-'));
process.env.WORKBENCH_DB = join(dir, 'rename.db');
const skillsRoot = join(dir, '技能库');
process.env.WORKBENCH_SKILLS_ROOT = skillsRoot;

const { ensureSchema } = await import('../../db/ensure.ts');
const { seed } = await import('../../db/seed.ts');
const { get, run } = await import('../../db/client.ts');
const {
  SNAPSHOT_DOCS,
  SNAPSHOT_SKILLS,
  contentHash,
  diffCatalog,
  followCatalogChanges,
  readCatalogSnapshot,
  repointMounts,
  saveCatalogSnapshot,
} = await import('../mount-repoint.ts');
const { invalidateSkillIndex, readSkillContent } = await import('../skills.ts');

ensureSchema();
seed();

const ROUTE = 'ecom-new-listing';

/** 写入某 Agent 的技能分份挂载（并同步并集视图，模拟 PUT /api/agents/:id 的语义） */
function setSkillMount(agentId: string, parts: Record<string, string[]>): void {
  const union = [...new Set(Object.values(parts).flat())];
  run('UPDATE agents SET workflow_skills = ?, skills = ? WHERE id = ?', [JSON.stringify(parts), JSON.stringify(union), agentId]);
}

/** 读回某 Agent 的技能挂载 */
function skillMountOf(agentId: string): { parts: Record<string, string[]>; union: string[] } {
  const row = get<{ workflow_skills: string; skills: string }>('SELECT workflow_skills, skills FROM agents WHERE id = ?', [agentId])!;
  return { parts: JSON.parse(row.workflow_skills), union: JSON.parse(row.skills) };
}

describe('diffCatalog：改名/移动认定规则（宁漏不误）', () => {
  const h = (s: string) => contentHash(s);

  test('内容未变的改名被认定', () => {
    assert.deepEqual(diffCatalog([{ ref: 'A.md', hash: h('same') }], [{ ref: 'B.md', hash: h('same') }]), [{ from: 'A.md', to: 'B.md' }]);
  });

  test('引用仍存在 ⇒ 不认定（无需跟随）', () => {
    const old = [{ ref: 'A.md', hash: h('same') }];
    const next = [{ ref: 'A.md', hash: h('same') }, { ref: 'B.md', hash: h('same') }];
    assert.deepEqual(diffCatalog(old, next), []);
  });

  test('改名同时改了内容 ⇒ 不认定（指纹对不上）', () => {
    assert.deepEqual(diffCatalog([{ ref: 'A.md', hash: h('old') }], [{ ref: 'B.md', hash: h('edited') }]), []);
  });

  test('内容相同的两份候选 ⇒ 歧义，不认定', () => {
    const old = [{ ref: 'A.md', hash: h('same') }];
    const next = [{ ref: 'B.md', hash: h('same') }, { ref: 'C.md', hash: h('same') }];
    assert.deepEqual(diffCatalog(old, next), []);
  });

  test('删除 ⇒ 不认定（不得误判为改名）', () => {
    assert.deepEqual(diffCatalog([{ ref: 'A.md', hash: h('gone') }], [{ ref: 'B.md', hash: h('other') }]), []);
  });

  test('无基线（首次升级）⇒ 不认定', () => {
    assert.deepEqual(diffCatalog([], [{ ref: 'B.md', hash: h('x') }]), []);
  });

  test('两个旧引用认领同一新引用 ⇒ 全部丢弃（防串认）', () => {
    const old = [{ ref: 'A.md', hash: h('same') }, { ref: 'A2.md', hash: h('same') }];
    assert.deepEqual(diffCatalog(old, [{ ref: 'B.md', hash: h('same') }]), []);
  });

  test('无指纹记录 ⇒ 跳过', () => {
    assert.deepEqual(diffCatalog([{ ref: 'A.md', hash: '' }], [{ ref: 'B.md', hash: '' }]), []);
  });
});

describe('repointMounts：静默改写挂载', () => {
  test('分份与并集同步改写，并集不残留旧引用', () => {
    setSkillMount('agent-copy', { [ROUTE]: ['旧技能', 'SEO 关键词'], 'xhs-note': ['旧技能'] });
    const touched = repointMounts(SNAPSHOT_SKILLS, [{ from: '旧技能', to: '新技能' }]);
    assert.equal(touched, 1);
    const { parts, union } = skillMountOf('agent-copy');
    assert.deepEqual(parts[ROUTE], ['新技能', 'SEO 关键词']);
    assert.deepEqual(parts['xhs-note'], ['新技能']);
    assert.ok(union.includes('新技能'), '并集应含新引用');
    assert.ok(!union.includes('旧技能'), '并集不得残留旧引用');
  });

  test('去重：旧引用与已存在的新引用共存时不产生重复条目', () => {
    setSkillMount('agent-copy', { [ROUTE]: ['旧技能', '新技能'] });
    repointMounts(SNAPSHOT_SKILLS, [{ from: '旧技能', to: '新技能' }]);
    assert.deepEqual(skillMountOf('agent-copy').parts[ROUTE], ['新技能']);
  });

  test('无分份的通用岗：直接改写全局列（依依）', () => {
    run("UPDATE agents SET workflow_skills = '{}', skills = ? WHERE id = 'agent-assistant'", [JSON.stringify(['旧技能'])]);
    assert.equal(repointMounts(SNAPSHOT_SKILLS, [{ from: '旧技能', to: '新技能' }]), 1);
    assert.deepEqual(skillMountOf('agent-assistant').union, ['新技能']);
  });

  test('命名空间隔离：技能类改名不得影响文件挂载', () => {
    run("UPDATE agents SET workflow_files = ?, files = ? WHERE id = 'agent-copy'", [
      JSON.stringify({ [ROUTE]: ['知识库/旧.md'] }),
      JSON.stringify(['知识库/旧.md']),
    ]);
    repointMounts(SNAPSHOT_SKILLS, [{ from: '知识库/旧.md', to: '知识库/新.md' }]);
    const row = get<{ workflow_files: string }>("SELECT workflow_files FROM agents WHERE id = 'agent-copy'")!;
    assert.deepEqual(JSON.parse(row.workflow_files)[ROUTE], ['知识库/旧.md'], '技能类改名不应动文件挂载');
  });

  test('多个 Agent 挂同一引用 ⇒ 全部跟随', () => {
    for (const id of ['agent-copy', 'agent-design']) setSkillMount(id, { [ROUTE]: ['旧技能'] });
    assert.equal(repointMounts(SNAPSHOT_SKILLS, [{ from: '旧技能', to: '新技能' }]), 2);
    for (const id of ['agent-copy', 'agent-design']) assert.deepEqual(skillMountOf(id).parts[ROUTE], ['新技能']);
  });

  test('空映射 / 映射到自身 ⇒ 不改写（幂等）', () => {
    setSkillMount('agent-copy', { [ROUTE]: ['技能甲'] });
    assert.equal(repointMounts(SNAPSHOT_SKILLS, []), 0);
    assert.equal(repointMounts(SNAPSHOT_SKILLS, [{ from: '技能甲', to: '技能甲' }]), 0);
  });
});

describe('followCatalogChanges：基线比对 + 幂等', () => {
  test('识别改名后写入挂载；重复比对不再改写', () => {
    const before = [{ ref: 'X', hash: contentHash('x') }];
    const after = [{ ref: 'Y', hash: contentHash('x') }];

    saveCatalogSnapshot(SNAPSHOT_SKILLS, before);
    setSkillMount('agent-copy', { [ROUTE]: ['X'] });

    // 目录未变 ⇒ 无改写
    assert.deepEqual(followCatalogChanges(SNAPSHOT_SKILLS, readCatalogSnapshot(SNAPSHOT_SKILLS), before), []);

    // 改名 ⇒ 一次改写
    assert.deepEqual(followCatalogChanges(SNAPSHOT_SKILLS, readCatalogSnapshot(SNAPSHOT_SKILLS), after), [{ from: 'X', to: 'Y' }]);
    assert.deepEqual(skillMountOf('agent-copy').parts[ROUTE], ['Y']);

    // 落新基线后再比对 ⇒ 无改写（幂等）
    saveCatalogSnapshot(SNAPSHOT_SKILLS, after);
    assert.deepEqual(followCatalogChanges(SNAPSHOT_SKILLS, readCatalogSnapshot(SNAPSHOT_SKILLS), after), []);
  });

  test('文件类（SNAPSHOT_DOCS）移动后跟随：workflow_files 与 files 同步改写', () => {
    const hash = contentHash('文件正文');
    const setFiles = (parts: Record<string, string[]>) => {
      const union = [...new Set(Object.values(parts).flat())];
      run('UPDATE agents SET workflow_files = ?, files = ? WHERE id = ?', [JSON.stringify(parts), JSON.stringify(union), 'agent-copy']);
    };
    setFiles({ [ROUTE]: ['知识库/品牌规范/旧名.md'] });
    saveCatalogSnapshot(SNAPSHOT_DOCS, [{ ref: '知识库/品牌规范/旧名.md', hash }]);

    const renames = followCatalogChanges(
      SNAPSHOT_DOCS,
      readCatalogSnapshot(SNAPSHOT_DOCS),
      [{ ref: '知识库/复盘/新名.md', hash }], // 换了目录 + 改了名，内容未变
    );
    assert.deepEqual(renames, [{ from: '知识库/品牌规范/旧名.md', to: '知识库/复盘/新名.md' }]);

    const row = get<{ workflow_files: string; files: string }>("SELECT workflow_files, files FROM agents WHERE id = 'agent-copy'")!;
    assert.deepEqual(JSON.parse(row.workflow_files)[ROUTE], ['知识库/复盘/新名.md']);
    assert.deepEqual(JSON.parse(row.files), ['知识库/复盘/新名.md'], '并集应同步为新路径');
  });
});

describe('技能目录扫描接入（端到端）', () => {
  test('首轮建立基线 → 改名 → 下一轮静默跟随', async () => {
    mkdirSync(join(skillsRoot, '通用'), { recursive: true });
    writeFileSync(join(skillsRoot, '通用', '甲技能.md'), '# 甲技能\n\n> 描述：甲\n> 分类：通用\n\n正文甲\n', 'utf8');
    writeFileSync(join(skillsRoot, '通用', '乙技能.md'), '# 乙技能\n\n> 描述：乙\n> 分类：通用\n\n正文乙\n', 'utf8');
    run('DELETE FROM catalog_snapshot WHERE kind = ?', [SNAPSHOT_SKILLS]);
    setSkillMount('agent-copy', { [ROUTE]: ['甲技能'] });

    // 第一轮扫描：建立基线（此时无基线，故不跟随任何东西）
    invalidateSkillIndex();
    await readSkillContent('甲技能');
    const baseline = readCatalogSnapshot(SNAPSHOT_SKILLS);
    assert.ok(baseline.some((e) => e.ref === '甲技能'), '首轮扫描应建立基线');
    assert.ok(baseline.some((e) => e.ref === '乙技能'), '同目录其它技能也应入基线');

    // 改名（内容不变）后重扫
    renameSync(join(skillsRoot, '通用', '甲技能.md'), join(skillsRoot, '通用', '甲技能改名.md'));
    invalidateSkillIndex();
    await readSkillContent('甲技能改名');

    assert.deepEqual(skillMountOf('agent-copy').parts[ROUTE], ['甲技能改名'], '改名应被静默跟随');
  });

  test('无基线时不跟随；且「本次之前就已失效」的挂载不可追溯（与引入本功能前行为一致）', async () => {
    // 清空基线，模拟「首次升级」：本功能上线前就已经失效的挂载，没有任何指纹可供反查
    run('DELETE FROM catalog_snapshot WHERE kind = ?', [SNAPSHOT_SKILLS]);
    setSkillMount('agent-copy', { [ROUTE]: ['甲技能改名'] });
    renameSync(join(skillsRoot, '通用', '甲技能改名.md'), join(skillsRoot, '通用', '丙技能.md'));

    invalidateSkillIndex();
    await readSkillContent('丙技能');
    assert.deepEqual(skillMountOf('agent-copy').parts[ROUTE], ['甲技能改名'], '无基线不得跟随');

    // 基线已就位 ⇒ 之后发生的改名可以跟随（用挂载指向的、且在基线里的引用验证）
    assert.ok(readCatalogSnapshot(SNAPSHOT_SKILLS).some((e) => e.ref === '丙技能'), '本轮之后的基线应含新 id');
    setSkillMount('agent-copy', { [ROUTE]: ['丙技能'] });
    renameSync(join(skillsRoot, '通用', '丙技能.md'), join(skillsRoot, '通用', '丁技能.md'));
    invalidateSkillIndex();
    await readSkillContent('丁技能');
    assert.deepEqual(skillMountOf('agent-copy').parts[ROUTE], ['丁技能'], '基线就位后的下一轮应能跟随');

    // 已知限制：错过的跟随不可追溯——「甲技能改名」从未进过任何基线，之后无论怎么改名都接不回来
    assert.ok(
      !readCatalogSnapshot(SNAPSHOT_SKILLS).some((e) => e.ref === '甲技能改名'),
      '旧的失效引用不会进基线（无指纹可记），因此无法追溯修复，需手动重挂',
    );
  });
});

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 临时目录清理失败不影响测试结论 */
  }
});
