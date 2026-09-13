import { useCallback, useEffect, useState } from 'react';
import { Badge, Btn, Empty, Spinner } from '../../components/ui.tsx';
import { Markdown } from './Markdown.tsx';
import { api } from '../../lib/api.ts';

/** 收件箱条目（与后端 kb_drafts 契约一致） */
interface InboxItem {
  id: number;
  title: string;
  sourceKind: 'doc' | 'hot' | 'audit' | 'raw';
  sourceRef: string;
  structured: boolean;
  content: string;
  createdAt: string;
}

const KIND_LABEL: Record<InboxItem['sourceKind'], string> = {
  doc: '文档整理',
  hot: '素材卡',
  audit: '体检建议',
  raw: '未结构化',
};

/**
 * 收件箱（原「草稿区」，P2-5 验收重做）。
 *
 * 用户要求：「即使草稿也要在知识库里体现，不要叫草稿区，小助理整理的应该叫什么你想想」
 * → 命名「收件箱」；位置：知识库页左侧栏「标签」下方，与目录/标签同属知识库浏览体系。
 *
 * 与知识库的关系：收件箱内容**可见但不入索引**——它是依依整理出的待处理素材，
 * 由用户过目后决定是否沉淀（落盘 Vault 需另行授权，本轮不做）。
 */
export function InboxPanel() {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.kbDrafts();
      setItems(r.drafts as InboxItem[]);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: number) => {
    setBusy(true);
    try {
      await api.kbDraftDelete(id);
      if (openId === id) setOpenId(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const current = items?.find((i) => i.id === openId) ?? null;

  return (
    <div className="qs-card mt-4 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
          收件箱
        </span>
        {items && items.length > 0 ? (
          <span className="qs-meta tabular" style={{ color: 'var(--color-ink-faint)' }}>
            {items.length}
          </span>
        ) : null}
      </div>

      {items === null ? (
        <Spinner label="加载收件箱…" />
      ) : items.length === 0 ? (
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-ink-faint)' }}>
          还没有整理结果。与「依依」私聊即可让她把产品资料或每日热点整理成结构化 Markdown，产出会出现在这里。
        </p>
      ) : (
        <>
          <div className="space-y-1">
            {items.map((it) => {
              const active = openId === it.id;
              return (
                <button
                  key={it.id}
                  type="button"
                  className="qs-clickable block w-full rounded-[4px] px-1.5 py-1 text-left transition-colors"
                  style={{ background: active ? 'var(--color-signal-soft)' : 'transparent' }}
                  onClick={() => setOpenId(active ? null : it.id)}
                  title={it.sourceRef ? `来源：${it.sourceRef}` : it.title}
                >
                  <span className="block truncate text-[12px] font-medium" style={{ color: active ? 'var(--color-signal)' : 'var(--color-ink)' }}>
                    {it.title}
                  </span>
                  <span className="qs-meta block truncate text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                    {KIND_LABEL[it.sourceKind]} · {it.createdAt.slice(5, 16).replace('T', ' ')}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 预览：就地展开（不跳页），含来源与删除 */}
          {current ? (
            <div className="mt-2 border-t pt-2" style={{ borderColor: 'var(--color-line)' }}>
              <div className="mb-1.5 flex items-center gap-1.5">
                <Badge tone={current.structured ? 'signal' : 'warn'}>{KIND_LABEL[current.sourceKind]}</Badge>
                {current.sourceRef ? (
                  <span className="qs-meta min-w-0 flex-1 truncate text-[10px]" style={{ color: 'var(--color-ink-faint)' }} title={current.sourceRef}>
                    来源 {current.sourceRef}
                  </span>
                ) : (
                  <span className="flex-1" />
                )}
                <Btn size="sm" variant="danger" disabled={busy} onClick={() => void remove(current.id)} title="删除这条整理结果">
                  删除
                </Btn>
              </div>
              <div className="max-h-[240px] overflow-y-auto rounded-[4px] border p-2" style={{ borderColor: 'var(--color-line)', background: 'var(--color-sunken)' }}>
                <div className="text-[12px] leading-relaxed">
                  <Markdown text={current.content} />
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}

      <p className="qs-meta mt-2 text-[10px] leading-relaxed" style={{ color: 'var(--color-ink-faint)' }}>
        收件箱内容不进入知识库索引与星图；确认可用后再手动沉淀进 Vault（该步待开放）。
      </p>
    </div>
  );
}
