'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { ThesisTreeNode } from '@/lib/data';
import { DOMAIN_LABEL, confidenceText, heatVar } from '@/lib/format';

// The thesis logic tree (the deal workflow's step 2, visualized): the thesis at
// the top, the claims/bridges it stands on beneath (confidence band colored),
// and under each claim the questions it bears on. Gap-scan recommendations
// render as dashed ghost nodes (the QuestionMap proposed-node language), each
// linking its Start-draft form. Admin-only surface today: confidence colors
// would need stripping before this ever goes public.
//
// Hand-rolled SVG, the ConceptGraph precedent: layout computed from props each
// render (no ref reads in render), narrow screens fall back to a nested list.

export interface ThesisTreeGhost {
  code: string;
  kind: 'claim' | 'bridge';
  statement: string;
  href: string;              // the Start-draft link, built server-side
}

const NODE_W = 192;
const NODE_H = 84;
const H_GAP = 22;
const Q_W = 148;
const Q_H = 34;
const Q_GAP = 14;
const BAND_GAP = 52;
const PAD = 14;
const THESIS_H = 68;

// Wrap a statement into up to `maxLines` lines of ~`chars` characters, with an
// ellipsis on overflow. Word-boundary greedy fill.
function wrapText(text: string, chars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const cand = line ? `${line} ${w}` : w;
    if (cand.length <= chars) {
      line = cand;
      continue;
    }
    if (lines.length === maxLines - 1) {
      // no room for another line: ellipsize what we have and stop
      lines.push((line || w).slice(0, chars - 1) + '…');
      return lines;
    }
    if (line) lines.push(line);
    line = w.length > chars ? w.slice(0, chars - 1) + '…' : w;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.length ? lines : [text.slice(0, chars)];
}

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const mid = (y1 + y2) / 2;
  return `M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
}

export default function ThesisLogicTree({
  statement, nodes, ghosts,
}: {
  statement: string;
  nodes: ThesisTreeNode[];
  ghosts: ThesisTreeGhost[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const check = () => setNarrow(el.getBoundingClientRect().width < 640);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const g = useMemo(() => {
    const count = nodes.length + ghosts.length;
    const rowW = count * NODE_W + Math.max(0, count - 1) * H_GAP;

    // Question band: dedupe across claims, ordered by the first claim that bears
    // on each, positioned at the barycenter of its connected claims.
    const qOrder: { slug: string; label: string; title: string; claimIdx: number[] }[] = [];
    nodes.forEach((n, i) => {
      for (const qn of n.questions) {
        const existing = qOrder.find((x) => x.slug === qn.slug);
        if (existing) existing.claimIdx.push(i);
        else qOrder.push({ ...qn, claimIdx: [i] });
      }
    });
    const qRowW = qOrder.length * Q_W + Math.max(0, qOrder.length - 1) * Q_GAP;

    const width = Math.max(rowW, qRowW, 420) + PAD * 2;
    const thesisW = Math.min(520, Math.max(300, width - PAD * 2 - 120));
    const thesisX = (width - thesisW) / 2;
    const nodesY = PAD + THESIS_H + BAND_GAP;
    const qY = nodesY + NODE_H + (qOrder.length ? BAND_GAP : 0);
    const height = qY + (qOrder.length ? Q_H : 0) + PAD;

    const nodeX = (i: number) => (width - rowW) / 2 + i * (NODE_W + H_GAP);
    const laidNodes = nodes.map((n, i) => ({ ...n, x: nodeX(i), y: nodesY, ghost: false as const }));
    const laidGhosts = ghosts.map((n, i) => ({ ...n, x: nodeX(nodes.length + i), y: nodesY, ghost: true as const }));

    // Questions: sort by barycenter of connected claims, then space evenly.
    const withBary = qOrder.map((qn) => ({
      ...qn,
      bary: qn.claimIdx.reduce((a, i) => a + nodeX(i) + NODE_W / 2, 0) / qn.claimIdx.length,
    }));
    withBary.sort((a, b) => a.bary - b.bary);
    const laidQs = withBary.map((qn, i) => ({
      ...qn,
      x: (width - qRowW) / 2 + i * (Q_W + Q_GAP),
      y: qY,
    }));
    const qXBySlug = new Map(laidQs.map((qn) => [qn.slug, qn.x + Q_W / 2]));

    // Edges: thesis -> every node; each claim -> its questions.
    const thesisBottom = { x: width / 2, y: PAD + THESIS_H };
    const topEdges = [...laidNodes, ...laidGhosts].map((n) => ({
      key: `t-${n.code}`,
      code: n.code,
      ghost: n.ghost,
      d: curve(thesisBottom.x, thesisBottom.y, n.x + NODE_W / 2, n.y),
    }));
    const qEdges = laidNodes.flatMap((n) =>
      n.questions.flatMap((qn) => {
        const qx = qXBySlug.get(qn.slug);
        return qx === undefined ? [] : [{
          key: `q-${n.code}-${qn.slug}`,
          code: n.code,
          slug: qn.slug,
          d: curve(n.x + NODE_W / 2, n.y + NODE_H, qx, qY),
        }];
      })
    );

    return { width, height, thesisX, thesisW, laidNodes, laidGhosts, laidQs, topEdges, qEdges };
  }, [nodes, ghosts]);

  if (nodes.length === 0 && ghosts.length === 0) {
    return (
      <p style={{ color: 'var(--faint-ink)', fontSize: 14, margin: 0 }}>
        No claims mapped yet. Map the thesis in the edit form, or run the gap diagnosis below
        to see what the map would need.
      </p>
    );
  }

  const dimmed = (code: string) => hover !== null && hover !== code;

  if (narrow) {
    return (
      <div ref={wrapRef}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {nodes.map((n) => (
            <div key={n.code} style={{ borderLeft: '2px solid var(--line)', paddingLeft: 12 }}>
              <Link href={n.href} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>
                {n.code}
              </Link>
              {n.confidence_label && (
                <span style={{ fontSize: 11, marginLeft: 8, color: heatVar(n.confidence_label) }}>
                  {confidenceText(n.confidence_label)}
                </span>
              )}
              <p style={{ margin: '2px 0 2px', fontSize: 13, color: 'var(--ink)', lineHeight: 1.4 }}>{n.statement}</p>
              <p style={{ margin: 0, fontSize: 11.5, color: 'var(--faint-ink)' }}>
                {n.kind === 'bridge'
                  ? `bridge · ${DOMAIN_LABEL[n.domain_from as keyof typeof DOMAIN_LABEL] ?? n.domain_from} ↔ ${DOMAIN_LABEL[n.domain_to as keyof typeof DOMAIN_LABEL] ?? n.domain_to}`
                  : n.questions.length
                    ? `bears on ${n.questions.map((qn) => qn.label).join(', ')}`
                    : 'no stance edges'}
              </p>
            </div>
          ))}
          {ghosts.map((n) => (
            <div key={n.code} style={{ borderLeft: '2px dashed var(--accent)', paddingLeft: 12 }}>
              <Link href={n.href} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>
                {n.code}
              </Link>
              <span style={{ fontSize: 10.5, marginLeft: 8, color: 'var(--accent)', letterSpacing: '0.04em' }}>proposed</span>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--dim)', lineHeight: 1.4 }}>{n.statement}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapRef}>
      <div style={{ overflowX: 'auto' }}>
        <svg
          width={g.width}
          height={g.height}
          viewBox={`0 0 ${g.width} ${g.height}`}
          role="img"
          aria-label="Thesis logic tree: the thesis, the claims it stands on, and the questions those claims bear on"
          style={{ display: 'block', margin: '0 auto' }}
        >
          {/* edges first */}
          {g.topEdges.map((e) => (
            <path
              key={e.key}
              d={e.d}
              fill="none"
              stroke={e.ghost ? 'var(--accent)' : 'var(--line)'}
              strokeWidth={1.4}
              strokeDasharray={e.ghost ? '4 4' : undefined}
              opacity={dimmed(e.code) ? 0.25 : e.ghost ? 0.75 : 1}
            />
          ))}
          {g.qEdges.map((e) => (
            <path
              key={e.key}
              d={e.d}
              fill="none"
              stroke="var(--line)"
              strokeWidth={1}
              opacity={dimmed(e.code) ? 0.15 : 0.6}
            />
          ))}

          {/* the thesis node */}
          <g transform={`translate(${g.thesisX}, ${PAD})`}>
            <rect width={g.thesisW} height={THESIS_H} rx={10} fill="var(--surface)" stroke="var(--ink)" strokeWidth={1.4} />
            <text x={14} y={20} fontSize={10} letterSpacing="0.08em" fill="var(--faint-ink)" style={{ textTransform: 'uppercase' }}>
              Thesis
            </text>
            {wrapText(statement, Math.floor(g.thesisW / 7.4), 2).map((line, i) => (
              <text key={i} x={14} y={38 + i * 15} fontSize={12.5} fontWeight={600} fill="var(--ink)">
                {line}
              </text>
            ))}
          </g>

          {/* mapped nodes */}
          {g.laidNodes.map((n) => (
            <a key={n.code} href={n.href}>
              <g
                transform={`translate(${n.x}, ${n.y})`}
                opacity={dimmed(n.code) ? 0.35 : 1}
                onMouseEnter={() => setHover(n.code)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: 'pointer' }}
              >
                <title>{`${n.code} · ${n.statement}`}</title>
                <rect width={NODE_W} height={NODE_H} rx={8} fill="var(--surface)" stroke="var(--line)" strokeWidth={1.2} />
                <text x={12} y={18} fontSize={11} fontFamily="var(--font-mono)" fill="var(--accent)">
                  {n.code}
                </text>
                {n.confidence_label && (
                  <text x={NODE_W - 12} y={18} fontSize={10} textAnchor="end" fill={heatVar(n.confidence_label)}>
                    {confidenceText(n.confidence_label)}
                  </text>
                )}
                {wrapText(n.statement, 30, 3).map((line, i) => (
                  <text key={i} x={12} y={34 + i * 13} fontSize={10.5} fill="var(--ink)">
                    {line}
                  </text>
                ))}
                {n.kind === 'bridge' && (
                  <text x={12} y={NODE_H - 8} fontSize={9.5} fill="var(--faint-ink)">
                    {`bridge · ${DOMAIN_LABEL[n.domain_from as keyof typeof DOMAIN_LABEL] ?? n.domain_from} ↔ ${DOMAIN_LABEL[n.domain_to as keyof typeof DOMAIN_LABEL] ?? n.domain_to}`}
                  </text>
                )}
              </g>
            </a>
          ))}

          {/* gap-scan ghosts (dashed = proposed, the QuestionMap language) */}
          {g.laidGhosts.map((n) => (
            <a key={n.code} href={n.href}>
              <g
                transform={`translate(${n.x}, ${n.y})`}
                opacity={dimmed(n.code) ? 0.35 : 1}
                onMouseEnter={() => setHover(n.code)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: 'pointer' }}
              >
                <title>{`${n.code} (proposed) · ${n.statement} · click to start the draft`}</title>
                <rect width={NODE_W} height={NODE_H} rx={8} fill="none" stroke="var(--accent)" strokeWidth={1.2} strokeDasharray="5 4" />
                <text x={12} y={18} fontSize={11} fontFamily="var(--font-mono)" fill="var(--accent)">
                  {n.code}
                </text>
                <text x={NODE_W - 12} y={18} fontSize={9.5} textAnchor="end" fill="var(--accent)" letterSpacing="0.05em">
                  proposed
                </text>
                {wrapText(n.statement, 30, 3).map((line, i) => (
                  <text key={i} x={12} y={34 + i * 13} fontSize={10.5} fill="var(--dim)">
                    {line}
                  </text>
                ))}
              </g>
            </a>
          ))}

          {/* the question band */}
          {g.laidQs.map((qn) => (
            <a key={qn.slug} href={`/q/${qn.slug}`}>
              <g transform={`translate(${qn.x}, ${qn.y})`} style={{ cursor: 'pointer' }}>
                <title>{qn.title}</title>
                <rect width={Q_W} height={Q_H} rx={17} fill="transparent" stroke="var(--line)" strokeWidth={1} />
                <text x={Q_W / 2} y={21} fontSize={10.5} textAnchor="middle" fill="var(--dim)">
                  <tspan fontFamily="var(--font-mono)" fill="var(--accent)">{qn.label}</tspan>
                  <tspan> · {qn.title.length > 19 ? qn.title.slice(0, 18) + '…' : qn.title}</tspan>
                </text>
              </g>
            </a>
          ))}
        </svg>
      </div>
      <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--faint-ink)' }}>
        The thesis stands on its mapped claims; each claim bears on a question. Dashed = a
        gap-scan proposal, click it to start the draft. Colors are the confidence bands.
      </p>
    </div>
  );
}
