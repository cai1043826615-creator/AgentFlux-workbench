/**
 * 冒烟脚本：文件挂载能力验收（意见7：目录选择 + 上传新文件）。
 * 用法：在 backend 目录运行 `node scripts/smoke-files.ts`（Node 26 直跑 TS；临时 DB，跑完即退）。
 * 覆盖：listFiles 空目录返回 []、saveFileContent 写入后 listFiles 出现、
 *       readFileContent 读回内容一致、路径逃逸被拒、扩展名校验、
 *       GET/POST /api/agents/files 路由注册与写文件（content / dataUrl 两种模式）。
 * 说明：为避免污染仓库，测试前先把 backend/files/ 现有文件暂存到临时目录，结束后恢复。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 临时目录 DB：必须在 import db/client 之前设置 WORKBENCH_DB（files 路由不碰 DB，仅避免污染真实库）
const dir = mkdtempSync(join(tmpdir(), 'smoke-files-'));
process.env.WORKBENCH_DB = join(dir, 'smoke.db');

const { listFiles, readFileContent, saveFileContent } = await import('../src/agents/skills.ts');

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('[smoke-files] 文件挂载能力冒烟开始');

// 隔离 backend/files/：现有文件先暂存到临时目录，测试结束后恢复
const filesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'files');
await mkdir(filesDir, { recursive: true });
const stashDir = mkdtempSync(join(tmpdir(), 'smoke-files-stash-'));
const existing = await readdir(filesDir).catch(() => [] as string[]);
for (const f of existing) await rename(join(filesDir, f), join(stashDir, f));

try {
  // 1. 空目录时 listFiles 返回 []
  await check('listFiles 空目录返回空数组', async () => {
    const files = await listFiles();
    assert.deepEqual(files, []);
  });

  // 2. saveFileContent 写入后 listFiles 出现该项（id=完整文件名，name=去扩展名）
  let savedId = '';
  await check('saveFileContent 写入后 listFiles 出现', async () => {
    savedId = await saveFileContent('冒烟挂载说明.md', '品牌卖点：便携、安全、快充');
    assert.equal(savedId, '冒烟挂载说明.md');
    const files = await listFiles();
    assert.equal(files.length, 1);
    assert.equal(files[0].id, '冒烟挂载说明.md');
    assert.equal(files[0].name, '冒烟挂载说明');
  });

  // 3. readFileContent 读回内容一致
  await check('readFileContent 读回内容一致', async () => {
    assert.equal(await readFileContent(savedId), '品牌卖点：便携、安全、快充');
  });

  // 4. 路径逃逸与非法扩展名被拒
  await check('路径逃逸（../evil.md、..\\evil.md、a/b.md）被拒', async () => {
    await assert.rejects(() => saveFileContent('../evil.md', 'x'));
    await assert.rejects(() => saveFileContent('..\\evil.md', 'x'));
    await assert.rejects(() => saveFileContent('a/b.md', 'x'));
  });

  await check('非法扩展名（exe/pdf/空名）被拒', async () => {
    await assert.rejects(() => saveFileContent('evil.exe', 'x'));
    await assert.rejects(() => saveFileContent('evil.pdf', 'x'));
    await assert.rejects(() => saveFileContent('', 'x'));
  });

  // 5. 路由注册：GET /api/agents/files 返回列表
  await check('GET /api/agents/files 返回文件列表', async () => {
    const { default: Fastify } = await import('fastify');
    const { agentRoutes } = await import('../src/routes/agents.ts');
    const app = Fastify();
    await agentRoutes(app);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/agents/files' });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body) as { files: { id: string; name: string }[] };
      assert.ok(Array.isArray(body.files) && body.files.some((f) => f.id === '冒烟挂载说明.md'), '应包含刚写入的文件');
    } finally {
      await app.close();
    }
  });

  // 6. 路由注册：POST content 模式写入并返回 file
  await check('POST /api/agents/files（content 模式）写入并返回 file', async () => {
    const { default: Fastify } = await import('fastify');
    const { agentRoutes } = await import('../src/routes/agents.ts');
    const app = Fastify();
    await agentRoutes(app);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agents/files',
        payload: { name: '__smoke_route__.md', content: '路由写入：便携快充' },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body) as { file: { id: string; name: string } };
      assert.equal(body.file.id, '__smoke_route__.md');
      assert.equal(body.file.name, '__smoke_route__');
      assert.equal(await readFileContent('__smoke_route__.md'), '路由写入：便携快充');
    } finally {
      await app.close();
    }
  });

  // 7. 路由注册：POST dataUrl 模式（base64）写入
  await check('POST /api/agents/files（dataUrl 模式）写入', async () => {
    const { default: Fastify } = await import('fastify');
    const { agentRoutes } = await import('../src/routes/agents.ts');
    const app = Fastify();
    await agentRoutes(app);
    try {
      const dataUrl = `data:text/markdown;base64,${Buffer.from('dataurl 内容：安全便携', 'utf8').toString('base64')}`;
      const res = await app.inject({ method: 'POST', url: '/api/agents/files', payload: { name: '冒烟dataurl.md', dataUrl } });
      assert.equal(res.statusCode, 200);
      assert.equal((JSON.parse(res.body) as { file: { id: string } }).file.id, '冒烟dataurl.md');
      assert.equal(await readFileContent('冒烟dataurl.md'), 'dataurl 内容：安全便携');
    } finally {
      await app.close();
    }
  });

  // 8. 路由注册：dataUrl 无 name 时按媒体类型生成默认名（.json）
  await check('POST dataUrl 无 name 生成默认名', async () => {
    const { default: Fastify } = await import('fastify');
    const { agentRoutes } = await import('../src/routes/agents.ts');
    const app = Fastify();
    await agentRoutes(app);
    try {
      const dataUrl = `data:application/json;base64,${Buffer.from('{"k":1}', 'utf8').toString('base64')}`;
      const res = await app.inject({ method: 'POST', url: '/api/agents/files', payload: { dataUrl } });
      assert.equal(res.statusCode, 200);
      const id = (JSON.parse(res.body) as { file: { id: string } }).file.id;
      assert.ok(id.startsWith('上传文件_') && id.endsWith('.json'), `默认名应以上传文件_ 开头且 .json 结尾，实际 ${id}`);
    } finally {
      await app.close();
    }
  });

  // 9. 路由校验：非法扩展名 / 缺 content 与 dataUrl → 400
  await check('POST 非法扩展名与缺内容返回 400', async () => {
    const { default: Fastify } = await import('fastify');
    const { agentRoutes } = await import('../src/routes/agents.ts');
    const app = Fastify();
    await agentRoutes(app);
    try {
      const badExt = await app.inject({ method: 'POST', url: '/api/agents/files', payload: { name: 'evil.exe', content: 'x' } });
      assert.equal(badExt.statusCode, 400);
      const noContent = await app.inject({ method: 'POST', url: '/api/agents/files', payload: { name: 'x.md' } });
      assert.equal(noContent.statusCode, 400);
    } finally {
      await app.close();
    }
  });
} finally {
  // 清理测试期写入的所有文件，并恢复原 backend/files/ 内容
  for (const f of await readdir(filesDir).catch(() => [] as string[])) {
    await rm(join(filesDir, f), { force: true });
  }
  for (const f of await readdir(stashDir).catch(() => [] as string[])) {
    await rename(join(stashDir, f), join(filesDir, f));
  }
  rmSync(stashDir, { recursive: true, force: true });
}

// 清理临时 DB（删不掉也无妨：系统临时目录）
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  /* ignore */
}

console.log(`[smoke-files] 全部 ${passed} 项断言通过 ✓`);
