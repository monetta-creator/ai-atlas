'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, str } from './shared';
import { setSavantPrefs } from '../mutations/savant';

// Admin controls for the Savant desk's prefs card. One form, one save;
// nothing here redirects (the desk revalidates in place, like the tooling
// console's picker saves).

const MODEL_RE = /^[a-z0-9./:_-]+$/i;
const SLUG_RE = /^[a-z0-9-]+$/;

function parseModel(formData: FormData, key: string, label: string): string {
  const v = str(formData, key);
  if (!v) throw new Error(`${label} is required.`);
  if (v.length > 80 || !MODEL_RE.test(v)) throw new Error(`${label} is not a valid model id.`);
  return v;
}

// Comma list -> lowercase lens slugs, silently dropping any entry that is
// not plain slug characters rather than rejecting the whole save over one
// stray character.
function parseRotation(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => SLUG_RE.test(s));
}

export async function saveSavantPrefsAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const leadOverride = str(formData, 'lead_override').trim().toLowerCase();
  if (leadOverride && !SLUG_RE.test(leadOverride)) {
    throw new Error('Lead override must be a plain lens slug: lowercase letters, numbers, hyphens.');
  }
  const editorName = str(formData, 'editor_name') || 'the Desk Editor';

  await setSavantPrefs({
    enabled: formData.has('enabled'),
    writer_model: parseModel(formData, 'writer_model', 'Writer model'),
    editor_model: parseModel(formData, 'editor_model', 'Editor model'),
    notebook_model: parseModel(formData, 'notebook_model', 'Notebook model'),
    editor_name: editorName,
    lead_rotation: parseRotation(str(formData, 'lead_rotation')),
    lead_override: leadOverride || null,
    email_enabled: formData.has('email_enabled'),
  });

  revalidatePath('/savant/desk');
}
