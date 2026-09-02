// Pure decision-validation core for the once-per-domain model rating
// (lib/scan/source-rating.ts calls the model; this module turns its raw
// output into rows lib/mutations/scan.ts's upsertSourceTiers can write).
// DELIBERATELY dependency-light (only source-tiers.ts, itself import-free) so
// scripts/test-scan.mjs can load it under plain-Node type stripping: keep
// runtime imports (dossier.ts, llm.ts, db.ts) out of this module.

// Explicit .ts extension so plain Node (scripts/test-scan.mjs,
// scripts/backfill-source-tiers.mjs) can load this module chain; the
// bundler resolves it the same (allowImportingTsExtensions is on).
import {
  KIND_TIER, isSourceKind, isSourceTier, normalizeDomain,
  type SourceKind, type SourceTier,
} from './source-tiers.ts';

export interface RatingCandidate {
  domain: string;
  sample_headline: string | null;
}

export interface RatedDomainRow {
  domain: string;
  kind: SourceKind;
  tier: SourceTier;
  rated_by: 'model';
  reason: string | null;
  sample_headline: string | null;
}

interface RawDomainRating {
  domain?: unknown;
  kind?: unknown;
  tier?: unknown;
  reason?: unknown;
}

// Turn the model's raw ratings array into rows the writer can persist:
// domains outside the batch or repeated are dropped, an invalid kind is
// dropped, and the tier is clamped to the kind's default tier or one step
// weaker (never a tier number lower than the kind implies, i.e. never a
// rating stronger than the kind's default). Every domain is normalized once.
export function acceptDomainRatings(
  raw: { ratings?: unknown[] } | null | undefined,
  candidates: RatingCandidate[]
): RatedDomainRow[] {
  const byDomain = new Map(candidates.map((c) => [normalizeDomain(c.domain), c]));
  const seen = new Set<string>();
  const out: RatedDomainRow[] = [];
  const list = Array.isArray(raw?.ratings) ? (raw.ratings as RawDomainRating[]) : [];
  for (const r of list) {
    const domain = normalizeDomain(String(r?.domain ?? ''));
    if (!domain || seen.has(domain) || !byDomain.has(domain)) continue;
    const kind = r?.kind;
    if (!isSourceKind(kind)) continue;
    const tierRaw = Number(r?.tier);
    if (!Number.isFinite(tierRaw)) continue;
    // A model-rated 'primary' caps at tier 2: the model calls any company's own
    // site primary (career portals, claim portals, sports leagues), and a
    // self-published page is reliable about itself but unverified as the
    // actual company. Curated primaries (the labs, the card networks) stay 1.
    const floor = kind === 'primary' ? 2 : KIND_TIER[kind];
    const ceiling = Math.min(4, floor + 1);
    const tier = Math.min(Math.max(Math.round(tierRaw), floor), ceiling);
    if (!isSourceTier(tier)) continue;
    seen.add(domain);
    const reason = typeof r?.reason === 'string' ? r.reason.trim().slice(0, 300) : '';
    out.push({
      domain,
      kind,
      tier,
      rated_by: 'model',
      reason: reason || null,
      sample_headline: byDomain.get(domain)?.sample_headline ?? null,
    });
  }
  return out;
}
