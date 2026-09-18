'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin, requirePortal, str, parseStringArray, UUID_RE } from './shared';
import { isAdmin } from '../auth';
import { checkPortalBudget } from '../portal/budget';
import { getOrCreateToolingRun, claimToolingRun, advanceToolingRun, progressOf } from '../tooling/engine';
import { getToolingRun, getToolingCategories, getToolingPrefs, getProduct } from '../data/tooling';
import {
  setProductFetchResult, reviewProduct, markProductsReviewed, resetProductScores, updateProductFacts,
  upsertToolingCategory, setToolingCategoryActive, saveToolingPrefs, deleteProductEvent, failToolingRun,
  createProductManual,
} from '../mutations/tooling';
import type { ToolingPrefsPatch } from '../mutations/tooling';
import { enrichProduct } from '../tooling/enrich';
import { scoreChunk } from '../tooling/score';
import { runDeepDive } from '../tooling/deepdive';
import { fetchCandidateText, FetchFailure } from '../pipeline/web';
import type { ToolingProgress, ToolingRunKind, ToolingStatus, ToolingMaturity } from '../types';

// Tooling monitor actions (admin). The cron route is the scheduled driver
// for both cadences; these back the /tooling/console's manual run controls,
// the category/prefs editors, and the curation queue. AI-model actions
// return {error} as data (production server actions redact thrown
// messages, and the console needs the real note); plain DB writes throw on
// bad input, the house convention.

const CATEGORY_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;
const REVIEW_STATUSES: ToolingStatus[] = ['candidate', 'cataloged', 'parked', 'dismissed'];
const MATURITIES: ToolingMaturity[] = [
  'startup_early', 'startup_growth', 'scaleup', 'incumbent', 'big_tech', 'open_source_project', 'unknown',
];

function cleanIds(ids: string[], cap = 200): string[] {
  return [...new Set((ids ?? []).filter((id) => UUID_RE.test(id)))].slice(0, cap);
}

// ---- Run lifecycle -----------------------------------------------------------

export async function startOrResumeToolingAction(
  kind: ToolingRunKind
): Promise<{ runId: string; day: string; created: boolean } | { error: string }> {
  await requireAdmin();
  if (kind !== 'weekly' && kind !== 'pull') return { error: 'Bad run kind.' };
  try {
    return await getOrCreateToolingRun(kind);
  } catch (e) {
    return { error: String((e as Error)?.message ?? 'could not start the run') };
  }
}

// One console tick: at most one substantial work unit (the loop's own 5s
// chaining window lets instant step transitions ride along), fitting the
// page's 60s budget.
export async function toolingTickAction(
  runId: string
): Promise<ToolingProgress | { error: string }> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) return { error: 'Bad run id.' };
  const run = await getToolingRun(runId);
  if (!run) return { error: 'Run not found.' };
  if (!(await claimToolingRun(runId))) {
    return { ...progressOf(run, []), busy: true };
  }
  try {
    const progress = await advanceToolingRun(runId, Date.now() + 5_000);
    revalidatePath('/tooling/console');
    return progress;
  } catch (e) {
    const msg = String((e as Error)?.message ?? 'tooling error');
    await failToolingRun(runId, msg).catch(() => {});
    return { error: msg };
  }
}

// ---- Prefs ---------------------------------------------------------------------

export async function saveToolingPrefsAction(input: ToolingPrefsPatch): Promise<void> {
  await requireAdmin();
  // saveToolingPrefs validates/clamps every field itself (model ids
  // allow-listed, thresholds clamped 0-100, the cap 0-50); this action just
  // forwards whatever the caller passed.
  await saveToolingPrefs(input ?? {});
  revalidatePath('/tooling');
  revalidatePath('/tooling/console');
}

// ---- Categories ---------------------------------------------------------------

