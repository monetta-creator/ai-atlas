'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isAdmin } from '../auth';
import * as m from '../mutations';
import {
  getScoutVerticals, getCompany, getCompanyDocumentText } from '../data';
import { checkPortalBudget } from '../portal/budget';
import { discoverScoutBatch } from '../scout/discovery';
import { scoutPlan, type ScoutBatchRef } from '../scout/core';
import { scoreScoutChunk } from '../scout/agent';
import { enrichCompany } from '../scout/enrich';
import { runIntelSweep } from '../scout/intel';
import { extractFromDocument } from '../scout/docread';
import { scanCompetitors } from '../scout/competitors';
import type {
  CompanyStatus, CompanyStage, CompanyEventKind,
} from '../types';
import { UUID_RE, requireAdmin, requirePortal, str } from './shared';

// ---- Startup Scout (/scout; migration 0034) ---------------------------------
const COMPANY_STATUSES: CompanyStatus[] = ['queued', 'tracked', 'dismissed', 'archived'];
const COMPANY_STAGES: CompanyStage[] = ['pre_seed', 'seed', 'series_a', 'series_b', 'later', 'unknown'];
const COMPANY_EVENT_KINDS: CompanyEventKind[] = ['funding', 'launch', 'news', 'milestone', 'note'];
const VERTICAL_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseFoundedYear(raw: string): number | null {
  const y = Number(raw);
  if (!Number.isInteger(y)) return null;
  if (y < 1980 || y > 2100) throw new Error('Founded year out of range.');
  return y;
}

// "Add a target": enters the funnel as queued, like any discovery. Open to the
// admin AND portal keyholders (their adds await editorial review). Dedup on
// domain / normalized name routes to the existing profile instead; when a
// portal keyholder hits a dismissed/archived match, redirect to /scout without
// disclosing it.
export async function addTargetAction(formData: FormData) {
  await requirePortal();
  const admin = await isAdmin();
  const name = str(formData, 'name');
  const url = str(formData, 'url');
  const vertical = str(formData, 'vertical');
  const stage = str(formData, 'stage') || 'unknown';
  if (!name) throw new Error('A company name is required.');
  if (url && !/^https?:\/\//i.test(url)) throw new Error('The URL must be http(s).');
  if (!VERTICAL_SLUG_RE.test(vertical)) throw new Error('Bad vertical.');
  if (!(COMPANY_STAGES as string[]).includes(stage)) throw new Error('Bad stage.');
  const { id, existed } = await m.createCompany({
    name,
    url: url || null,
    vertical,
    stage: stage as CompanyStage,
    one_liner: str(formData, 'one_liner') || null,
    ai_tech: str(formData, 'ai_tech') || null,
    founded_year: parseFoundedYear(str(formData, 'founded_year')),
    hq: str(formData, 'hq') || null,
    funding_note: str(formData, 'funding_note') || null,
    origin: 'manual',
  });
  revalidatePath('/scout');
  if (existed && !admin) {
    const visible = await getCompany(id, { admin: false, portal: true });
    if (!visible) redirect('/scout');
  }
  redirect(`/scout/${id}`);
}

// The review decision — the human gate on the acquisition funnel. Tracking a
// company REQUIRES a why (the rationales discipline applied to companies).
export async function reviewCompanyAction(id: string, status: string, note: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad company id.');
  if (!(COMPANY_STATUSES as string[]).includes(status)) throw new Error('Invalid status.');
  const why = String(note ?? '').trim().slice(0, 1000);
  if (status === 'tracked' && !why) throw new Error('Tracking a company requires a why.');
  await m.reviewCompany(id, status as CompanyStatus, why || null);
  revalidatePath('/scout');
}

export async function updateCompanyFactsAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'id');
  if (!UUID_RE.test(id)) throw new Error('Bad company id.');
  const stage = str(formData, 'stage') || 'unknown';
  if (!(COMPANY_STAGES as string[]).includes(stage)) throw new Error('Bad stage.');
  await m.updateCompanyFacts(id, {
    one_liner: str(formData, 'one_liner') || null,
    ai_tech: str(formData, 'ai_tech') || null,
    founded_year: parseFoundedYear(str(formData, 'founded_year')),
    stage: stage as CompanyStage,
    funding_note: str(formData, 'funding_note') || null,
    hq: str(formData, 'hq') || null,
  });
  revalidatePath('/scout');
}

