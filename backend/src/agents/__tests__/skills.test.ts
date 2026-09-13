/**
 * 技能分类与目录感知查找（skill-category-sections）：
 * - parseSkillMeta：目录默认分类 / 文件头「> 分类：」覆盖 / 未知值原样保留
 * - listSkills：真实 skills 目录扫描——id 唯一、分类正确、电商 → 小红书 → 通用 排序
 * - readSkillContent：冷启动（未经过 listSkills）也能读到分类子目录中的技能（防静默注入为空的关键回归）
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { parseSkillMeta, listSkills, readSkillContent, resetSkillIndexForTest, categoryRank } = await import('../skills.ts');

describe('skills.parseSkillMeta 分类解析', () => {
  test('无「> 分类：」时使用目录给定的默认分类', () => {
    const meta = parseSkillMeta('demo', '# 演示技能\n\n> 描述：测试用\n\n正文', '电商');
    assert.equal(meta.category, '电商');
    assert.equal(meta.name, '演示技能');
    assert.equal(meta.description, '测试用');
  });

  test('文件头「> 分类：」覆盖目录默认值', () => {
    const meta = parseSkillMeta('demo', '# 演示技能\n\n> 描述：测试用\n> 分类：小红书\n\n正文', '通用');
    assert.equal(meta.category, '小红书');
  });

  test('未知分类值原样保留（不静默归并进通用）', () => {
    const meta = parseSkillMeta('demo', '# 演示技能\n> 分类：短视频\n\n正文', '通用');
    assert.equal(meta.category, '短视频');
  });

  test('缺标题/描述时回退 id 与占位描述；空分类回退通用', () => {
    const meta = parseSkillMeta('fallback-id', '正文没有元数据', '');
    assert.equal(meta.name, 'fallback-id');
    assert.equal(meta.description, '（无描述）');
    assert.equal(meta.category, '通用');
  });
});

describe('skills.categoryRank 排序权重', () => {
  test('电商 < 小红书 < 通用 < 未知分类', () => {
    assert.ok(categoryRank('电商') < categoryRank('小红书'));
    assert.ok(categoryRank('小红书') < categoryRank('通用'));
    assert.ok(categoryRank('通用') < categoryRank('短视频'));
  });
});

describe('skills.listSkills / readSkillContent 目录感知', () => {
  test('真实技能目录：7 个技能、id 唯一、分类正确、按分类排序', async () => {
    const skills = await listSkills();
    const ids = skills.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, '技能 id 必须唯一');
    const byId = new Map(skills.map((s) => [s.id, s]));
    for (const [id, expectCategory] of [
      ['电商文案模板', '电商'],
      ['SEO 关键词', '电商'],
      ['电商视觉规范', '电商'],
      ['小红书合规违禁词清单', '小红书'],
      ['质检清单', '通用'],
      ['知识库整理', '通用'],
      ['素材结构化', '通用'],
    ] as const) {
      const s = byId.get(id);
      assert.ok(s, `缺少技能：${id}`);
      assert.equal(s.category, expectCategory, `${id} 分类应为 ${expectCategory}`);
      assert.ok(s.name.length > 0);
    }
    // 排序：所有「电商」在「小红书」之前，所有「小红书」在「通用」之前
    const rank = skills.map((s) => categoryRank(s.category));
    assert.deepEqual(rank, [...rank].sort((a, b) => a - b));
  });

  test('冷启动直读：未经过 listSkills 也能读到分类子目录中的技能全文', async () => {
    resetSkillIndexForTest(); // 模拟进程重启后第一个调用就是 readSkillContent 的工作流执行路径
    const content = await readSkillContent('小红书合规违禁词清单'); // 位于 xhs/ 子目录，扁平查找必然失败
    assert.ok(content.includes('绝对化用语'), '冷启动必须经索引命中子目录技能，否则注入静默变空');
  });

  test('全部技能经索引可取到非空全文', async () => {
    const skills = await listSkills();
    assert.ok(skills.length >= 7);
    for (const s of skills) {
      const content = await readSkillContent(s.id);
      assert.ok(content.length > 0, `技能 ${s.id} 全文为空`);
    }
  });

  test('不存在的技能返回空串而非抛错（保持既有降级行为）', async () => {
    assert.equal(await readSkillContent('不存在的技能'), '');
    assert.equal(await readSkillContent('../escape'), '');
  });
});