export async function upsertCategoryAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const slug = str(formData, 'slug');
  const name = str(formData, 'name');
  if (!CATEGORY_SLUG_RE.test(slug)) throw new Error('Slug must be kebab-case (a-z, 0-9, dashes).');
  if (!name) throw new Error('A category name is required.');
  const searchQueries = str(formData, 'search_queries').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8);
  const pullQueries = str(formData, 'pull_queries').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8);
  await upsertToolingCategory({
    slug,
    name,
    description: str(formData, 'description') || null,
    search_queries: searchQueries,
    pull_queries: pullQueries,
    hn_query: str(formData, 'hn_query') || null,
    github_query: str(formData, 'github_query') || null,
    sort_order: Number(str(formData, 'sort_order')) || 0,
  });
  revalidatePath('/tooling');
  revalidatePath('/tooling/console');
}

export async function setCategoryActiveAction(slug: string, active: boolean): Promise<void> {
  await requireAdmin();
  if (!CATEGORY_SLUG_RE.test(slug)) throw new Error('Bad category slug.');
  await setToolingCategoryActive(slug, Boolean(active));
  revalidatePath('/tooling');
  revalidatePath('/tooling/console');
}

// ---- Curation -------------------------------------------------------------------

// The human gate on the catalog: cataloging a product BY HAND requires a
// why, the rationales discipline applied to the catalog. Dismissing or
// parking needs no note.
export async function reviewProductAction(
  id: string, status: string, pinned: boolean, note: string | null
): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  if (!UUID_RE.test(id)) return { error: 'Bad product id.' };
  if (!(REVIEW_STATUSES as string[]).includes(status)) return { error: 'Bad status.' };
  const why = String(note ?? '').trim().slice(0, 1000);
  if (status === 'cataloged' && !why) return { error: 'Cataloging a product by hand requires a why.' };
  try {
    await reviewProduct(id, status as ToolingStatus, Boolean(pinned), why || null);
    revalidatePath('/tooling');
    revalidatePath('/tooling/console');
    return { ok: true };
  } catch (e) {
    return { error: String((e as Error)?.message ?? 'review error') };
  }
}

export async function bulkReviewAction(
  ids: string[], status: string, note?: string | null
): Promise<{ ok: true; count: number } | { error: string }> {
  await requireAdmin();
  const clean = cleanIds(ids);
  if (!clean.length) return { error: 'No products selected.' };
  if (!(REVIEW_STATUSES as string[]).includes(status)) return { error: 'Bad status.' };
  // Cataloging by hand needs a why (the human gate); a bulk catalog applies
  // ONE shared note to every selected product, so the why still lands on
  // each row.
  const sharedNote = String(note ?? '').trim().slice(0, 500) || null;
  if (status === 'cataloged' && !sharedNote) return { error: 'Cataloging needs a why: add a shared note first.' };
  try {
    await Promise.all(clean.map((id) => reviewProduct(id, status as ToolingStatus, false, sharedNote)));
    revalidatePath('/tooling');
    revalidatePath('/tooling/console');
    return { ok: true, count: clean.length };
  } catch (e) {
    return { error: String((e as Error)?.message ?? 'bulk review error') };
  }
}

export async function markReviewedAction(ids: string[]): Promise<void> {
  await requireAdmin();
  const clean = cleanIds(ids);
  if (!clean.length) return;
  await markProductsReviewed(clean);
  revalidatePath('/tooling');
  revalidatePath('/tooling/console');
}

// Un-parks and clears agent_at so the scoring agent revisits with current
// steering; pinned rows are untouched (resetProductScores's own predicate).
export async function rescoreParkedAction(ids: string[]): Promise<void> {
  await requireAdmin();
  const clean = cleanIds(ids);
  if (!clean.length) return;
  await resetProductScores(clean);
  revalidatePath('/tooling');
  revalidatePath('/tooling/console');
}

