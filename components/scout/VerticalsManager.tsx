'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addVerticalAction, setVerticalActiveAction } from '@/lib/actions';
import type { ScoutVertical } from '@/lib/types';

// The verticals registry: each row is one slice of the acquisition thesis and
// carries its own discovery query templates ({year}/{month} tokens resolve per
// run). Inactive verticals keep their tracked companies but skip discovery.
export default function VerticalsManager({ verticals }: { verticals: ScoutVertical[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle(slug: string, active: boolean) {
    startTransition(async () => {
      await setVerticalActiveAction(slug, active);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {verticals.map((v) => (
        <div
          key={v.slug}
          className="rounded-[var(--radius)] border p-3 text-sm"
          style={{ background: 'var(--surface)', borderColor: 'var(--line)', opacity: v.active ? 1 : 0.6 }}
        >
          <div className="flex items-center flex-wrap gap-2">
            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{v.name}</span>
            <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>{v.slug}</span>
            <span className="text-xs" style={{ color: 'var(--faint-ink)', marginLeft: 'auto' }}>
              {v.tracked_count ?? 0} tracked{v.queued_count != null ? ` · ${v.queued_count} queued` : ''}
            </span>
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              disabled={pending}
              onClick={() => toggle(v.slug, !v.active)}
            >
              {v.active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
          {v.description && (
            <p className="text-xs" style={{ color: 'var(--dim)', marginTop: 4 }}>{v.description}</p>
          )}
          {v.search_queries.length > 0 && (
            <p className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
              {v.search_queries.length} discovery quer{v.search_queries.length === 1 ? 'y' : 'ies'}
            </p>
          )}
        </div>
      ))}

      <details style={{ marginTop: 6 }}>
        <summary className="text-xs" style={{ color: 'var(--faint-ink)', cursor: 'pointer' }}>
          Add or edit a vertical… (same slug updates in place)
        </summary>
        <form
          action={addVerticalAction}
          className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
          style={{ background: 'var(--surface)', borderColor: 'var(--line)', marginTop: 8, maxWidth: 560 }}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="v-slug">Slug (kebab-case)</label>
              <input id="v-slug" name="slug" className="input" required pattern="[a-z0-9][a-z0-9-]+" />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="v-name">Name</label>
              <input id="v-name" name="name" className="input" required maxLength={80} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="v-desc">Description (one sentence)</label>
            <input id="v-desc" name="description" className="input" maxLength={200} />
          </div>
          <div className="field">
            <label htmlFor="v-queries">Discovery queries, one per line ({'{year}'} and {'{month}'} resolve at run time)</label>
            <textarea
              id="v-queries"
              name="search_queries"
              className="input"
              rows={4}
              placeholder={'AI fintech startup raises seed round {month} {year}'}
            />
          </div>
          <div>
            <button type="submit" className="btn btn--primary btn--sm">Save vertical</button>
          </div>
        </form>
      </details>
    </div>
  );
}
