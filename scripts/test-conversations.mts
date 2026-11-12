// Server-side conversations (migration 0087): create, append in order, list,
// owner isolation (another owner cannot read, append, rename, or archive),
// archive. Test rows use owners 'key:test-<random>' and are removed at the
// end (only rows this test created, in the redo's own new table). With
// --live, also checks the HTTP routes on localhost:3100 (401 without a
// session; admin create, append, get, archive).
// Run: npx -y tsx scripts/test-conversations.mts [--live]
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
dotenv.config({ path: '.env.local', quiet: true });
const S = await import('../lib/conversations/store');
const { exec } = await import('../lib/db');

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.error('FAIL', m); } };
const A = `key:test-${randomUUID()}` as const;
const B = `key:test-${randomUUID()}` as const;

try {
  const id = await S.createConversation(A, 'Banks and agents', 'claude-haiku-5-5');
  ok(S.isUuid(id), 'created');
  ok((await S.appendMessage(A, id, { role: 'user', content: 'agents and banks' })) === 1, 'seq 1');
  ok((await S.appendMessage(A, id, { role: 'assistant', content: 'Four banks [signal S1].', extras: { lane: 'covered', cost: { cost_usd: 0.003 } }, tagMap: { S1: '24a9e35d-c6ea-4faa-9ab0-a7cbeac34192' }, costUsd: 0.003 })) === 2, 'seq 2');
  const got = await S.getConversation(A, id);
  ok(got?.messages?.length === 2 && got.messages[1].tag_map.S1 === '24a9e35d-c6ea-4faa-9ab0-a7cbeac34192' && got.messages[1].extras.lane === 'covered' && got.model === 'claude-haiku-5-5', 'read back in order with extras and tag map');
  ok((await S.listConversations(A)).some((c) => c.id === id), 'listed for owner');

  // Isolation.
  ok((await S.getConversation(B, id)) === null, 'other owner cannot read');
  ok((await S.appendMessage(B, id, { role: 'user', content: 'x' })) === null, 'other owner cannot append');
  ok(!(await S.updateConversation(B, id, { title: 'hijack' })), 'other owner cannot rename');
  ok(!(await S.archiveConversation(B, id)), 'other owner cannot archive');
  ok(!(await S.listConversations(B)).some((c) => c.id === id), 'not listed for other owner');
  ok((await S.getConversation('admin', id)) === null, 'admin owner is a different owner too');
  ok((await S.getConversation(A, 'not-a-uuid')) === null, 'bad id');

  ok(await S.updateConversation(A, id, { model: 'auto' }), 'owner updates model');
  ok((await S.getConversation(A, id))?.model === 'auto', 'model stored');
  ok(await S.archiveConversation(A, id), 'owner archives');
  ok((await S.getConversation(A, id)) === null && !(await S.listConversations(A)).some((c) => c.id === id), 'archived is gone from reads');
} finally {
  await exec(`delete from conversations where owner in ($1, $2)`, [A, B]);
}

if (process.argv.includes('--live')) {
  const base = 'http://localhost:3100/api/conversations';
  const cookie = `atlas_admin=${readFileSync('private/redo/build/admin-cookie.txt', 'utf8').trim()}`;
  ok((await fetch(base, { redirect: 'manual' })).status === 401, 'no session: 401');
  const created = await fetch(base, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'live test' }) });
  const { id } = (await created.json()) as { id: string };
  ok(created.status === 201 && S.isUuid(id), 'admin create');
  const app = await fetch(`${base}/${id}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'user', content: 'hello', tagMap: { S1: 'x', bogus: 'y' } }) });
  ok(app.status === 201, 'admin append');
  const got = (await (await fetch(`${base}/${id}`, { headers: { cookie } })).json()) as { messages: { content: string; tag_map: Record<string, string> }[] };
  ok(got.messages[0].content === 'hello' && !('bogus' in got.messages[0].tag_map), 'admin get, tag map filtered');
  ok((await fetch(`${base}/${id}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'system', content: 'x' }) })).status === 400, 'bad role 400');
  ok((await fetch(`${base}/${id}`, { method: 'DELETE', headers: { cookie } })).status === 200, 'admin archive');
  ok((await fetch(`${base}/${id}`, { headers: { cookie } })).status === 404, 'archived 404');
  await exec(`delete from conversations where id = $1 and owner = 'admin' and title = 'live test'`, [id]);
}

console.log(fail ? `${fail} failure(s)` : 'ok: conversations');
process.exit(fail ? 1 : 0);
