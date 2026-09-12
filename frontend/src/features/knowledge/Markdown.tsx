import { type ReactNode } from 'react';

/**
 * 轻量 Markdown 渲染（无第三方依赖，沿用 Quiet Signal 排版）。
 * 覆盖 spec 要求的「标题、段落、列表、链接、代码块等」，刻意不追求全量 Markdown 兼容。
 */

/** 行内元素：**粗体** / *斜体* / `代码` / [链接](url) / [[wiki链接]]
 *  onOpenDoc 提供时：wiki 链接与内部文档链接可点击跳转（30，与星图节点详情复用同一跳转能力） */
function renderInline(text: string, keyPrefix: string, onOpenDoc?: (path: string) => void): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\[\[[^\]]+\]\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}-i${i++}`;
    if (token.startsWith('**')) {
      nodes.push(
        <strong key={key} style={{ fontWeight: 600 }}>
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="rounded-[3px] px-1 py-0.5 text-[12px]" style={{ background: 'var(--color-sunken)', fontFamily: 'ui-monospace, monospace' }}>
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('[[')) {
      // wiki 链接：有跳转能力时点击打开关联文档，否则按高亮文本呈现
      const target = token.slice(2, -2);
      nodes.push(
        onOpenDoc ? (
          <button key={key} type="button" className="qs-clickable qs-doc-link" title="跳转到关联文档" onClick={() => onOpenDoc(target)}>
            {target}
          </button>
        ) : (
          <span key={key} className="qs-doc-link" title="知识库内部链接">
            {target}
          </span>
        ),
      );
    } else if (token.startsWith('[')) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (lm) {
        const external = /^https?:/i.test(lm[2]);
        // 30：内部文档链接（非 http）可点击跳转；外部链接仍走新窗口
        if (!external && onOpenDoc) {
          nodes.push(
            <button key={key} type="button" className="qs-clickable qs-doc-link" title="跳转到关联文档" onClick={() => onOpenDoc(lm[2])}>
              {lm[1]}
            </button>,
          );
        } else {
          nodes.push(
            <a
              key={key}
              href={external ? lm[2] : undefined}
              target={external ? '_blank' : undefined}
              rel="noreferrer"
              className="qs-doc-link"
            >
              {lm[1]}
            </a>,
          );
        }
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(
        <em key={key} style={{ fontStyle: 'italic' }}>
          {token.slice(1, -1)}
        </em>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** 单行标题级别（0 = 非标题） */
function headingLevel(line: string): number {
  const m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
  return m ? m[1].length : 0;
}

export function Markdown({ text, onOpenDoc }: { text: string; onOpenDoc?: (path: string) => void }) {
  const lines = String(text ?? '').split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const k = `b${key++}`;

    // 围栏代码块
    if (/^\s*```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++; // 跳过结束围栏
      blocks.push(
        <pre key={k} className="my-3 overflow-x-auto rounded-[4px] border p-3 text-[12px] leading-relaxed" style={{ borderColor: 'var(--color-line)', background: 'var(--color-sunken)' }}>
          <code style={{ fontFamily: 'ui-monospace, monospace' }}>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={k} className="my-4 border-t" style={{ borderColor: 'var(--color-line)' }} />);
      i++;
      continue;
    }

    // 标题
    const hl = headingLevel(line);
    if (hl > 0) {
      const content = renderInline(line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/\s*#*\s*$/, ''), k, onOpenDoc);
      const cls = hl === 1 ? 'mt-5 mb-2 text-[19px]' : hl === 2 ? 'mt-5 mb-2 text-[16px]' : 'mt-4 mb-1.5 text-[14px]';
      blocks.push(
        <div key={k} className={`font-display font-semibold leading-snug ${cls}`} style={{ fontFamily: 'var(--font-display)' }} role="heading" aria-level={hl}>
          {content}
        </div>,
      );
      i++;
      continue;
    }

    // 引用块
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(
        <blockquote key={k} className="my-3 border-l-2 pl-3 text-[13px] leading-relaxed" style={{ borderColor: 'var(--color-signal)', color: 'var(--color-ink-soft)' }}>
          {buf.map((l, j) => (
            <div key={`${k}-${j}`}>{renderInline(l, `${k}-${j}`, onOpenDoc)}</div>
          ))}
        </blockquote>,
      );
      continue;
    }

    // 列表（有序 / 无序，支持简单嵌套缩进）
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: { indent: number; text: string }[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const indent = lines[i].length - lines[i].trimStart().length;
        items.push({ indent, text: lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '') });
        i++;
      }
      const base = Math.min(...items.map((x) => x.indent));
      blocks.push(
        <ul key={k} className="my-2 space-y-1 text-[13px] leading-relaxed" style={{ listStyle: ordered ? 'decimal' : 'disc', paddingLeft: 18 }}>
          {items.map((it, j) => (
            <li key={`${k}-${j}`} style={{ marginLeft: Math.min(2, (it.indent - base) / 2) * 6 }}>
              {renderInline(it.text, `${k}-${j}`, onOpenDoc)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // 空行
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 段落（连续非空行合并）
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && headingLevel(lines[i]) === 0 && !/^\s*(>|```|[-*+]\s|\d+\.\s)/.test(lines[i])) {
      buf.push(lines[i++]);
    }
    blocks.push(
      <p key={k} className="my-2 text-[13px] leading-[1.75]" style={{ color: 'var(--color-ink)' }}>
        {renderInline(buf.join(' '), k, onOpenDoc)}
      </p>,
    );
  }

  if (blocks.length === 0) {
    return <div className="qs-meta py-8 text-center" style={{ color: 'var(--color-ink-faint)' }}>（空文档）</div>;
  }
  return <div>{blocks}</div>;
}
