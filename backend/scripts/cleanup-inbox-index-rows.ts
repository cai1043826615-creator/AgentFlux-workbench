/**
 * cleanup-inbox-index-rows.ts —— 一次性数据清理（复核报告 Q4/Q7 根治配套）
 *
 * 背景：历史索引把 kb_drafts 的整理产出以虚拟目录「助理收件箱/N.md」写进了 knowledge_docs
 * （连带 knowledge_fts / knowledge_links 的幽灵行）。§8.3 定案 kb_drafts 降级为**不可见的写入日志**，
 * indexer 已改为不再生成这些条目，但**已存在的历史行**需要一次性清掉，
 * 否则在下次重建索引前它们仍占着索引（读侧屏蔽只是不显示，行还在）。
 *
 * 本脚本删除：
 *   - knowledge_docs  中 path LIKE '助理收件箱%' 的行
 *   - knowledge_fts   中同路径的行（FTS 外部内容表，需同步清）
 *   - knowledge_links 中 source_path / target 涉及该目录的行（含其产生的 tag/link 幽灵边）
 *
 * 保留：kb_drafts 表本身（仍作写入日志，Q7 定案只是不可见，不删表）。
 *
 * 用法（在 backend/ 下执行）：
 *   node scripts/cleanup-inbox-index-rows.ts          # dry-run（默认）：预览将删除行数，不写库
 *   node scripts/cleanup-inbox-index-rows.ts --apply  # 真删：事务内删除 + settings 标记
 *
 * 幂等：settings 已有 `cleanup:inboxIndexRowsV1` 标记时直接退出（不重复删）。
 * 备份参考：backend/data/backups/2026-09-17T23-59-02-pre-q8-cleanup.db.ts
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(here, '../data/workbench.db.ts');

const APPLY = process.argv.includes('--apply');
const MARK_KEY = 'cleanup:inboxIndexRowsV1';

/** 待清理的虚拟目录（保留收件箱表本身，只清索引行） */
const INBOX_DIR = '助理收件箱';
const INBOX_LIKE = `${INBOX_DIR}/%`;
const INBOX_EXACT = INBOX_DIR;

function tableExists(db: DatabaseSync, name: string): boolean {
  const r = db.prepare(`SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name = ?`).get(name) as { c: number };
  return r.c > 0;
}

function main(): void {
  if (!existsSync(DB_PATH)) {
    console.error(`[cleanup-inbox-index-rows] 数据库不存在：${DB_PATH}`);
    process.exit(1);
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA busy_timeout = 5000');

  // 幂等：标记已存在 → 已执行过，退出
  const mark = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(MARK_KEY) as { value: string } | undefined;
  if (mark) {
    console.log(`[cleanup-inbox-index-rows] settings 已有标记 ${MARK_KEY}=${mark.value}，已执行过，跳过（幂等）。`);
    db.close();
    return;
  }

  const countIn = (table: string, col: string): number => {
    if (!tableExists(db, table)) return 0;
    const r = db
      .prepare(`SELECT count(*) AS c FROM ${table} WHERE ${col} = ? OR ${col} LIKE ?`)
      .get(INBOX_EXACT, INBOX_LIKE) as { c: number };
    return r.c;
  };

  const docs = countIn('knowledge_docs', 'path');
  const fts = countIn('knowledge_fts', 'path');
  const linksBySource = countIn('knowledge_links', 'source_path');
  const linksByTarget = countIn('knowledge_links', 'target');
  const drafts = tableExists(db, 'kb_drafts')
    ? (db.prepare('SELECT count(*) AS c FROM kb_drafts').get() as { c: number }).c
    : 0;

  console.log(`[cleanup-inbox-index-rows] 当前索引中「${INBOX_DIR}」相关行数：`);
  console.log(`  knowledge_docs=${docs}，knowledge_fts=${fts}`);
  console.log(`  knowledge_links：source_path 命中 ${linksBySource}，target 命中 ${linksByTarget}`);
  console.log(`  kb_drafts 表保留行数=${drafts}（写入日志，不删表）`);

  const total = docs + fts + linksBySource + linksByTarget;
  if (total === 0) {
    console.log('[cleanup-inbox-index-rows] 无待清理行。');
    if (!APPLY) {
      db.close();
      return;
    }
  }

  if (!APPLY) {
    console.log('[cleanup-inbox-index-rows] dry-run（未执行任何写入），确认后加 --apply 执行；执行时写 settings 标记防重复。');
    db.close();
    return;
  }

  db.exec('BEGIN');
  try {
    if (tableExists(db, 'knowledge_links')) {
      db.prepare(`DELETE FROM knowledge_links WHERE source_path = ? OR source_path LIKE ?`).run(INBOX_EXACT, INBOX_LIKE);
      db.prepare(`DELETE FROM knowledge_links WHERE target = ? OR target LIKE ?`).run(INBOX_EXACT, INBOX_LIKE);
    }
    if (tableExists(db, 'knowledge_fts')) {
      db.prepare(`DELETE FROM knowledge_fts WHERE path = ? OR path LIKE ?`).run(INBOX_EXACT, INBOX_LIKE);
    }
    if (tableExists(db, 'knowledge_docs')) {
      db.prepare(`DELETE FROM knowledge_docs WHERE path = ? OR path LIKE ?`).run(INBOX_EXACT, INBOX_LIKE);
    }
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(
      MARK_KEY,
      JSON.stringify({
        at: new Date().toISOString(),
        deleted: { knowledge_docs: docs, knowledge_fts: fts, links_source: linksBySource, links_target: linksByTarget },
      }),
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }

  const left = tableExists(db, 'knowledge_docs')
    ? (db.prepare(`SELECT count(*) AS c FROM knowledge_docs WHERE path = ? OR path LIKE ?`).get(INBOX_EXACT, INBOX_LIKE) as { c: number }).c
    : 0;
  console.log(`[cleanup-inbox-index-rows] 已清理。校验 knowledge_docs 剩余收件箱行数=${left}`);
  console.log(`[cleanup-inbox-index-rows] 完成（settings 标记 ${MARK_KEY} 已写入，重启不会重复执行）。`);
  db.close();
}

main();
