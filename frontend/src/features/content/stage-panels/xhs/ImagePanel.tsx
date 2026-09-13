import { useState } from 'react';
import { Btn, Spinner, Tabs } from '../../../../components/ui.tsx';
import { ImageGrid, PanelCard, StateBadge, type PanelCommon, type ParsedImg } from './shared.tsx';

/* 封面配图：首图 ×1 + 内页图 ×2，支持 subtab 切换与单图重试 */

export function ImagePanel({
  imgs,
  state,
  busy,
  retrying,
  onDecide,
  onRetry,
  onZoom,
}: PanelCommon & {
  imgs: ParsedImg[];
  retrying: string | null;
  onRetry: (imageId: string) => void;
  onZoom: (img: ParsedImg) => void;
}) {
  const [tab, setTab] = useState<'cover' | 'inner'>('cover');
  const cover = imgs.filter((i) => i.id.includes('首图'));
  const inner = imgs.filter((i) => !i.id.includes('首图'));
  const shown = tab === 'cover' ? cover : inner;

  return (
    <PanelCard
      title="笔记配图"
      badge={state === 'working' ? <StateBadge state="working" /> : <StateBadge state={state} />}
      footer={
        // 打回只在图卡内逐张操作；面板级不再放「打回重做」
        // （两套按钮并存时面板块那个不带 imageId 的 reject 不会生效，造成「点了没反应还要再点第二个」）
        state === 'pending' ? (
          <div className="space-y-2">
            <div className="qs-meta">逐张「采纳 / 打回」；失败图可「重试」。全部决策后自动提交合规审核</div>
            <div className="flex gap-1.5">
              <Btn size="sm" variant="primary" disabled={busy} onClick={() => onDecide('image', 'approve')}>
                全部采纳，提交审核 →
              </Btn>
            </div>
          </div>
        ) : undefined
      }
    >
      {state === 'working' ? (
        <div className="py-6 text-center">
          <Spinner label="设计师正在生成配图…" />
          <div className="qs-meta mt-2">生成完成后将在此展示，供你逐张确认</div>
        </div>
      ) : (
        <>
          <Tabs
            className="mb-3"
            items={[
              { key: 'cover' as const, label: '首图', count: cover.length },
              { key: 'inner' as const, label: '内页图', count: inner.length },
            ]}
            activeKey={tab}
            onChange={setTab}
          />
          <ImageGrid
            imgs={shown}
            canDecide={state === 'pending'}
            busy={busy}
            retrying={retrying}
            onDecide={onDecide}
            onRetry={onRetry}
            onZoom={onZoom}
          />
        </>
      )}
    </PanelCard>
  );
}
