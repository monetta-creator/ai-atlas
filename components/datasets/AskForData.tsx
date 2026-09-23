'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  describeState, fromViewParams, toSearchParams,
  type ColType, type FilterableDef,
} from '@/lib/datasets/query-url';

// The Data Portal hub's natural-language query builder (migration 0064): a
// plain-language question in, a validated filter + a ready download href out,
// via POST /api/portal/query/nl (one routedStructured call per question, the
// same budget gates as the Ask surface). AskForData never receives a real
// DatasetDef (the hub only carries slug/title/keyGated per dataset), so the
// result's own params are turned back into a description with a SYNTHETIC
// FilterableDef built from those same params (columnsForParams below): every
// key the model actually used is already server-validated by the time it
// reaches this component, so this only has to keep fromViewParams's op/type
// check from dropping a token it already knows is real, not re-derive the
// dataset's real schema.

const MAX_QUESTION_LEN = 500;

interface NlResult {
  dataset: string;
  params: Record<string, string | string[]>;
  href: string;
  dropped: string[];
  explanation: string;
}

type ReqState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; result: NlResult };

function splitWhereToken(raw: string): [string, string] {
  const i1 = raw.indexOf(':');
  if (i1 === -1) return [raw, ''];
  const i2 = raw.indexOf(':', i1 + 1);
  return [raw.slice(0, i1), i2 === -1 ? raw.slice(i1 + 1) : raw.slice(i1 + 1, i2)];
}

// A where op needing a number/date-shaped column (gt/gte/lt/lte) gets type
// 'number' so opsForType still accepts it; every other op (eq/ne/in/contains/
// isnull/notnull) is covered by 'text'. cols/sort keys just need to be
// PRESENT in the map (fromSearchParams only checks colType.has for those), so
// they default to 'text' too.
function columnsForParams(params: Record<string, string | string[]>): FilterableDef {
  const types = new Map<string, ColType>();
  const whereRaw = params.where;
  const whereTokens = Array.isArray(whereRaw) ? whereRaw : whereRaw ? [whereRaw] : [];
  for (const token of whereTokens) {
    const [col, op] = splitWhereToken(token);
    if (!col) continue;
    const needsNumber = op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte';
    if (needsNumber || !types.has(col)) types.set(col, needsNumber ? 'number' : 'text');
  }
  const colsRaw = params.cols;
  const colsList = typeof colsRaw === 'string' ? colsRaw.split(',') : [];
  for (const key of colsList) if (key && !types.has(key)) types.set(key, 'text');
  const sortRaw = params.sort;
  const sortList = typeof sortRaw === 'string' ? sortRaw.split(',') : [];
  for (const part of sortList) {
    const key = part.split(':')[0];
    if (key && !types.has(key)) types.set(key, 'text');
  }
  const filters: NonNullable<FilterableDef['filters']> = {};
  for (const key of ['lens', 'day', 'since', 'source', 'company'] as const) {
    if (typeof params[key] === 'string') filters[key] = true;
  }
  return { columns: Array.from(types, ([key, type]) => ({ key, type })), filters };
}

function forceCsv(href: string): string {
  try {
    const u = new URL(href, 'https://x.invalid');
    u.searchParams.set('format', 'csv');
    return `${u.pathname}?${u.searchParams.toString()}`;
  } catch {
    return href;
  }
}

export default function AskForData({
  unlocked, datasets,
}: {
  unlocked: boolean;
  datasets: { slug: string; title: string; keyGated: boolean }[];
}) {
  const [question, setQuestion] = useState('');
  const [datasetSel, setDatasetSel] = useState('');
  const [req, setReq] = useState<ReqState>({ status: 'idle' });
  const [copied, setCopied] = useState(false);

  async function run() {
    const trimmed = question.trim();
    if (!trimmed || req.status === 'loading') return;
    setReq({ status: 'loading' });
    try {
      const res = await fetch('/api/portal/query/nl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed, ...(datasetSel ? { dataset: datasetSel } : {}) }),
      });
      let body: { error?: string; message?: string } & Partial<NlResult> = {};
      try { body = await res.json(); } catch { /* non-JSON error body */ }
      if (!res.ok) {
        setReq({ status: 'error', message: body.message || body.error || `Could not build a query (status ${res.status}).` });
        return;
      }
      setReq({
        status: 'done',
        result: {
          dataset: body.dataset ?? '', params: body.params ?? {}, href: body.href ?? '',
          dropped: body.dropped ?? [], explanation: body.explanation ?? '',
        },
      });
    } catch {
      setReq({ status: 'error', message: 'Could not reach the Atlas.' });
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void run();
  }

  function copyUrl(href: string) {
    const abs = `${window.location.origin}${href}`;
    navigator.clipboard?.writeText(abs)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  }

  if (!unlocked) {
    return (
      <div className="plate dp-ask">
        <div className="section-label">Ask for data in words</div>
        <p className="dp-ask-locked">
          Asking for data runs a model call, so it needs an access key.{' '}
          <Link href="/ask">Unlock</Link> or <Link href="/datasets/request">request access</Link>.
        </p>
      </div>
    );
  }

  const result = req.status === 'done' ? req.result : null;

  return (
    <div className="plate dp-ask">
      <div className="section-label">Ask for data in words</div>
      <form className="dp-ask-form" onSubmit={submit}>
        <textarea
          className="input dp-ask-textarea"
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, MAX_QUESTION_LEN))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void run();
            }
          }}
          maxLength={MAX_QUESTION_LEN}
          placeholder="e.g. high-significance signals about labor since August"
          aria-label="Ask for data in words"
          rows={2}
        />
        <div className="dp-ask-row">
          <label className="dp-qb-field">
            <span>Dataset</span>
            <select className="input" value={datasetSel} onChange={(e) => setDatasetSel(e.target.value)} aria-label="Dataset">
              <option value="">Any dataset</option>
              {datasets.map((d) => <option key={d.slug} value={d.slug}>{d.title}</option>)}
            </select>
          </label>
          <button type="submit" className="btn btn--primary btn--sm" disabled={!question.trim() || req.status === 'loading'}>
            {req.status === 'loading' ? 'Thinking…' : 'Build query'}
          </button>
          <span className="dp-ask-counter">{question.length}/{MAX_QUESTION_LEN}</span>
        </div>
        <p className="dp-qb-hint">Each request costs about a cent, charged against the daily Ask budget.</p>
      </form>

      {req.status === 'error' && <p className="dp-qb-hint dp-qb-hint--error">{req.message}</p>}

      {result && (() => {
        const state = fromViewParams(result.params, columnsForParams(result.params));
        const builderHref = `/datasets/${result.dataset}?${toSearchParams(state).toString()}#query`;
        const csvHref = forceCsv(result.href);
        const datasetTitle = datasets.find((d) => d.slug === result.dataset)?.title ?? result.dataset;
        return (
          <div className="dp-ask-result">
            <div className="dp-ask-resulthead">{datasetTitle}</div>
            <p className="dp-qb-desc">{describeState(state)}</p>
            {result.explanation && <p className="dp-ask-explain">{result.explanation}</p>}
            {result.dropped.length > 0 && (
              <ul className="dp-ask-dropped">
                {result.dropped.map((d, i) => <li key={i}>Left out: {d}</li>)}
              </ul>
            )}
            <div className="dp-qb-actions">
              <Link className="btn btn--primary btn--sm" href={builderHref} prefetch={false}>Open in the builder</Link>
              <a className="btn btn--ghost btn--sm" href={csvHref}>Download CSV</a>
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => copyUrl(csvHref)}>
                {copied ? 'Copied' : 'Copy URL'}
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
