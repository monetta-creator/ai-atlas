import Link from 'next/link';
import { getPortalIdentity } from '@/lib/portal/identity';
import { DATASETS } from '@/lib/datasets/registry';
import { toDatasetCard, CATEGORY_LABELS, type DatasetAccessFilter } from '@/lib/datasets/cards';
import { getEditContext } from '@/lib/content';
import PageTop from '@/components/PageTop';
import Editable from '@/components/Editable';
import RenewalNotice, { type RenewalState } from '@/components/portal/RenewalNotice';
import DatasetCatalog from '@/components/datasets/DatasetCatalog';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Data Portal · The AI Atlas' };

// The public Datasets portal hub: a filterable, searchable card grid over the
// catalog of downloadable datasets (public ones guest-safe, the key-gated
// exports behind the access key) plus the door to the team Ask surface.
// Nothing here calls a model. Card shaping is pure (lib/datasets/cards.ts:
// toDatasetCard throws on a registry category with no label, so a new
// category can never silently drop its datasets). The enter link lands here
// with ?key=expired|revoked when a lapsed key was used, so the notice
// renders even before the cookie identity says so; ?q=/&access=/&category=
// seed the filter plate so a filtered view stays a bookmarkable/shareable link.
export default async function DatasetsPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string; q?: string; access?: string; category?: string }>;
}) {
  const [identity, sp] = await Promise.all([getPortalIdentity(), searchParams]);
  const admin = identity.tier === 'admin';
  const portal = identity.active;
  const notice: RenewalState | null = identity.state === 'expired' || identity.state === 'revoked'
    ? identity
    : sp.key === 'expired' || sp.key === 'revoked'
      ? { state: sp.key, expiresAt: null }
      : null;
  const { editing, txt } = await getEditContext();
  const cards = DATASETS.map(toDatasetCard);
  const access: DatasetAccessFilter = sp.access === 'public' || sp.access === 'key' ? sp.access : 'all';
  const q = (typeof sp.q === 'string' ? sp.q : '').slice(0, 120);
  const category = typeof sp.category === 'string' && sp.category in CATEGORY_LABELS ? sp.category : '';

  return (
    <>
      <section className="wrap" style={{ paddingBottom: 100 }}>
        <PageTop
          pathname="/datasets"
          label="Data Portal"
          viewer={{ admin, portal }}
          title={
            <Editable
              as="h1"
              k="datasets.title"
              value={txt('datasets.title', 'Data Portal')}
              editing={editing}
            />
          }
          action={
            <>
              {!portal && <Link href="/datasets/request" className="btn btn--ghost">Request access</Link>}
              <Link href="/ask" className="btn btn--primary">Ask the Atlas</Link>
            </>
          }
        />

        <RenewalNotice identity={notice} style={{ marginBottom: 24 }} />

        <DatasetCatalog
          cards={cards}
          viewer={{ admin, portal }}
          initial={{ q, access, category }}
        />

        <p style={{ fontSize: 12.5, color: 'var(--faint-ink)', lineHeight: 1.7, maxWidth: 640, marginTop: 40 }}>
          Public datasets carry only the published layer of the Atlas. The key-gated exports add
          retained article text and machine-extracted records; the argument map&apos;s personal layer
          (confidence values, rationales, source reliability priors) never enters any download, and
          the one reviewer-set value that does ship, the research export&apos;s rigor prior, rides only
          behind the access key. Retained article text is an internal working corpus; link to the
          original source when sharing outward.
        </p>
      </section>
    </>
  );
}
