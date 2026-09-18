'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { upsertCategoryAction, setCategoryActiveAction } from '@/lib/actions';
import type { ToolingCategory } from '@/lib/types';

// The curated category registry: each row carries its own discovery query
// templates (weekly news-shaped queries, evergreen pull queries, an HN
// keyword string, a GitHub keyword string). Inactive categories keep their
// cataloged products but drop out of discovery. Mirrors Scout's
// VerticalsManager; upsertCategoryAction is keyed on slug, so editing an
// existing category is the same form with its slug pre-filled. The <details>
// stays UNCONTROLLED (native open/close); an "Edit" click only swaps which
// category's data pre-fills the form and forces the panel open via a ref,
// so it never fights the browser's own toggle.
export default function CategoriesManager({ categories }: { categories: ToolingCategory[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editTarget, setEditTarget] = useState<ToolingCategory | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  function toggle(slug: string, active: boolean) {
    startTransition(async () => {
      await setCategoryActiveAction(slug, active);
      router.refresh();
    });
  }

  function startEdit(c: ToolingCategory) {
    setEditTarget(c);
    if (detailsRef.current) detailsRef.current.open = true;
  }

  function cancelEdit() {
    setEditTarget(null);
    if (detailsRef.current) detailsRef.current.open = false;
  }

  return (
    <div className="flex flex-col gap-2">
      {categories.map((c) => (
        <div
          key={c.slug}
          className="rounded-[var(--radius)] border p-3 text-sm"
          style={{ background: 'var(--surface)', borderColor: 'var(--line)', opacity: c.active ? 1 : 0.6 }}
        >
          <div className="flex items-center flex-wrap gap-2">
            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{c.name}</span>
            <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>{c.slug}</span>
            <span className="text-xs" style={{ color: 'var(--faint-ink)', marginLeft: 'auto' }}>
              {c.search_queries.length} weekly quer{c.search_queries.length === 1 ? 'y' : 'ies'} ·
              {' '}{c.pull_queries.length} pull quer{c.pull_queries.length === 1 ? 'y' : 'ies'}
            </span>
            <button type="button" className="btn btn--quiet btn--sm" disabled={pending} onClick={() => startEdit(c)}>
              Edit
            </button>
            <button type="button" className="btn btn--quiet btn--sm" disabled={pending} onClick={() => toggle(c.slug, !c.active)}>
              {c.active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
          {c.description && (
            <p className="text-xs" style={{ color: 'var(--dim)', marginTop: 4 }}>{c.description}</p>
          )}
        </div>
      ))}

      <details ref={detailsRef} style={{ marginTop: 6 }}>
        <summary className="text-xs" style={{ color: 'var(--faint-ink)', cursor: 'pointer' }}>
          Add or edit a category… (same slug updates in place)
        </summary>
        <form
          key={editTarget?.slug ?? 'new'}
          action={async (formData: FormData) => {
            await upsertCategoryAction(formData);
            cancelEdit();
            router.refresh();
          }}
          className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
          style={{ background: 'var(--surface)', borderColor: 'var(--line)', marginTop: 8, maxWidth: 640 }}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="tc-slug">Slug (kebab-case)</label>
              <input id="tc-slug" name="slug" className="input" required pattern="[a-z0-9][a-z0-9-]+"
                defaultValue={editTarget?.slug ?? ''} readOnly={!!editTarget} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="tc-name">Name</label>
              <input id="tc-name" name="name" className="input" required maxLength={80} defaultValue={editTarget?.name ?? ''} />
            </div>
            <div className="field" style={{ width: 110 }}>
              <label htmlFor="tc-sort">Sort order</label>
              <input id="tc-sort" name="sort_order" type="number" className="input" defaultValue={editTarget?.sort_order ?? 0} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="tc-desc">Description (one sentence)</label>
            <input id="tc-desc" name="description" className="input" maxLength={500} defaultValue={editTarget?.description ?? ''} />
          </div>
          <div className="flex items-start gap-3 flex-wrap">
            <div className="field" style={{ flex: 1, minWidth: 260 }}>
              <label htmlFor="tc-search">Weekly queries, one per line ({'{year}'} / {'{month}'} resolve at run time)</label>
              <textarea id="tc-search" name="search_queries" className="input" rows={3}
                placeholder={'best AI coding assistant {month} {year}'}
                defaultValue={editTarget?.search_queries.join('\n') ?? ''} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 260 }}>
              <label htmlFor="tc-pull">Pull queries, one per line (evergreen)</label>
              <textarea id="tc-pull" name="pull_queries" className="input" rows={3}
                placeholder={'best AI coding assistant tools'}
                defaultValue={editTarget?.pull_queries.join('\n') ?? ''} />
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="tc-hn">HN keywords</label>
              <input id="tc-hn" name="hn_query" className="input" maxLength={200} defaultValue={editTarget?.hn_query ?? ''} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="tc-gh">GitHub keywords</label>
              <input id="tc-gh" name="github_query" className="input" maxLength={200} defaultValue={editTarget?.github_query ?? ''} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" className="btn btn--primary btn--sm">Save category</button>
            {editTarget !== null && (
              <button type="button" className="btn btn--quiet btn--sm" onClick={cancelEdit}>Cancel</button>
            )}
          </div>
          <p className="text-xs" style={{ color: 'var(--faint-ink)' }}>
            Leaving a query box empty keeps whatever that category already has; it only replaces a list when
            you type at least one line.
          </p>
        </form>
      </details>
    </div>
  );
}
