import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isAdmin } from '@/lib/auth';
import { getWorldview, getNodeOptions } from '@/lib/data';
import {
  createPositionAction,
  addPositionComponentAction,
  removePositionComponentAction,
  deletePositionAction,
} from '@/lib/actions';
import { DOMAIN_LABEL } from '@/lib/format';
import Header from '@/components/Header';
import ConfidenceEditor from '@/components/ConfidenceEditor';
import ConfidenceBadge from '@/components/ConfidenceBadge';
import PositionStatementEditor from '@/components/PositionStatementEditor';
import WorkspaceTabs, { MAP_EDITOR_TABS } from '@/components/WorkspaceTabs';
import type { NodeOption } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function WorldviewPage() {
  const admin = await isAdmin();
  if (!admin) redirect('/login');

  const [{ spine, positions }, nodes] = await Promise.all([getWorldview(), getNodeOptions()]);

  const optionGroup = (label: string, opts: NodeOption[]) => (
    <optgroup label={label}>
      {opts.map((o) => (
        <option key={`${o.type}:${o.id}`} value={`${o.type}:${o.id}`}>
          {o.code} · {o.label.length > 70 ? o.label.slice(0, 69) + '…' : o.label}
        </option>
      ))}
    </optgroup>
  );

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 860, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/map">Map</Link> / Worldview
        </div>
        <header className="pagehead" style={{ padding: '24px 0 22px' }}>
          <h1>Worldview &amp; spine</h1>
          <p className="lede">
            The bridge-claims that link domains, and the cross-cutting positions that span more than
            one question.
          </p>
        </header>
        <WorkspaceTabs tabs={MAP_EDITOR_TABS} active="/worldview" />

        <div className="wv-section">
          <h2>The spine</h2>
          <div className="wv-spine">
            {spine.map((b) => (
              <Link key={b.id} href={`/bridge/${b.code}`} className="wv-bridge">
                <span className="wv-bridge__code">⤧ {b.code}</span>
                <span className="wv-bridge__statement">{b.statement}</span>
                <span className="wv-bridge__domains">
                  {DOMAIN_LABEL[b.domain_from]} → {DOMAIN_LABEL[b.domain_to]}
                </span>
                <ConfidenceBadge label={b.confidence_label} />
              </Link>
            ))}
          </div>
        </div>

        <div className="wv-section">
          <h2>Cross-cutting positions ({positions.length})</h2>

          {positions.length === 0 && (
            <p className="wv-empty">
              No positions yet. A cross-cutting position spans questions and doesn&apos;t map to any
              single stance, for example &ldquo;capability is real, the economics are shaky, and the
              market is heterogeneously mispriced.&rdquo; Add one below, then link the stances, claims,
              and bridges that compose it.
            </p>
          )}

          {positions.map((pos) => (
            <div key={pos.id} className="wv-position">
              <PositionStatementEditor id={pos.id} statement={pos.statement} />

              <div className="wv-components">
                {pos.components.length === 0 && (
                  <span className="wv-empty-inline">No components linked yet.</span>
                )}
                {pos.components.map((c) => (
                  <span key={c.id} className="wv-chip">
                    <Link href={c.href} className="wv-chip__link">
                      <span className="wv-chip__code">{c.code}</span>
                      <span className="wv-chip__label">
                        {c.label.length > 56 ? c.label.slice(0, 55) + '…' : c.label}
                      </span>
                    </Link>
                    <form action={removePositionComponentAction} className="wv-chip__remove">
                      <input type="hidden" name="component_id" value={c.id} />
                      <button type="submit" aria-label={`Remove ${c.code}`} title="Remove">×</button>
                    </form>
                  </span>
                ))}
              </div>

              <form action={addPositionComponentAction} className="wv-add">
                <input type="hidden" name="position_id" value={pos.id} />
                <select name="target" className="input" defaultValue="">
                  <option value="" disabled>
                    Link a stance, claim, or bridge…
                  </option>
                  {optionGroup('Stances', nodes.stances)}
                  {optionGroup('Claims', nodes.claims)}
                  {optionGroup('Bridge-claims', nodes.bridges)}
                </select>
                <button type="submit" className="btn btn--ghost btn--sm">Add</button>
              </form>

              <ConfidenceEditor
                targetType="position"
                targetId={pos.id}
                current={pos.confidence}
                redirectTo="/worldview"
              />

              <form action={deletePositionAction} className="wv-delete">
                <input type="hidden" name="id" value={pos.id} />
                <button type="submit" className="btn btn--danger btn--sm">Delete position</button>
              </form>
            </div>
          ))}

          <form action={createPositionAction} className="wv-create">
            <div className="field">
              <label htmlFor="new-position">Add a position</label>
              <textarea
                id="new-position"
                name="statement"
                className="input"
                rows={3}
                placeholder="State the spanning view in a sentence or two…"
                style={{ resize: 'vertical' }}
              />
            </div>
            <button type="submit" className="btn btn--primary btn--sm">Add position</button>
          </form>
        </div>
      </section>
    </>
  );
}