export async function addCompanyEventAction(formData: FormData) {
  await requireAdmin();
  const companyId = str(formData, 'company_id');
  const eventDate = str(formData, 'event_date');
  const kind = str(formData, 'kind');
  const title = str(formData, 'title');
  const url = str(formData, 'url');
  if (!UUID_RE.test(companyId)) throw new Error('Bad company id.');
  if (!DATE_RE.test(eventDate)) throw new Error('Bad event date.');
  if (!(COMPANY_EVENT_KINDS as string[]).includes(kind)) throw new Error('Bad event kind.');
  if (!title) throw new Error('An event title is required.');
  if (url && !/^https?:\/\//i.test(url)) throw new Error('The URL must be http(s).');
  await m.createCompanyEvent({
    company_id: companyId,
    event_date: eventDate,
    kind: kind as CompanyEventKind,
    title,
    url: url || null,
    note: str(formData, 'note') || null,
  });
  revalidatePath('/scout');
}

export async function deleteCompanyEventAction(id: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad event id.');
  await m.deleteCompanyEvent(id);
  revalidatePath('/scout');
}

export async function addVerticalAction(formData: FormData) {
  await requireAdmin();
  const slug = str(formData, 'slug');
  const name = str(formData, 'name');
  if (!VERTICAL_SLUG_RE.test(slug)) throw new Error('Slug must be kebab-case (a-z, 0-9, dashes).');
  if (!name) throw new Error('A vertical name is required.');
  const queries = str(formData, 'search_queries')
    .split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8);
  await m.upsertVertical({
    slug, name,
    description: str(formData, 'description') || null,
    search_queries: queries,
  });
  revalidatePath('/scout');
}

export async function setVerticalActiveAction(slug: string, active: boolean): Promise<void> {
  await requireAdmin();
  if (!VERTICAL_SLUG_RE.test(slug)) throw new Error('Bad vertical.');
  await m.setVerticalActive(slug, Boolean(active));
  revalidatePath('/scout');
}

// ---- Scout discovery (phase 2): console-driven, DB-checkpointed batches -----
export async function startScoutRunAction(): Promise<{ runId: string; plan: ScoutBatchRef[] }> {
  await requireAdmin();
  const verticals = await getScoutVerticals(true); // admin read: carries the discovery queries
  const plan = scoutPlan(verticals);
  if (!plan.length) throw new Error('No active vertical carries discovery queries.');
  const runId = await m.createScoutRun();
  return { runId, plan };
}

export async function discoverScoutBatchAction(
  runId: string, vertical: string, batchIndex: number
): Promise<{ found: number; inserted: number }> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) throw new Error('Bad run id.');
  if (!VERTICAL_SLUG_RE.test(vertical)) throw new Error('Bad vertical.');
  if (!Number.isInteger(batchIndex) || batchIndex < 0 || batchIndex > 30) throw new Error('Bad batch index.');
  return discoverScoutBatch(runId, vertical, batchIndex);
}

export async function completeScoutRunAction(runId: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) throw new Error('Bad run id.');
  await m.completeScoutRun(runId);
  revalidatePath('/scout');
}

export async function failScoutRunAction(runId: string, message: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) return;
  await m.failScoutRun(runId, String(message ?? 'failed').slice(0, 500));
  revalidatePath('/scout');
}

// ---- Scout scoring agent (phase 3; recommend-only, human commits) -----------
export async function scoreScoutChunkAction(ids: string[]): Promise<{
  ok: boolean; processed?: number; pursue?: number; watch?: number; pass?: number; error?: string;
}> {
  await requireAdmin();
  if (!Array.isArray(ids) || !ids.length || ids.length > 20 || !ids.every((i) => UUID_RE.test(i))) {
    return { ok: false, error: 'Bad chunk.' };
  }
  try {
    const r = await scoreScoutChunk(ids);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Agent call failed.' };
  }
}

export async function saveScoutPrefsAction(steering: string, rubric: string): Promise<void> {
  await requireAdmin();
  await m.saveScoutPrefs(
    String(steering ?? '').trim().slice(0, 1500) || null,
    String(rubric ?? '').trim().slice(0, 4000) || null
  );
  revalidatePath('/scout');
}

export async function acceptScoutRecommendationsAction(verdict: string): Promise<{ ids: string[] }> {
  await requireAdmin();
  if (!['pursue', 'pass'].includes(verdict)) throw new Error('Bad verdict.');
  const ids = await m.acceptScoutRecommendations(verdict as 'pursue' | 'pass');
  revalidatePath('/scout');
  return { ids };
}

// ---- Scout research tools (admin + portal, budget-metered) ------------------
// THE GATE TEMPLATE for every portal-permitted scout action:
//   1. requirePortal() (admits admins); compute admin for the feature slug.
//   2. Validate inputs; steering is a one-off instruction, never persisted.
//   3. Portal viewers may only touch companies they can SEE (tracked/queued);
//      the failure is the SAME generic error as an unknown id, so a keyholder
//      cannot probe for dismissed targets.
//   4. Portal calls pass the daily budget check first.
//   5. Feature slug: admin work logs per-tool; portal work logs 'portal_scout'
//      (summed by checkPortalBudget), tool kept in metadata.

const GENERIC_TARGET_ERROR = 'Unknown company.';

