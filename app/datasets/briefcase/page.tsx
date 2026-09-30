import Link from 'next/link';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { q } from '@/lib/db';
import { getPortalIdentity } from '@/lib/portal/identity';
import { descriptionFor } from '@/lib/page-info';
import { getDataset } from '@/lib/datasets/registry';
import { buildDatasetHandoff } from '@/lib/datasets/handoff-generic';
import { loadPackInputs } from '@/lib/context-pack/load';
import { briefAddsContent, buildSections, renderTier } from '@/lib/context-pack/core';
import { dateLabel } from '@/lib/format';
import PageTop from '@/components/PageTop';
import EntityLogo from '@/components/EntityLogo';
import PortalUnlock from '@/components/datasets/PortalUnlock';
import CopyHandoff from '@/components/scan/CopyHandoff';
import PackDownloads from '@/components/briefcase/PackDownloads';

// The Briefcase: company context packs, one card per tracked company, three
// downloads each (docs/context-pack.md). Key-gated content on a public page:
// the registry is private, so a guest gets the explainer and the unlock and
// never a company name. Nothing here calls a model; the sizes on each card
// are rendered from the same rows the downloads serve.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Briefcase · Data Portal · The AI Atlas', description: descriptionFor('/datasets/briefcase') };

const TIER_LABEL: Record<string, string> = {
  self: 'Reader organization', card_issuer: 'Card issuers', consumer_bank: 'Consumer banks',
  fintech: 'Fintechs', tech_platform: 'Tech platforms', wildcard: 'Wildcards',
};

function Explainer() {
  return (
    <div className="bc-explain">
      <div className="bc-explain-item">
        <p className="bc-explain-name">Base <span>.md · about 10k tokens</span></p>
        <p>Standing context. Small enough to sit in every prompt about the company.</p>
      </div>
      <div className="bc-explain-item">
        <p className="bc-explain-name">Brief <span>.md · about 50k tokens</span></p>
        <p>One deep task on one company, for a model that reads long context well.</p>
      </div>
      <div className="bc-explain-item">
        <p className="bc-explain-name">Sections <span>.json · rows of about 2k tokens</span></p>
        <p>The whole pack as rows, for full-text and vector search. Load these through the intake.</p>
      </div>
    </div>
  );
}

export default async function BriefcasePage() {
  const identity = await getPortalIdentity();
  const viewer = { admin: identity.tier === 'admin', portal: identity.active };
  const allowed = viewer.admin || viewer.portal;

  if (!allowed) {
    return (
      <section className="wrap bc-page" style={{ paddingBottom: 100 }}>
        <PageTop pathname="/datasets/briefcase" label="Briefcase" viewer={viewer} title={<h1>Briefcase</h1>} />
        <p className="bc-lede">
          Company context you can carry to a model that cannot reach the Atlas. Public records only, cited line by line.
        </p>
        <Explainer />
        <div style={{ marginTop: 28 }}>
          <PortalUnlock keyState={identity.state === 'expired' || identity.state === 'revoked' ? identity : null} />
        </div>
      </section>
    );
  }

  const inputs = await loadPackInputs(q, null);
  const cards = inputs.map((input) => {
    const base = renderTier(input, 'base');
    const brief = renderTier(input, 'brief');
    const sections = buildSections(input).filter((s) => s.kind !== 'check');
    const briefWeek = input.briefs.map((b) => b.weekEnd).sort().pop() ?? null;
    return {
      slug: input.company.slug, name: input.company.name, tier: input.company.tier, domain: input.company.domain ?? null,
      deep: input.company.deepRecord, showBrief: briefAddsContent(base, brief), briefWeek,
      records: input.records.length, facts: input.facts.length, items: input.items.length,
      sizes: { base: base.tokens, brief: brief.tokens, sections: sections.reduce((n, s) => n + s.tokens, 0), rows: sections.length },
    };
  });
  const groups = [
    { label: TIER_LABEL.self, note: 'The full public record since ChatGPT.', cards: cards.filter((c) => c.tier === 'self') },
    { label: 'Deep records', note: 'Peers with a backfilled public record.', cards: cards.filter((c) => c.tier !== 'self' && c.deep) },
    ...['card_issuer', 'consumer_bank', 'fintech', 'tech_platform', 'wildcard'].map((tier) => ({
      label: TIER_LABEL[tier], note: 'Light packs, from tracked news, facts and metrics.',
      cards: cards.filter((c) => c.tier === tier && !c.deep),
    })),
  ].filter((g) => g.cards.length);

  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host') ?? 'localhost:3000'}`;
  const def = getDataset('context-pack');
  const handoff = def ? buildDatasetHandoff(def, { origin }) : '';
  const asOf = inputs[0]?.asOf ?? null;
  const lastBrief = cards.map((c) => c.briefWeek).filter((w): w is string => Boolean(w)).sort().pop() ?? null;

  return (
    <section className="wrap bc-page" style={{ paddingBottom: 100 }}>
      <PageTop
        pathname="/datasets/briefcase"
        label="Briefcase"
        viewer={viewer}
        title={<h1>Briefcase</h1>}
        action={<Link className="btn btn--quiet btn--sm" href="/datasets/context-pack">Dataset and query builder</Link>}
      >
        {[
          `${cards.length} companies`,
          `${cards.filter((c) => c.deep).length} deep`,
          asOf ? `built ${dateLabel(asOf)}` : null,
          lastBrief ? `briefs for the week of ${dateLabel(lastBrief)}` : 'no briefs written yet',
        ].filter(Boolean).join(' · ')}
      </PageTop>
      <p className="bc-lede">
        Company context you can carry to a model that cannot reach the Atlas. Public records only, cited line by line.
      </p>
      <Explainer />

      {groups.map((g) => (
        <div key={g.label} className="bc-group">
          <div className="bc-group-head">
            <h2 className="bc-group-title">{g.label}</h2>
            <p className="bc-group-note">{g.note}</p>
          </div>
          <div className="bc-grid">
            {g.cards.map((c) => (
              <article key={c.slug} className={`bc-card${c.tier === 'self' ? ' bc-card--self' : ''}`}>
                <header className="bc-card-head">
                  <EntityLogo name={c.name} domain={c.domain} size={30} />
                  <div className="bc-card-name">
                    <h3>{c.name}</h3>
                    <p>
                      {[
                        c.records ? `${c.records.toLocaleString('en-US')} documents` : null,
                        `${c.facts.toLocaleString('en-US')} facts`,
                        `${c.items.toLocaleString('en-US')} news items`,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className={`bc-tag${c.deep ? ' bc-tag--deep' : ''}`}>{c.deep ? 'Deep' : 'Light'}</span>
                </header>
                <PackDownloads slug={c.slug} sizes={c.sizes} showBrief={c.showBrief} />
              </article>
            ))}
          </div>
        </div>
      ))}

      <div className="bc-handoff">
        <h2 className="bc-group-title">Loading a pack inside the firewall</h2>
        <p className="bc-group-note">
          The orientation document for the intake on the other side: the row contract, which file is for which
          job, and how to treat model-written rows.
        </p>
        <CopyHandoff text={handoff} label="Copy importer handoff" />
      </div>
    </section>
  );
}
