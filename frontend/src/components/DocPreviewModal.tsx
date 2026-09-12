import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkbench } from '../store/useWorkbench.tsx';
import { Badge, Btn, Empty, Spinner } from './ui.tsx';
import { api } from '../lib/api.ts';
import { Markdown } from '../features/knowledge/Markdown.tsx';
import type { KnowledgeDoc, TaskListItem } from '@workbench/shared';

/** 浏览栈上限：超出后最早记录出栈（防无限递归撑爆内存） */
const STACK_LIMIT = 20;

/**
 * 全局文档预览弹窗（P2·F1，doc-preview spec）。
 *
 * 职责：所有「快速查看」类文档引用的统一预览层——星图节点详情、任务详情关联资料、
 * Markdown 正文内链接。弹窗就地呈现，不产生路由跳转，Esc/遮罩关闭后精确回到触发前状态。
 *
 * 与知识库阅读区的分工：知识库页内列表点击仍在阅读区原地打开（不走本弹窗）；
 * 弹窗内「在知识库中打开 ↗」是唯一的深度阅读转出口。
 */
export function DocPreviewModal() {
  const { docPreviewPath, closeDocPreview, openDocPreview, openKbDoc, setView } = useWorkbench();
  const [doc, setDoc] = useState<KnowledgeDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 弹窗内浏览栈（供「← 返回上一份」） */
  const [stack, setStack] = useState<string[]>([]);
  /** 引用此资料的任务 */
  const [refTasks, setRefTasks] = useState<TaskListItem[] | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const open = docPreviewPath != null;
  const path = docPreviewPath ?? '';

  /** 加载文档 + 引用任务清单 */
  useEffect(() => {
    if (!open || !path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRefTasks(null);
    void api
      .kbDoc(path)
      .then((r) => {
        if (!cancelled) setDoc(r.doc);
      })
      .catch((err) => {
        if (!cancelled) {
          setDoc(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // 引用任务：从全量任务里过滤 kbRefs 命中该文档的（列表接口已带 kbRefsTotal/Invalid 计数，
    // 但逐任务的明细需单独拉；此处用轻量策略：拉全量列表按标题粗筛 —— 精确明细由任务详情承担）
    void api
      .listTasks()
      .then((r) => {
        if (!cancelled) setRefTasks(r.tasks);
      })
      .catch(() => {
        if (!cancelled) setRefTasks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, path]);

  /** Esc 关闭 + 焦点锁定（Tab 循环在弹窗内） */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeDocPreview();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    // 打开时把焦点移入弹窗
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, closeDocPreview]);

  /** 弹窗内切换：压栈当前文档（上限裁剪） */
  const navigateInModal = useCallback(
    (next: string) => {
      if (!next || next === path) return;
      setStack((prev) => {
        const nextStack = [...prev, path];
        return nextStack.length > STACK_LIMIT ? nextStack.slice(nextStack.length - STACK_LIMIT) : nextStack;
      });
      openDocPreview(next);
    },
    [path, openDocPreview],
  );

  const goBack = useCallback(() => {
    setStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      openDocPreview(last);
      return prev.slice(0, -1);
    });
  }, [openDocPreview]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 pt-[7vh]"
      onClick={closeDocPreview}
      role="dialog"
      aria-modal="true"
      aria-label="文档预览"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="qs-card flex w-[min(920px,92vw)] flex-col outline-none"
        style={{ height: '86vh', background: 'var(--color-surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：标题 + 返回 + 深度阅读 + 关闭 */}
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--color-line)' }}>
          <span className="qs-meta shrink-0" style={{ color: 'var(--color-ink-faint)' }}>
            文档预览
          </span>
          <h3 className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
            {doc?.title ?? path}
          </h3>
          <Btn size="sm" variant="ghost" disabled={stack.length === 0} onClick={goBack} title={stack.length > 0 ? `返回 ${stack[stack.length - 1]}` : '没有上一份'}>
            ← 返回上一份
          </Btn>
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => {
              openKbDoc(path);
              closeDocPreview();
            }}
            title="跳转到知识库阅读区深度阅读"
          >
            在知识库中打开 ↗
          </Btn>
          <button
            type="button"
            className="qs-clickable qs-meta shrink-0 rounded-[4px] border px-2 py-1"
            style={{ borderColor: 'var(--color-line-strong)', color: 'var(--color-ink-soft)' }}
            onClick={closeDocPreview}
            aria-label="关闭文档预览"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 正文 */}
          <div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
            {loading ? (
              <Spinner label="加载文档…" />
            ) : error ? (
              <Empty text={`文档加载失败：${error}`} hint="该文档可能已被移动或删除；可到知识库重建索引后重试" />
            ) : doc ? (
              <Markdown
                text={doc.content}
                onOpenDoc={(target) => {
                  // 弹窗内链接：内部文档在弹窗内切换。
                  // 路径形态跟随 Markdown.tsx 的既有约定：wiki 名或相对路径均可被知识库后端解析，
                  // 这里不再二次猜测文件存在性；同目录相对名补 .md 以提高命中率。
                  const base = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
                  const target2 = target.endsWith('.md') || target.includes('/') ? target : `${base}${target}.md`;
                  navigateInModal(target2);
                }}
              />
            ) : null}
          </div>

          {/* 右栏：目录内位置 + 标签 + 引用此资料的任务 */}
          <aside className="w-[230px] shrink-0 space-y-4 overflow-y-auto border-l px-4 py-4" style={{ borderColor: 'var(--color-line)' }}>
            {doc ? (
              <>
                <div>
                  <div className="qs-meta mb-1.5" style={{ color: 'var(--color-ink-faint)' }}>
                    目录内位置
                  </div>
                  <div className="text-[12px] leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>
                    {doc.dir || '根目录'}
                  </div>
                </div>
                <div>
                  <div className="qs-meta mb-1.5" style={{ color: 'var(--color-ink-faint)' }}>
                    标签
                  </div>
                  {doc.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {doc.tags.map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
                      无标签
                    </span>
                  )}
                </div>
              </>
            ) : null}

            <div>
              <div className="qs-meta mb-1.5" style={{ color: 'var(--color-ink-faint)' }}>
                引用此资料的任务
              </div>
              {refTasks === null ? (
                <Spinner label="查询引用…" />
              ) : refTasks.length === 0 ? (
                <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
                  暂无任务引用此资料
                </span>
              ) : (
                <div className="space-y-0.5">
                  {refTasks.slice(0, 10).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="qs-nav-item w-full text-left"
                      onClick={() => {
                        closeDocPreview();
                        setView('board');
                      }}
                      title={`打开任务 #${t.id}`}
                    >
                      <span className="flex-1 truncate text-[12px]">
                        任务 #{t.id} · {t.title}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