async function gateScoutTarget(id: string, admin: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!UUID_RE.test(id)) return { ok: false, error: GENERIC_TARGET_ERROR };
  if (!admin) {
    const visible = await getCompany(id, { admin: false, portal: true });
    if (!visible) return { ok: false, error: GENERIC_TARGET_ERROR };
    const budget = await checkPortalBudget();
    if (!budget.ok) {
      return { ok: false, error: 'The team daily AI budget is spent. It resets at midnight UTC.' };
    }
  }
  return { ok: true };
}

export async function intelSweepAction(id: string, steering: string): Promise<{
  ok: boolean; filled?: string[]; events?: number; skipped?: number; error?: string;
}> {
  await requirePortal();
  const admin = await isAdmin();
  const gate = await gateScoutTarget(id, admin);
  if (!gate.ok) return { ok: false, error: gate.error };
  const steer = String(steering ?? '').trim().slice(0, 1000) || null;
  try {
    const r = await runIntelSweep(id, steer, admin ? 'scout_intel' : 'portal_scout');
    revalidatePath('/scout');
    return { ok: true, filled: r.filled, events: r.eventsAdded, skipped: r.eventsSkipped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The sweep failed.' };
  }
}

// Document extraction: the text was extracted in the BROWSER (the ingest
// form's unpdf pattern); only sanitized text reaches the server, capped well
// under the server-action body limit. The document is retained for re-reads.
export async function extractCompanyDocAction(
  companyId: string, filename: string, text: string, steering: string
): Promise<{ ok: boolean; filled?: string[]; events?: number; skipped?: number; error?: string }> {
  await requirePortal();
  const admin = await isAdmin();
  const gate = await gateScoutTarget(companyId, admin);
  if (!gate.ok) return { ok: false, error: gate.error };
  const body = String(text ?? '');
  if (body.length < 200) return { ok: false, error: 'The document text is too short to read.' };
  if (body.length > 200_000) return { ok: false, error: 'The document text exceeds the 200k character cap.' };
  const name = String(filename ?? '').trim().slice(0, 200) || 'document.pdf';
  const steer = String(steering ?? '').trim().slice(0, 1000) || null;
  try {
    const docId = await m.createCompanyDocument({
      company_id: companyId, filename: name, origin: admin ? 'admin' : 'portal', text: body,
    });
    try {
      const r = await extractFromDocument(companyId, docId, steer, admin ? 'scout_doc' : 'portal_scout');
      revalidatePath('/scout');
      return { ok: true, filled: r.filled, events: r.eventsAdded, skipped: r.eventsSkipped };
    } catch (e) {
      // The document IS retained at this point; the model leg can stall (TTFT).
      revalidatePath('/scout');
      return {
        ok: false,
        error: `${e instanceof Error ? e.message : 'The read failed.'} The document was saved: use Re-extract to retry.`,
      };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The extraction failed.' };
  }
}

export async function reExtractDocAction(docId: string, steering: string): Promise<{
  ok: boolean; filled?: string[]; events?: number; skipped?: number; error?: string;
}> {
  await requirePortal();
  const admin = await isAdmin();
  if (!UUID_RE.test(docId)) return { ok: false, error: GENERIC_TARGET_ERROR };
  const doc = await getCompanyDocumentText(docId);
  if (!doc) return { ok: false, error: GENERIC_TARGET_ERROR };
  const gate = await gateScoutTarget(doc.company_id, admin);
  if (!gate.ok) return { ok: false, error: gate.error };
  const steer = String(steering ?? '').trim().slice(0, 1000) || null;
  try {
    const r = await extractFromDocument(doc.company_id, docId, steer, admin ? 'scout_doc' : 'portal_scout');
    revalidatePath('/scout');
    return { ok: true, filled: r.filled, events: r.eventsAdded, skipped: r.eventsSkipped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The extraction failed.' };
  }
}

export async function deleteCompanyDocAction(docId: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(docId)) throw new Error('Bad document id.');
  await m.deleteCompanyDocument(docId);
  revalidatePath('/scout');
}

// Competitor scan: ADMIN-ONLY. It mass-creates queue rows (the admin's review
// desk), so the portal tier gets no button and no gate through here.
export async function competitorScanAction(id: string, steering: string): Promise<{
  ok: boolean; found?: number; inserted?: number; names?: string[]; error?: string;
}> {
  await requireAdmin();
  if (!UUID_RE.test(id)) return { ok: false, error: GENERIC_TARGET_ERROR };
  const steer = String(steering ?? '').trim().slice(0, 1000) || null;
  try {
    const r = await scanCompetitors(id, steer);
    revalidatePath('/scout');
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The scan failed.' };
  }
}

// ---- Scout enrichment (phase 4) ---------------------------------------------
export async function enrichCompanyAction(id: string): Promise<{
  ok: boolean; via?: string; filled?: string[]; error?: string;
}> {
  await requireAdmin();
  if (!UUID_RE.test(id)) return { ok: false, error: 'Bad company id.' };
  try {
    const r = await enrichCompany(id);
    revalidatePath('/scout');
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Enrichment failed.' };
  }
}
