// Server-side conversations (redo Phase 4, P4.1; migration 0087). Every read
// and write is scoped by owner ('admin' or 'key:<id>'): a conversation id
// alone never opens someone else's thread. Messages append with the next
// seq inside one transaction. Archive, never hard-delete.
import { one, q, withTx } from '../db';

export type Owner = 'admin' | `key:${string}`;

export interface ConvoRow {
  id: string;
  title: string;
  model: string | null;
  created_at: string;
  updated_at: string;
  messages?: MessageRow[];
}

export interface MessageRow {
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  extras: Record<string, unknown>;
  tag_map: Record<string, string>;
  cost_usd: number | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);
const MAX_CONTENT = 60_000;
const MAX_EXTRAS = 200_000; // chars of JSON

export function ownerFor(identity: { kind: 'admin' } | { kind: 'keyholder'; keyId: string }): Owner {
  return identity.kind === 'admin' ? 'admin' : `key:${identity.keyId}`;
}

export async function listConversations(owner: Owner, limit = 50): Promise<ConvoRow[]> {
  return q<ConvoRow>(
    `select id, title, model, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at, to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as updated_at
       from conversations where owner = $1 and archived_at is null
      order by updated_at desc limit $2`,
    [owner, Math.min(200, Math.max(1, limit))],
  );
}

export async function getConversation(owner: Owner, id: string): Promise<ConvoRow | null> {
  if (!isUuid(id)) return null;
  const c = await one<ConvoRow>(
    `select id, title, model, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at, to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as updated_at
       from conversations where id = $1 and owner = $2 and archived_at is null`,
    [id, owner],
  );
  if (!c) return null;
  c.messages = await q<MessageRow>(
    `select seq, role, content, extras, tag_map, cost_usd::float as cost_usd
       from conversation_messages where conversation_id = $1 order by seq`,
    [id],
  );
  return c;
}

export async function createConversation(owner: Owner, title: string, model?: string | null): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into conversations (owner, title, model) values ($1, $2, $3) returning id`,
    [owner, title.trim().slice(0, 200), model ?? null],
  );
  return row!.id;
}

export interface NewMessage {
  role: 'user' | 'assistant';
  content: string;
  extras?: Record<string, unknown>;
  tagMap?: Record<string, string>;
  costUsd?: number | null;
}

// Appends in order; returns the new seq, or null when the conversation is
// not this owner's.
export async function appendMessage(owner: Owner, id: string, m: NewMessage): Promise<number | null> {
  if (!isUuid(id)) return null;
  const extras = JSON.stringify(m.extras ?? {});
  if (extras.length > MAX_EXTRAS) throw new Error('message extras too large');
  return withTx(async (c) => {
    const own = await c.query(`select id from conversations where id = $1 and owner = $2 and archived_at is null for update`, [id, owner]);
    if (!own.rowCount) return null;
    const next = await c.query<{ n: number }>(`select coalesce(max(seq), 0) + 1 as n from conversation_messages where conversation_id = $1`, [id]);
    const seq = Number(next.rows[0].n);
    await c.query(
      `insert into conversation_messages (conversation_id, seq, role, content, extras, tag_map, cost_usd)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
      [id, seq, m.role, m.content.slice(0, MAX_CONTENT), extras, JSON.stringify(m.tagMap ?? {}), m.costUsd ?? null],
    );
    await c.query(`update conversations set updated_at = now() where id = $1`, [id]);
    return seq;
  });
}

// Mirror a whole conversation from the browser store (the client keeps
// localStorage as its working copy and PUTs a snapshot after each change):
// create it under this owner with the client's uuid if new, then replace its
// messages. Another owner's id is refused (null). Bounded sizes.
export async function replaceConversation(
  owner: Owner,
  id: string,
  c: { title: string; model?: string | null; messages: NewMessage[] },
): Promise<boolean | null> {
  if (!isUuid(id)) return null;
  const msgs = c.messages.slice(0, 400);
  for (const m of msgs) if (JSON.stringify(m.extras ?? {}).length > MAX_EXTRAS) throw new Error('message extras too large');
  return withTx(async (cl) => {
    const existing = await cl.query<{ owner: string }>(`select owner from conversations where id = $1 for update`, [id]);
    if (existing.rowCount && existing.rows[0].owner !== owner) return null;
    if (!existing.rowCount) {
      await cl.query(`insert into conversations (id, owner, title, model) values ($1, $2, $3, $4)`, [id, owner, c.title.trim().slice(0, 200), c.model ?? null]);
    } else {
      await cl.query(`update conversations set title = $2, model = $3, updated_at = now(), archived_at = null where id = $1`, [id, c.title.trim().slice(0, 200), c.model ?? null]);
    }
    await cl.query(`delete from conversation_messages where conversation_id = $1`, [id]);
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      await cl.query(
        `insert into conversation_messages (conversation_id, seq, role, content, extras, tag_map, cost_usd)
         values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
        [id, i + 1, m.role, m.content.slice(0, MAX_CONTENT), JSON.stringify(m.extras ?? {}), JSON.stringify(m.tagMap ?? {}), m.costUsd ?? null],
      );
    }
    return true;
  });
}

export async function updateConversation(owner: Owner, id: string, patch: { title?: string; model?: string | null }): Promise<boolean> {
  if (!isUuid(id)) return false;
  const row = await one<{ id: string }>(
    `update conversations set
        title = coalesce($3, title),
        model = case when $4::boolean then $5 else model end,
        updated_at = now()
      where id = $1 and owner = $2 and archived_at is null returning id`,
    [id, owner, patch.title?.trim().slice(0, 200) ?? null, patch.model !== undefined, patch.model ?? null],
  );
  return Boolean(row);
}

export async function archiveConversation(owner: Owner, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const row = await one<{ id: string }>(
    `update conversations set archived_at = now() where id = $1 and owner = $2 and archived_at is null returning id`,
    [id, owner],
  );
  return Boolean(row);
}
