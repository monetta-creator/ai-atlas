'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from './shared';
import { one } from '../db';
import { setGeneratedReportPublished } from '../mutations/reports';
import { saveFieldReportPrefs, type FieldReportPrefs, type Role } from '../field-report/store';
import type { FieldReportSize } from '../field-report/core';
import { SAVANT_MODEL_OPTIONS, isAnthropicId } from '../savant/cost-model';

// Admin publishes a Field Report to every keyholder (a keyholder's report is
// a draft visible to them and admin until then). Field Reports are never
// public and never enter Ask's shared corpus.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function publishFieldReportAction(reportId: string, published: boolean): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  if (!UUID_RE.test(reportId)) return { ok: false, error: 'Unknown report.' };
  const row = await one<{ id: string }>(`select id::text from generated_reports where id = $1 and kind = 'field_report'`, [reportId]);
  if (!row) return { ok: false, error: 'Unknown report.' };
  await setGeneratedReportPublished(reportId, Boolean(published));
  revalidatePath('/field-reports');
  revalidatePath(`/field-reports/${reportId}`);
  revalidatePath('/reports');
  return { ok: true };
}

// The desk's settings save (components/field-report/FieldReportPrefsForm.tsx
// calls this directly, not as a native <form action>, since it needs the
// {ok,error} shape rather than a thrown redirect). Every field is validated
// server-side even though the form already constrains its own inputs: a
// stale client, a hand-crafted call or a future non-form caller must not be
// able to write an unlisted model id or an out-of-band effort/search count.
const SIZES: FieldReportSize[] = ['brief', 'full'];
const ROLES: Role[] = ['research', 'writer', 'editor', 'figures'];
// Research, writer and editor call the Anthropic Messages API directly (tool
// loops, adaptive thinking), so those three roles may only pick an Anthropic
// model id; figures goes through routedStructured and can pick any option.
const ANTHROPIC_ONLY_ROLES = new Set<Role>(['research', 'writer', 'editor']);
const WEB_SEARCH_MAX: Record<FieldReportSize, number> = { brief: 10, full: 25 };

export interface FieldReportPrefsInput {
  enabled: boolean;
  models: Record<FieldReportSize, Record<Role, string>>;
  effort: Record<FieldReportSize, string>;
  webSearches: Record<FieldReportSize, number>;
  keyDailyUsd: number;
  allKeysDailyUsd: number;
}

function validModel(id: unknown, role: Role, size: FieldReportSize): string {
  const v = String(id ?? '');
  if (!SAVANT_MODEL_OPTIONS.some((m) => m.id === v)) throw new Error(`The ${size} ${role} model is not in the catalog.`);
  if (ANTHROPIC_ONLY_ROLES.has(role) && !isAnthropicId(v)) {
    throw new Error(`The ${size} ${role} model calls the Messages API directly, so it must be an Anthropic model.`);
  }
  return v;
}

function validEffort(v: unknown): 'low' | 'medium' | 'high' {
  if (v === 'low' || v === 'medium' || v === 'high') return v;
  throw new Error('Effort must be low, medium, or high.');
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
}

function clampUsd(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

export async function saveFieldReportPrefsAction(input: FieldReportPrefsInput): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireAdmin();
    const models = {} as Record<FieldReportSize, Record<Role, string>>;
    const effort = {} as Record<FieldReportSize, 'low' | 'medium' | 'high'>;
    const webSearches = {} as Record<FieldReportSize, number>;
    for (const size of SIZES) {
      const m = {} as Record<Role, string>;
      for (const role of ROLES) m[role] = validModel(input.models?.[size]?.[role], role, size);
      models[size] = m;
      effort[size] = validEffort(input.effort?.[size]);
      webSearches[size] = clampInt(input.webSearches?.[size], 0, WEB_SEARCH_MAX[size]);
    }
    const prefs: FieldReportPrefs = {
      enabled: Boolean(input.enabled),
      models,
      effort,
      webSearches,
      keyDailyUsd: clampUsd(input.keyDailyUsd),
      allKeysDailyUsd: clampUsd(input.allKeysDailyUsd),
    };
    await saveFieldReportPrefs(prefs);
    revalidatePath('/field-reports/desk');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save preferences.' };
  }
}
