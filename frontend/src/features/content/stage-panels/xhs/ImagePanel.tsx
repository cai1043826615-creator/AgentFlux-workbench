import { Btn, Spinner } from '../../../../components/ui.tsx';
import { ImageGrid, PanelCard, StateBadge, type PanelCommon, type ParsedImg } from './shared.tsx';

/* 配图面板（首图设计 / 内页设计各自一卡，不再用 subtab 混在一起）
   - 首图设计：1 张
   - 内页设计：N 张（数量由新建任务指定）
   逐张「采纳 / 打回」；全部决策后由后端自动推进（不必再点面板级按钮）。
   面板级保留一个「全部采纳」作为快捷方式。 */

export function ImagePanel({
  imgs,
  title,
  state,
  busy,
  retrying,
  onDecide,
  onRetry,
  onZoom,
}: PanelCommon & {
  imgs: ParsedImg[];
  title: string;
  retrying: string | null;
  onRetry: (imageId: string) => void;
  onZoom: (img: ParsedImg) => void;
}) {
  const pending = imgs.filter((i) => i.status === 'pending' || i.status === 'failed').length;
  return (
    <PanelCard title={title} badge={<StateBadge state={state} />}>
      {state === 'working' ? (
        <div className="py-6 text-center">
          <Spinner label="设计师正在生成图片…" />
          <div className="qs-meta mt-2">生成完成后将在此展示，供你逐张确认</div>
        </div>
      ) : (
        <ImageGrid
          imgs={imgs}
          canDecide={state === 'pending'}
          busy={busy}
          retrying={retrying}
          onDecide={onDecide}
          onRetry={onRetry}
          onZoom={onZoom}
        />
      )}
    </PanelCard>
  );
}
