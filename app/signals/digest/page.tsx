import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { getSignals } from '@/lib/data';
import {
  SIGNAL_LENS_SLUGS, SIGNAL_LENS_LABEL, SIGNIFICANCE_LABEL, dateLabel,
} from '@/lib/format';
import { LensBadges, SignificanceTag } from '@/components/SignalBadges';
import type { SignalLens, Significance } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Signal digest · The AI Atlas' };

// Admin-only, not linked in nav. A clean, print-friendly snapshot suitable for HTML/PDF
// capture by the (future) digest job. It only renders — no sending logic here. Accepts
// ?since=YYYY-MM-DD&lenses=market,regulatory&significance=high. Fully server-rendered so
// a headless capture reads it correctly with no client-only state.
export default async function DigestPage({
  searchParams,
}: {
  searchParams: Promise<{ since?: string; lenses?: string; significance?: string }>;
}) {
  const admin = await isAdmin();
  if (!admin) redirect('/login');
  const sp = await searchParams;

  const validLens = new Set<string>(SIGNAL_LENS_SLUGS);
  const lenses = (sp.lenses || '')
    .split(',').map((s) => s.trim()).filter((l) => validLens.has(l)) as SignalLens[];
  const validSig = new Set(['high', 'medium', 'low']);
  const significance = (sp.significance || '')
    .split(',').map((s) => s.trim()).filter((s) => validSig.has(s)) as Significance[];
  const since = sp.since && /^\d{4}-\d{2}-\d{2}/.test(sp.since) ? sp.since : undefined;

  const signals = await getSignals({
    publishedOnly: true,
    since,
    lenses: lenses.length ? lenses : undefined,
    significance: significance.length ? significance : undefined,
  });

  const parts: string[] = [];
  if (since) parts.push(`since ${since}`);
  if (lenses.length) parts.push(lenses.map((l) => SIGNAL_LENS_LABEL[l]).join(', '));
  if (significance.length) parts.push(`${significance.map((s) => SIGNIFICANCE_LABEL[s]).join('/')} significance`);
  const filterLine = parts.length ? parts.join(' · ') : 'all published signals';

  return (
    <main className="digest">
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, margin: '0 0 4px', color: 'var(--ink)' }}>
          AI Atlas · Signal Digest
        </h1>
        <p style={{ color: 'var(--dim)', fontSize: 13, margin: 0 }}>
          {filterLine} · {signals.length} signal{signals.length === 1 ? '' : 's'}
        </p>
      </header>

      {signals.length === 0 ? (
        <p style={{ color: 'var(--faint-ink)' }}>No published signals match this range.</p>
      ) : (
        signals.map((s) => (
          <article key={s.id} className="digest-item">
            <div className="signal-top" style={{ marginBottom: 6 }}>
              <LensBadges lenses={s.lenses} />
              <SignificanceTag significance={s.significance} />
            </div>
            <h3>{s.title}</h3>
            {s.summary && (
              <p style={{ color: 'var(--dim)', fontSize: 14, lineHeight: 1.55, margin: '0 0 6px' }}>{s.summary}</p>
            )}
            <div
              style={{
                display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
                fontSize: 12, color: 'var(--faint-ink)',
              }}
            >
              <span>{dateLabel(s.published_at)}</span>
              {s.claim_touches.length > 0 && <span>· touches {s.claim_touches.join(', ')}</span>}
              {s.source_title && <span>· {s.source_title}</span>}
            </div>
          </article>
        ))
      )}
    </main>
  );
}