export async function updateProductFactsAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = str(formData, 'id');
  if (!UUID_RE.test(id)) throw new Error('Bad product id.');
  const name = str(formData, 'name');
  if (!name) throw new Error('A product name is required.');
  const category = str(formData, 'category');
  if (!category) throw new Error('A category is required.');
  const maturity = str(formData, 'maturity') || 'unknown';
  if (!(MATURITIES as string[]).includes(maturity)) throw new Error('Bad maturity.');
  const foundedRaw = str(formData, 'founded_year');
  const foundedYear = foundedRaw ? Number(foundedRaw) : null;
  if (foundedYear !== null && (!Number.isInteger(foundedYear) || foundedYear < 1980 || foundedYear > 2100)) {
    throw new Error('Founded year out of range.');
  }
  const url = str(formData, 'url');
  if (url && !/^https?:\/\//i.test(url)) throw new Error('The URL must be http(s).');
  const feedUrl = str(formData, 'feed_url');
  if (feedUrl && !/^https?:\/\//i.test(feedUrl)) throw new Error('The feed URL must be http(s).');

  await updateProductFacts(id, {
    name,
    vendor: str(formData, 'vendor') || null,
    vendor_domain: str(formData, 'vendor_domain') || null,
    url: url || null,
    category,
    secondary_categories: parseStringArray(str(formData, 'secondary_categories')),
    one_liner: str(formData, 'one_liner') || null,
    description: str(formData, 'description') || null,
    target_buyer: parseStringArray(str(formData, 'target_buyer')),
    deployment: parseStringArray(str(formData, 'deployment')),
    pricing_model: str(formData, 'pricing_model') || null,
    pricing_note: str(formData, 'pricing_note') || null,
    maturity,
    founded_year: foundedYear,
    hq: str(formData, 'hq') || null,
    funding_note: str(formData, 'funding_note') || null,
    notable_customers: parseStringArray(str(formData, 'notable_customers')),
    integrations: parseStringArray(str(formData, 'integrations')),
    compliance_claims: parseStringArray(str(formData, 'compliance_claims')),
    models_used: parseStringArray(str(formData, 'models_used')),
    features: parseStringArray(str(formData, 'features')),
    feed_url: feedUrl || null,
    changelog_url: str(formData, 'changelog_url') || null,
    github_repo: str(formData, 'github_repo') || null,
  });
  revalidatePath('/tooling');
  revalidatePath('/tooling/console');
}

// ---- Per-product AI tools -------------------------------------------------------

// Hydrates the homepage first when raw_content isn't cached yet, then runs
// the extraction pass (the Scout enrichCompanyAction shape, split across two
// modules here because lib/tooling/enrich.ts's enrichProduct takes
// raw_content directly rather than fetching it itself).
export async function enrichProductAction(
  id: string
): Promise<{ ok: true; isAiTool: boolean } | { error: string }> {
  await requireAdmin();
  if (!UUID_RE.test(id)) return { error: 'Bad product id.' };
  const product = await getProduct(id, { admin: true, portal: false });
  if (!product) return { error: 'Product not found.' };

  let rawContent = product.raw_content ?? null;
  if (!rawContent) {
    if (!product.url) return { error: 'No homepage URL to fetch: add one via the facts editor first.' };
    try {
      const { text, via } = await fetchCandidateText(product.url, { maxChars: 24_000 });
      await setProductFetchResult(id, { text, via });
      rawContent = text;
    } catch (e) {
      const msg = e instanceof FetchFailure ? e.message : String((e as Error)?.message ?? 'fetch failed');
      await setProductFetchResult(id, { error: msg });
      return { error: `Could not fetch the homepage: ${msg}` };
    }
  }

  try {
    const [categories, prefs] = await Promise.all([getToolingCategories(true), getToolingPrefs()]);
    const result = await enrichProduct(
      { id, name: product.name, category: product.category, raw_content: rawContent },
      categories,
      prefs.enrich_model,
      null
    );
    revalidatePath('/tooling');
    revalidatePath(`/tooling/${product.slug}`);
    revalidatePath('/tooling/console');
    return { ok: true, isAiTool: result.isAiTool };
  } catch (e) {
    return { error: String((e as Error)?.message ?? 'enrichment failed') };
  }
}

export async function scoreProductAction(
  id: string
): Promise<{ ok: true; cataloged: boolean } | { error: string }> {
  await requireAdmin();
  if (!UUID_RE.test(id)) return { error: 'Bad product id.' };
  try {
    const result = await scoreChunk([id], null);
    if (!result.processed) return { error: 'The scorer returned nothing usable. Try again.' };
    revalidatePath('/tooling');
    revalidatePath('/tooling/console');
    return { ok: true, cataloged: result.cataloged > 0 };
  } catch (e) {
    return { error: String((e as Error)?.message ?? 'scoring failed') };
  }
}

export async function adminDeepDiveAction(
  id: string, steering: string | null
): Promise<{ ok: true; eventsAdded: number } | { error: string }> {
  await requireAdmin();
  if (!UUID_RE.test(id)) return { error: 'Bad product id.' };
  const steer = String(steering ?? '').trim().slice(0, 1500) || null;
  const result = await runDeepDive(id, steer, 'tooling_deepdive', { timeoutMs: 90_000 });
  if (!result.ok) return { error: result.error };
  revalidatePath('/tooling');
  revalidatePath('/tooling/console');
  return { ok: true, eventsAdded: result.eventsAdded };
}

export async function deleteProductEventAction(id: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad event id.');
  await deleteProductEvent(id);
  revalidatePath('/tooling');
  revalidatePath('/tooling/console');
}

// ---- portal actions (WP4: addProductAction, deepDiveAction, and the report
// build/save/publish actions land below this line) --------------------------

const GENERIC_PRODUCT_ERROR = 'Unknown product.';

// Manual add (portal + admin): lands as a candidate, deduped against the
// whole catalog by url_key/name_key (createProductManual's matchExisting),
// so adding a product discovery already found routes to the existing row.
export async function addProductAction(formData: FormData): Promise<void> {
  await requirePortal();
  const name = str(formData, 'name');
  if (name.length < 2 || name.length > 200) throw new Error('A product name (2-200 characters) is required.');
  const url = str(formData, 'url');
  if (url && !/^https?:\/\//i.test(url)) throw new Error('The URL must be http(s).');
  const category = str(formData, 'category');
  const categories = await getToolingCategories(true);
  if (!categories.some((c) => c.slug === category)) throw new Error('Unknown category.');
  const oneLiner = str(formData, 'one_liner');
  if (oneLiner.length > 300) throw new Error('The one-liner must be 300 characters or fewer.');

  const { slug } = await createProductManual({
    name,
    vendor: str(formData, 'vendor') || null,
    url: url || null,
    category,
    one_liner: oneLiner || null,
  });
  revalidatePath('/tooling');
  redirect(`/tooling/${slug}`);
}

// The Scout gate template (gateScoutTarget), applied to tooling: requirePortal
// admits admins implicitly; a non-admin's target must be visible to a portal
// viewer (candidate/parked/cataloged, never dismissed) and pass the shared
// daily budget before a Sonnet call is spent. Admin calls log feature
// 'tooling_deepdive'; portal calls log 'portal_tooling' (summed by
// checkPortalBudget alongside portal_ask/portal_scout).
export async function deepDiveAction(
  id: string, steering: string | null
): Promise<{ ok: true; eventsAdded: number } | { ok: false; error: string }> {
  await requirePortal();
  const admin = await isAdmin();
  if (!UUID_RE.test(id)) return { ok: false, error: GENERIC_PRODUCT_ERROR };
  const product = await getProduct(id, { admin, portal: true });
  if (!product) return { ok: false, error: GENERIC_PRODUCT_ERROR };
  if (!admin) {
    const budget = await checkPortalBudget();
    if (!budget.ok) return { ok: false, error: 'The team daily AI budget is spent. It resets at midnight UTC.' };
  }
  const steer = String(steering ?? '').trim().slice(0, 1500) || null;
  const result = await runDeepDive(id, steer, admin ? 'tooling_deepdive' : 'portal_tooling', { timeoutMs: 90_000 });
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath('/tooling');
  revalidatePath(`/tooling/${product.slug}`);
  return { ok: true, eventsAdded: result.eventsAdded };
}
