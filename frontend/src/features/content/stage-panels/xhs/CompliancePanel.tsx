import { WORKFLOW_STAGE_LABELS } from '@workbench/shared';
import { Badge } from '../../../../components/ui.tsx';
import { PanelCard, type PanelCommon } from './shared.tsx';

/* 合规审核（自动节点）：只展示检查清单，不提供任何人工决策按钮。
   「它是自动的」靠面板内文案说明，阶段条上不加「自动」角标。 */

export interface ComplianceView {
  report: string;
  checks: { passed: boolean; label: string; note?: string }[];
  issues: { targetStage: string; note: string }[];
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
                  className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-[10px] font-bold"
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
