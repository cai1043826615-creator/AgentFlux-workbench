import { WORKFLOW_STAGE_LABELS, XHS_STAGE_REVIEW, type Deliverable } from '@workbench/shared';
import { Badge } from '../../../../components/ui.tsx';
import { PanelCard, copyJsonForStage, type PanelCommon } from './shared.tsx';

/* 合规审核（自动节点）：只展示检查清单，不提供任何人工决策按钮。
   「它是自动的」靠面板内文案说明，阶段条上不加「自动」角标。
   位置：渲染在「任务详情」页，溯源模块上方（用户定案 2026-09-17）。
   两条工作流共用此面板：校对节点 id 不同（xhs-review / review），故由调用方传入。 */

export interface ComplianceView {
  report: string;
  checks: { passed: boolean; label: string; note?: string }[];
  issues: { targetStage: string; note: string }[];
}

/**
 * 解析合规/校对结果（任务详情页使用；两流共用）。
 * 校对阶段：小红书为 xhs-review、电商为 review——按任务工作流传入。
 * points 形如「通过：配图与参考图主体一致」/「未通过：xxx（说明）」。
 */
export function parseCompliance(deliverables: Deliverable[], reviewStage: string = XHS_STAGE_REVIEW): ComplianceView | null {
  const raw = copyJsonForStage<{ outline?: string; points?: string[] }>(deliverables, reviewStage);
  if (!raw) return null;
  const checks = (raw.points ?? []).map((p) => {
    const passed = p.startsWith('通过') && !p.startsWith('未通过');
    // 「通过：配图与参考图主体一致（1 张已核对）」→ label 与 note 拆开
    const body = p.replace(/^(通过|未通过)：?/, '');
    const m = /^(.*?)（(.+)）$/.exec(body);
    return { passed, label: m ? m[1] : body, note: m ? m[2] : undefined };
  });
  return { report: raw.outline ?? '', checks, issues: [] };
}

export function CompliancePanel({
  data,
  state,
}: Pick<PanelCommon, 'state'> & { data: ComplianceView | null }) {
  const passed = data ? data.issues.length === 0 : true;
  return (
    <PanelCard
      title="合规审核"
      badge={state === 'none' ? <Badge>未开始</Badge> : passed ? <Badge tone="ok">自动放行</Badge> : <Badge tone="no">已回退</Badge>}
    >
      <p className="qs-meta mb-2.5">主管 Agent 自动检查，无需人工确认。</p>
      {data ? (
        <>
          <div className="space-y-1.5 text-[13px]">
            {data.checks.map((c, i) => (
              <div
                key={`${c.label}-${i}`}
                className="flex items-start gap-2 border-b pb-1.5 last:border-b-0"
                style={{ borderColor: 'var(--color-line)' }}
              >
                <span
                  className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-[10px] font-bold"
                  style={
                    c.passed
                      ? { background: 'var(--color-ok-soft)', color: 'var(--color-ok)' }
                      : { background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }
                  }
                >
                  {c.passed ? '✓' : '✕'}
                </span>
                <span style={{ color: 'var(--color-ink-soft)' }}>
                  {c.label}
                  {c.note ? <span className="qs-meta block">{c.note}</span> : null}
                </span>
              </div>
            ))}
          </div>
          <div className="qs-meta mt-2.5">{data.report}</div>
          {data.issues.length > 0 ? (
            <div className="qs-meta mt-2" style={{ color: 'var(--color-danger)' }}>
              已自动回退到「{WORKFLOW_STAGE_LABELS[data.issues[0].targetStage] ?? data.issues[0].targetStage}」：{data.issues[0].note}
            </div>
          ) : null}
        </>
      ) : (
        <div className="qs-meta">审核报告尚未产出</div>
      )}
    </PanelCard>
  );
}
