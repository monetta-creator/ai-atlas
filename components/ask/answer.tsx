'use client';

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { parseCitations, type CitationKind, type ParsedCode, type SignalMap, type ValidIdsPlain } from '@/lib/ask/verify';
import { splitBeyond } from '@/lib/ask/lanes';
import { parseBlocks, type Block } from '@/lib/ask/md-blocks';

// The citation renderer, extracted from AskAtlas so both the single-shot widget
// (per-signal ask) and the chat workspace share one implementation. Splices the
// streamed text into nodes: valid citations become kind-tinted pill chips
// linking to the record page, or (when `onCite` is provided, the workspace's
// peek panel) buttons; unverified ones a flagged chip. A bracket the model
// bundled (e.g. [claim 1.3, B1]) is rebuilt so each real code renders
// individually. The text is a Markdown subset
// (lib/ask/md-blocks.ts): blocks render as paragraphs, headings, lists and
// tables, and each block's text gets the citation + bold pass. Runs on every
// render (cheap: a line scan plus two regexes per block).

export type ReadMoreItem = { kind: CitationKind; id: string; href: string };

export interface RenderedAnswer {
  nodes: ReactNode[];
  unverified: number;
  readMore: ReadMoreItem[];
}

const CITE_BAD: CSSProperties = {
  background: 'color-mix(in oklab, var(--heat-4) 16%, transparent)',
  color: 'var(--heat-4)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.92em',
  borderRadius: 4,
  padding: '0 3px',
};

// Inline bold: **span** becomes <strong>. Block structure (paragraphs,
// headings, lists, tables, rules) comes from lib/ask/md-blocks.ts; anything
// outside that subset (raw HTML, links, images) stays literal text.
export function boldNodes(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*\n][^*]*?)\*\*/g;
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={`${keyBase}b${k++}`}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BEYOND_LABEL_RE = /^\s*From the (?:model's own knowledge|web), not the Atlas records[^\n]*\n*/;
function stripBeyondLabel(text: string): string {
  return text.replace(BEYOND_LABEL_RE, '');
}

export function renderAnswer(
  text: string,
  ids: ValidIdsPlain,
  sig: SignalMap,
  opts: { onCite?: (c: ParsedCode) => void; webSourced?: boolean } = {}
): RenderedAnswer {
  const { atlas, beyond } = splitBeyond(text);
  const nodes: ReactNode[] = [];
  let unverified = 0;
  // Collect the distinct map records cited, in first-appearance order, for the
  // "Read more" line. Signals are excluded: their tags (S1) are opaque labels and
  // they already link inline.
  const readMore: ReadMoreItem[] = [];
  const seenRM = new Set<string>();
  const chip = (key: string, c: ParsedCode, label: string): ReactNode => {
    if (c.valid && c.href) {
      if (c.kind !== 'signal') {
        const k = `${c.kind}:${c.id}`;
        if (!seenRM.has(k)) { seenRM.add(k); readMore.push({ kind: c.kind, id: c.id, href: c.href }); }
      }
      // The pill drops the literal brackets: "[claim 5.2]" renders as a chip
      // labeled "claim 5.2". Unverified references keep the raw bracket text
      // so the reader sees exactly what the model wrote.
      const pill = label.replace(/^\[+|\]+$/g, '');
      if (opts.onCite) {
        const cb = opts.onCite;
        return (
          <button key={key} type="button" className="ask-cite" data-kind={c.kind} onClick={() => cb(c)}>
            {pill}
          </button>
        );
      }
      return (
        <Link key={key} href={c.href} className="ask-cite" data-kind={c.kind} prefetch={false}>
          {pill}
        </Link>
      );
    }
    unverified += 1;
    return (
      <mark key={key} style={CITE_BAD} title="This reference could not be verified against the Atlas.">
        {label}
      </mark>
    );
  };

  // Inline pass over one text segment: citations become chips, **span**
  // becomes <strong>, the rest stays literal.
  const inline = (text: string, kb: string): ReactNode[] => {
    const out: ReactNode[] = [];
    const spans = parseCitations(text, ids, sig);
    let cursor = 0;
    spans.forEach((sp, i) => {
      if (sp.start > cursor) out.push(...boldNodes(text.slice(cursor, sp.start), `${kb}t${i}`));
      if (sp.codes.length === 1) {
        out.push(chip(`${kb}c${i}`, sp.codes[0], sp.raw));
      } else {
        // A bundled bracket rebuilds as one pill per code, no outer brackets.
        const inner: ReactNode[] = [];
        sp.codes.forEach((c, j) => {
          if (j) inner.push(' ');
          inner.push(chip(`${kb}c${i}-${j}`, c, `${c.kind} ${c.id}`));
        });
        out.push(<span key={`${kb}s${i}`}>{inner}</span>);
      }
      cursor = sp.end;
    });
    if (cursor < text.length) out.push(...boldNodes(text.slice(cursor), `${kb}tail`));
    return out;
  };

  // Block pass: the answer is Markdown; the UI decides how each block looks.
  const blockNode = (b: Block, kb: string): ReactNode => {
    switch (b.type) {
      case 'p':
        return <p key={kb} className="ask-md-p">{inline(b.text, kb)}</p>;
      case 'h': {
        const H = b.level === 1 ? 'h3' : b.level === 2 ? 'h4' : 'h5';
        return <H key={kb} className="ask-md-h">{inline(b.text.replace(/^\*\*(.*)\*\*$/, '$1'), kb)}</H>;
      }
      case 'ul':
        return <ul key={kb} className="ask-md-list">{b.items.map((it, j) => <li key={j}>{inline(it, `${kb}i${j}`)}</li>)}</ul>;
      case 'ol':
        return <ol key={kb} className="ask-md-list" start={b.start}>{b.items.map((it, j) => <li key={j}>{inline(it, `${kb}i${j}`)}</li>)}</ol>;
      case 'hr':
        return <hr key={kb} className="ask-md-hr" />;
      case 'table':
        return (
          <div key={kb} className="ask-md-table">
            <table>
              <thead>
                <tr>{b.head.map((c, j) => <th key={j} style={b.align[j] ? { textAlign: b.align[j]! } : undefined}>{inline(c, `${kb}h${j}`)}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri}>{r.map((c, j) => <td key={j} style={b.align[j] ? { textAlign: b.align[j]! } : undefined}>{inline(c, `${kb}r${ri}c${j}`)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  };
  const blocks = (text: string, kb: string) => parseBlocks(text).map((b, i) => blockNode(b, `${kb}${i}`));

  nodes.push(...blocks(atlas, 'a'));
  if (beyond) {
    // The model opens the section with the exact label line the prompt
    // demands; the kicker already says it, so the body drops it.
    const kicker = opts.webSourced
      ? 'Beyond the Atlas · from the web'
      : "Beyond the Atlas · from the model's own knowledge, not current";
    nodes.push(
      <aside key="beyond" className="ask-beyond" data-source={opts.webSourced ? 'web' : 'model'}>
        <p className="ask-beyond-kicker">{kicker}</p>
        <div className="ask-beyond-body">{blocks(stripBeyondLabel(beyond), 'b')}</div>
      </aside>
    );
  }
  return { nodes, unverified, readMore };
}
