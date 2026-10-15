import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react';
import manual from '../../../docs/manual.md?raw';
import { parseMarkdown, type Block, type Inline } from '../markdown';

function inline(c: Inline[]): ReactNode {
  return c.map((x, i) => {
    if (typeof x === 'string') return <Fragment key={i}>{x}</Fragment>;
    if (x.t === 'code') return <code key={i}>{x.c}</code>;
    if (x.t === 'a') {
      return x.href.startsWith('#')
        ? <a key={i} href={`#help-${x.href.slice(1)}`}>{inline(x.c)}</a>
        : <a key={i} href={x.href} target="_blank" rel="noreferrer">{inline(x.c)}</a>;
    }
    return x.t === 'b' ? <strong key={i}>{inline(x.c)}</strong> : <em key={i}>{inline(x.c)}</em>;
  });
}

function block(b: Block, i: number): ReactNode {
  switch (b.t) {
    case 'h': {
      const H = `h${b.level + 1}` as 'h2' | 'h3' | 'h4';
      return <H key={i} id={`help-${b.id}`}>{inline(b.c)}</H>;
    }
    case 'p': return <p key={i}>{inline(b.c)}</p>;
    case 'tip': return <p key={i} className="tip">{inline(b.c)}</p>;
    case 'ul': return <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>;
    case 'ol': return <ol key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>;
  }
}

/** The user manual (docs/manual.md), bundled with the app so it works offline. */
export function Help({ section }: { section?: string }) {
  const blocks = useMemo(() => parseMarkdown(manual), []);
  const sections = blocks.filter((b): b is Extract<Block, { t: 'h' }> => b.t === 'h' && b.level === 2);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (section) root.current?.querySelector(`#help-${CSS.escape(section)}`)?.scrollIntoView({ block: 'start' });
  }, [section]);
  return (
    <article className="help" data-testid="help" ref={root}>
      {blocks[0]?.t === 'h' && block(blocks[0], -1)}
      <nav aria-label="Manual contents">
        <ul className="help-toc">
          {sections.map((s) => <li key={s.id}><a href={`#help-${s.id}`}>{inline(s.c)}</a></li>)}
        </ul>
      </nav>
      {blocks.map((b, i) => (i === 0 && b.t === 'h' ? null : block(b, i)))}
      <p className="lede help-version">Version {__APP_VERSION__}</p>
    </article>
  );
}
