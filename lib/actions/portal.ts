'use server';

import { revalidatePath } from 'next/cache';
import { UUID_RE, requireAdmin, str } from './shared';
import { listAccessRequests } from '../data/portal';
import {
  declineAccessRequest, issuePortalKey, renewPortalKey, revokePortalKey, setPortalKeyBudget,
} from '../mutations/portal';
import { magicLink } from '../portal/keys';
import { emailConfigured, sendEmail } from '../email/resend';
import { renderKeyIssuedHtml } from '../portal/email';

// ---- Access keys (the /access console) ---------------------------------------
// Every action re-checks the admin session first. The full key exists only in
// the return value of issuePortalKey; these actions hand it to the console
// once (KeyIssuedPanel) and, when Resend is configured and the person gave an
// address, mail the magic link as well. Nothing here stores the key.

export interface KeyIssuedResult {
  key: string;
  link: string;
  name: string;
  expiresAt: string;
  // The address the link was mailed to, or null when no mail went out (no
  // address, Resend unset, or the send failed): the console then says so.
  emailedTo: string | null;
}

export type KeyIssueOutcome = KeyIssuedResult | { error: string };

const MAX_DAYS = 3650;

function baseUrl(): string {
  return (process.env.APP_BASE_URL || 'https://ai-atlas-pi.vercel.app').replace(/\/+$/, '');
}

function parseDays(raw: string): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS) throw new Error(`Days must be a whole number between 1 and ${MAX_DAYS}.`);
  return n;
}

function parseBudget(raw: string): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('Daily budget must be between 0 and 100 USD.');
  return Math.round(n * 100) / 100;
}

function parseCalls(raw: string): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 10_000) throw new Error('Daily calls must be a whole number between 0 and 10000.');
  return n;
}

async function issueAndNotify(input: {
  name: string; email: string | null; notes: string | null; days?: number;
  requestId?: string | null; dailyBudgetUsd?: number; dailyMaxCalls?: number;
}): Promise<KeyIssuedResult> {
  const issued = await issuePortalKey(input);
  const base = baseUrl();
  const link = magicLink(base, issued.key);
  let emailedTo: string | null = null;
  if (input.email && emailConfigured()) {
    const res = await sendEmail({
      to: input.email,
      subject: 'Your access key to the AI Atlas',
      html: renderKeyIssuedHtml({ name: input.name, link, expiresAt: issued.expiresAt, host: base }),
    });
    if (res.ok) emailedTo = input.email;
  }
  return { key: issued.key, link, name: input.name, expiresAt: issued.expiresAt, emailedTo };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

// The "Issue a key" form: name (required), email, notes, days, budget, calls.
export async function issuePortalKeyAction(formData: FormData): Promise<KeyIssueOutcome> {
  await requireAdmin();
  try {
    const name = str(formData, 'name').slice(0, 120);
    if (!name) return { error: 'Give the key a name (usually the person).' };
    const email = str(formData, 'email').slice(0, 200) || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'That email does not look right.' };
    const notes = str(formData, 'notes').slice(0, 2000) || null;
    const result = await issueAndNotify({
      name, email, notes,
      days: parseDays(str(formData, 'days')),
      dailyBudgetUsd: parseBudget(str(formData, 'budget')),
      dailyMaxCalls: parseCalls(str(formData, 'calls')),
    });
    revalidatePath('/access');
    return result;
  } catch (e) {
    return { error: message(e) };
  }
}

// Approve a pending request: issues a key named after the requester and marks
// the request approved (issuePortalKey does both in one transaction).
export async function approveAccessRequestAction(requestId: string): Promise<KeyIssueOutcome> {
  await requireAdmin();
  if (!UUID_RE.test(requestId)) return { error: 'Bad request id.' };
  try {
    const req = (await listAccessRequests()).find((r) => r.id === requestId);
    if (!req) return { error: 'That request is gone.' };
    if (req.status !== 'pending') return { error: `That request was already ${req.status}.` };
    const result = await issueAndNotify({
      name: req.name,
      email: req.email,
      notes: req.reason ? `Request: ${req.reason.slice(0, 1800)}` : null,
      requestId,
    });
    revalidatePath('/access');
    return result;
  } catch (e) {
    return { error: message(e) };
  }
}

export async function declineAccessRequestAction(id: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad request id.');
  await declineAccessRequest(id);
  revalidatePath('/access');
}

export async function renewPortalKeyAction(id: string, days?: number): Promise<{ expiresAt: string }> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad key id.');
  const n = days === undefined ? undefined : parseDays(String(days));
  const out = await renewPortalKey(id, n);
  revalidatePath('/access');
  return out;
}

export async function revokePortalKeyAction(id: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad key id.');
  await revokePortalKey(id);
  revalidatePath('/access');
}

// The per-key Ask caps (fields: budget in USD, calls per day).
export async function setPortalKeyBudgetAction(id: string, formData: FormData): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad key id.');
  const dailyBudgetUsd = parseBudget(str(formData, 'budget'));
  const dailyMaxCalls = parseCalls(str(formData, 'calls'));
  if (dailyBudgetUsd === undefined || dailyMaxCalls === undefined) throw new Error('Both a daily budget and a daily call cap are required.');
  await setPortalKeyBudget(id, { dailyBudgetUsd, dailyMaxCalls });
  revalidatePath('/access');
}
