import { exec, one } from '../db';
import { isScanEnrichModel } from '../scan/models';

// The edition_prefs singleton writer (migration 0057, the scan/intel/tooling
// prefs pattern): partial patch, merged over the current row, validated
// field by field so a bad admin-form value never reaches the DB.

export interface EditionPrefsPatch {
  enabled?: boolean;
  model?: string;
  front_items?: number;
}

// A cheap-model id off the /scan picker's shortlist, or any Anthropic
// claude-* id (routedStructured's own allow rule, lib/model-route.ts's
// isAnthropicModel) — not restricted to the one baseline entry
// isScanEnrichModel flags `anthropic: true`.
function validModel(m: string | null | undefined, fallback: string): string {
  if (m === undefined || m === null) return fallback;
  const trimmed = m.trim();
  if (!trimmed) return fallback;
  return isScanEnrichModel(trimmed) || trimmed.startsWith('claude-') ? trimmed : fallback;
}

function clampFrontItems(n: number | undefined, fallback: number): number {
  if (n === undefined || !Number.isFinite(n)) return fallback;
  return Math.min(8, Math.max(4, Math.round(n)));
}

export async function saveEditionPrefs(patch: EditionPrefsPatch): Promise<void> {
  const current = await one<{ enabled: boolean; model: string; front_items: number }>(
    `select enabled, model, front_items from edition_prefs where id = true`
  );
  const next = {
    enabled: patch.enabled ?? current?.enabled ?? true,
    model: validModel(patch.model, current?.model ?? 'z-ai/glm-5.3-flash'),
    front_items: clampFrontItems(patch.front_items, current?.front_items ?? 6),
  };
  await exec(
    `insert into edition_prefs (id, enabled, model, front_items)
     values (true, $1, $2, $3)
     on conflict (id) do update set enabled = $1, model = $2, front_items = $3, updated_at = now()`,
    [next.enabled, next.model, next.front_items]
  );
}
