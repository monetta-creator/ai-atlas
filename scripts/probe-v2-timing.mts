// Prints elapsed seconds at each v2 NDJSON event (latency profiling).
// Run: npx -y tsx scripts/probe-v2-timing.mts "question" [model]
import { readFileSync } from 'node:fs';
const cookie = `atlas_admin=${readFileSync('private/redo/build/admin-cookie.txt', 'utf8').trim()}`;
const t0 = Date.now();
const res = await fetch('http://localhost:3100/api/ask/v2', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ query: process.argv[2], model: process.argv[3] ?? 'claude-haiku-5-5', web: true }) });
const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = ''; let firstDelta = 0;
for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const e = JSON.parse(line); const s = ((Date.now() - t0) / 1000).toFixed(1); if (e.type === 'delta') { if (!firstDelta) { firstDelta = 1; console.log(s, 'first delta'); } continue; } console.log(s, e.type, (e.text ?? e.name ?? e.lane ?? '').toString().slice(0, 70)); } }
console.log(((Date.now() - t0) / 1000).toFixed(1), 'end');
