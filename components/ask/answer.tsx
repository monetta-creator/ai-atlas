'use client';

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { parseCitations, type CitationKind, type ParsedCode, type SignalMap, type ValidIdsPlain } from '@/lib/ask/verify';

// The citation renderer, extracted from AskAtlas so both the single-shot widget
// (per-signal ask) and the chat workspace share one implementation. Splices the
// streamed text into nodes: valid citations become kind-tinted pill chips
// linking to the record page, or (when `onCite` is provided, the workspace's
// peek panel) buttons; unverified ones a flagged chip. A bracket the model
// bundled (e.g. [claim 1.3, B1]) is rebuilt so each real code renders
// individually. Plain-text segments pass through the bold pass: **span**
// renders as <strong> (the answer's section headers), everything else stays
// literal text. Runs on every render (cheap: two regexes over a short answer).

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

// The bold-only formatting subset: **span** becomes <strong>. The prompts
// permit exactly short bold section headers, so anything else the model tries
// (lists, links, # headings) stays visible as literal text and gets fixed at
// the prompt, not silently re-rendered.
function boldNodes(text: string, keyBase: string): ReactNode[] {
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

export function renderAnswer(
  text: string,
  ids: ValidIdsPlain,
  sig: SignalMap,
  opts: { onCite?: (c: ParsedCode) => void } = {}
): RenderedAnswer {
  const spans = parseCitations(text, ids, sig);
  const nodes: ReactNode[] = [];
  let cursor = 0;
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

  spans.forEach((sp, i) => {
    if (sp.start > cursor) nodes.push(...boldNodes(text.slice(cursor, sp.start), `t${i}`));
    if (sp.codes.length === 1) {
      nodes.push(chip(`${i}`, sp.codes[0], sp.raw));
    } else {
      // A bundled bracket rebuilds as one pill per code, no outer brackets.
      const inner: ReactNode[] = [];
      sp.codes.forEach((c, j) => {
        if (j) inner.push(' ');
        inner.push(chip(`${i}-${j}`, c, `${c.kind} ${c.id}`));
      });
      nodes.push(<span key={i}>{inner}</span>);
    }
    cursor = sp.end;
  });
  if (cursor < text.length) nodes.push(...boldNodes(text.slice(cursor), 'tail'));
  return { nodes, unverified, readMore };
}
