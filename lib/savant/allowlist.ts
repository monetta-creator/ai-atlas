import type { CitationAllowlist } from '../citations';
import type { SavantPack } from './types';

// Savant's citation allow-list (plain-Node loadable: type imports only).
// Every url and in-app href the pack carries, the query-stripped twin of
// each external url (the edition's lesson: models drop ?utm= and ?amp=1),
// the metric source pages built from registry identifiers, and the
// hypotheses' hrefs. enforceCitations strips anything else at save and again
// at render, so the issue can never link outside its own evidence.

const urlForms = (u: string): string[] => {
  const out = [u];
  if (/^https?:\/\//i.test(u)) {
    const bare = u.replace(/[?#].*$/, '');
    if (bare !== u) out.push(bare);
  }
  return out;
};

export function allowlistForSavant(pack: SavantPack): CitationAllowlist {
  const hrefs = new Set<string>();
  const tagByHref = new Map<string, string>();
  const add = (u: string | null | undefined) => {
    if (!u) return;
    for (const f of urlForms(u)) hrefs.add(f);
  };
  for (const c of pack.notebook.connections) {
    add(c.record.url); add(c.record.href); add(c.target.href);
    tagByHref.set(c.target.href, c.target.code);
  }
  for (const e of pack.notebook.echoes) { add(e.a.url); add(e.a.href); add(e.b.url); add(e.b.href); }
  for (const m of pack.notebook.misses) add(m.url);
  for (const s of pack.moved.signals) { add(s.url); add(s.href); }
  for (const c of pack.moved.topClaims) { add(c.href); tagByHref.set(c.href, c.code); }
  for (const r of pack.regulation) { add(r.url); add(r.href); }
  for (const p of pack.research) add(p.href);
  for (const t of pack.tools.entrants) add(t.href);
  for (const r of pack.tools.releases) { add(r.url); add(r.productHref); }
  for (const r of pack.tools.reads) { add(r.url); add(r.hnUrl); add(r.catalogHref); }
  for (const a of pack.ahead) { add(a.url); add(a.href); }
  const peerRows = [...(pack.peers.self ? [pack.peers.self] : []), ...pack.peers.tiers.flatMap((t) => t.rows)];
  for (const row of peerRows) {
    for (const m of row.metrics) add(m.sourceUrl);
    add(row.cfpb.sourceUrl);
    for (const f of row.filings) { add(f.url); add(f.href); }
  }
  for (const h of [...(pack.hypotheses.fresh ? [pack.hypotheses.fresh] : []), ...pack.hypotheses.open]) {
    for (const u of h.updates) for (const href of u.hrefs) add(href);
  }
  // Every self_record url for the reader organization (mig 0076), not only
  // the ones the cited profile or recent timeline already picked up, so a
  // sentence written from the record can still link its source.
  for (const u of pack.self?.recordUrls ?? []) add(u);
  for (const m of pack.mapHrefs) { hrefs.add(m.href); tagByHref.set(m.href, m.code); }
  // The Atlas's own question pages are always fair to link.
  for (const slug of ['capability', 'build-out', 'unit-economics', 'mispricing', 'rent', 'geopolitics', 'labor']) hrefs.add(`/q/${slug}`);
  return { hrefs, tagByHref };
}
