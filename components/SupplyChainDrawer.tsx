'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ScNodeView } from '@/lib/supply-chain/map';
import { RISK_DOT_VAR, RISK_LABEL } from '@/lib/supply-chain/map';
import type { ScNodeDetail } from '@/lib/supply-chain/data';
import {
  getSupplyChainNodeAction,
  setSupplyChainNodeMetaAction,
  linkSignalToNodeAction,
  unlinkSignalFromNodeAction,
} from '@/lib/actions';
import { dateLabel } from '@/lib/format';
import { LensBadges } from './SignalBadges';

// The right slide-in detail panel. The graph stays visible and dims behind the backdrop.
// Entrance is a CSS @keyframes (the same idiom the modals use). Static identity renders
// immediately from the node prop; linked signals + the admin note are fetched on open via
// a read action that resolves `personal` server-side. When `admin`, the panel also hosts
// the overlay editors (risk, note, signal links); each write refreshes the panel and the
// map (router.refresh) so the risk dot and pulse stay in sync.
export default function SupplyChainDrawer({
  node,
  layerTitle,
  admin,
  onClose,
}: {
  node: ScNodeView | null;
  layerTitle: string | null;
  admin: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [detail, setDetail] = useState<ScNodeDetail | null>(null);
  const [riskInput, setRiskInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [signalId, setSignalId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // focus + Escape while open
  useEffect(() => {
    if (!node) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [node, onClose]);

  // fetch this node's detail on open; init the admin form from it (setState lands async)
  useEffect(() => {
    if (!node) return;
    let active = true;
    getSupplyChainNodeAction(node.slug).then((d) => {
      if (!active) return;
      setErr(null);
      setDetail(d);
      setRiskInput(d?.risk_override ?? '');
      setNoteInput(d?.admin_note ?? '');
    });
    return () => {
      active = false;
    };
  }, [node]);

  if (!node) return null;

  // trust detail only once it matches the open node (avoids a flash of the previous node)
  const ready = detail != null && detail.node.slug === node.slug;
  const slug = node.slug;

  // re-fetch the displayed detail after a write, without clobbering the form inputs
  const refreshDetail = async () => {
    const d = await getSupplyChainNodeAction(slug);
    setDetail(d);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await refreshDetail();
      router.refresh(); // update the map's risk dot / pulse
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const saveMeta = () => run(() => setSupplyChainNodeMetaAction(slug, riskInput, noteInput));
  const link = () => {
    const id = signalId.trim();
    if (!id) return;
    return run(async () => {
      await linkSignalToNodeAction(slug, id);
      setSignalId('');
    });
  };
  const unlink = (id: string) => run(() => unlinkSignalFromNodeAction(slug, id));

  return (
    <>
      <div className="sc-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="sc-drawer" role="dialog" aria-modal="true" aria-label={node.name}>
        <div className="sc-drawer-top">
          <span className="sc-drawer-crumb">
            Supply chain · {node.layer <= 15 ? `L${node.layer}` : 'Cross-cutting'}
          </span>
          <button ref={closeRef} type="button" className="sc-drawer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <h2 className="sc-drawer-title">{node.name}</h2>

        <div className="sc-drawer-meta">
          {layerTitle && <span className="sc-drawer-layer">{layerTitle}</span>}
          {node.isChokepoint && <span className="badge badge--accent">Chokepoint</span>}
          <span className="sc-risk-pill">
            <i style={{ background: RISK_DOT_VAR[node.risk] }} aria-hidden="true" />
            {RISK_LABEL[node.risk]} risk
          </span>
        </div>

        {node.blurb && <p className="sc-drawer-blurb">{node.blurb}</p>}

        {node.actors.length > 0 && (
          <div className="sc-drawer-section">
            <div className="section-label">Key actors</div>
            <div className="sc-actors">
              {node.actors.map((a) => (
                <span key={a} className="sc-actor">{a}</span>
              ))}
            </div>
          </div>
        )}

        <div className="sc-drawer-section">
          <div className="section-label">Signals</div>
          {!ready ? (
            <p className="sc-drawer-hint">Loading signals…</p>
          ) : detail!.signals.length === 0 ? (
            <p className="sc-drawer-hint">No linked signals yet.</p>
          ) : (
            <div className="sc-sigs">
              {detail!.signals.map((s) => (
                <div key={s.id} className="sc-sig">
                  <Link href={`/signals/${s.id}`} className="sc-sig-title">{s.title}</Link>
                  <div className="sc-sig-meta">
                    <span className="sc-sig-date">{dateLabel(s.published_at) ?? '–'}</span>
                    <LensBadges lenses={s.lenses} />
                    {!s.is_published && (
                      <span className="badge badge--dashed" style={{ fontSize: 10 }}>draft</span>
                    )}
                    {admin && (
                      <button type="button" className="sc-unlink" disabled={busy} onClick={() => unlink(s.id)}>
                        unlink
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {admin && ready && (
          <div className="sc-drawer-section sc-admin">
            <div className="section-label">Admin</div>

            <label className="sc-admin-field">
              <span>Risk</span>
              <select className="input" value={riskInput} disabled={busy} onChange={(e) => setRiskInput(e.target.value)}>
                <option value="">Default ({RISK_LABEL[node.riskDefault]})</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>

            <label className="sc-admin-field">
              <span>Note (admin only)</span>
              <textarea
                className="input"
                rows={3}
                value={noteInput}
                disabled={busy}
                placeholder="Private note about this node…"
                onChange={(e) => setNoteInput(e.target.value)}
              />
            </label>

            <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={saveMeta}>
              Save risk &amp; note
            </button>

            <label className="sc-admin-field" style={{ marginTop: 6 }}>
              <span>Link a signal (paste its id)</span>
              <div className="sc-link-row">
                <input
                  className="input"
                  value={signalId}
                  disabled={busy}
                  placeholder="signal uuid"
                  onChange={(e) => setSignalId(e.target.value)}
                />
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy || !signalId.trim()} onClick={link}>
                  Link
                </button>
              </div>
            </label>

            {err && <p className="sc-admin-err">{err}</p>}
          </div>
        )}
      </aside>
    </>
  );
}
