'use client';

import Link from 'next/link';
import type { Company, ScoutVertical } from '@/lib/types';
import { COMPANY_STAGE_LABEL, SCOUT_VERDICT_LABEL, scoutVerdictColor } from '@/lib/format';
import CompanyReviewControls from './CompanyReviewControls';

// The console's review queue: one card per queued company, the agent's read
// (when scored) as an advisory chip, and the human controls inline.
export default function CompanyReviewList({
  companies, verticals,
}: {
  companies: Company[];
  verticals: ScoutVertical[];
}) {
  const verticalName = new Map(verticals.map((v) => [v.slug, v.name]));

  if (companies.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>
        The queue is clear. Discovery runs and manual adds land here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {companies.map((c) => (
        <div
          key={c.id}
          className="rounded-[var(--radius)] border p-3"
          style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
        >
          <div className="flex items-baseline flex-wrap gap-2">
            <Link href={`/scout/${c.id}`} className="hover:underline" style={{ color: 'var(--ink)', fontWeight: 600 }}>
              {c.name}
            </Link>
            {c.url && (
              <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-xs hover:underline" style={{ color: 'var(--faint-ink)' }}>
                {c.domain ?? '↗'} ↗
              </a>
            )}
            {c.agent_verdict && (
              <span className="text-xs" style={{ color: scoutVerdictColor(c.agent_verdict), fontWeight: 600 }}>
                ✦ {SCOUT_VERDICT_LABEL[c.agent_verdict]}
                {c.agent_confidence != null ? ` ${c.agent_confidence}%` : ''}
              </span>
            )}
            <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
              {verticalName.get(c.vertical) ?? c.vertical} · {COMPANY_STAGE_LABEL[c.stage]}
              {c.founded_year ? ` · ${c.founded_year}` : ''}
            </span>
          </div>
          {c.one_liner && (
            <p className="text-sm" style={{ color: 'var(--dim)', marginTop: 4 }}>{c.one_liner}</p>
          )}
          {c.agent_reason && (
            <p className="text-xs" style={{ color: 'var(--dim)', marginTop: 4 }}>
              <span style={{ color: 'var(--faint-ink)' }}>Agent: </span>{c.agent_reason}
            </p>
          )}
          <div style={{ marginTop: 10 }}>
            <CompanyReviewControls id={c.id} status={c.status} prefillNote={c.agent_reason ?? null} />
          </div>
        </div>
      ))}
    </div>
  );
}
