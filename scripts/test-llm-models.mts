// Model catalog test: ids unique, tier defaults resolve, cost math sane, and
// every catalog entry has an active ai_rate_cards row whose prices match
// (read-only DB). Run: npx -y tsx scripts/test-llm-models.mts
import dotenv from 'dotenv';
import pg from 'pg';
import { MODELS, TIER_DEFAULT, getModel, estimateTurnUsd, formatTurnCost, selectorModels } from '../lib/llm/models';

dotenv.config({ path: '.env.local', quiet: true });
let fail = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { fail++; console.error('FAIL', msg); } };

ok(new Set(MODELS.map((m) => m.id)).size === MODELS.length, 'ids unique');
for (const t of ['cheap', 'mid', 'strong'] as const) ok(getModel(TIER_DEFAULT[t])?.roles.includes('answer') === true, `tier ${t} default is an answerer`);
ok(!selectorModels().some((m) => m.id === 'meta-llama/llama-3.1-8b-instruct'), 'judge hidden from selector');
for (const m of MODELS) ok(!/—/.test(m.blurb + m.label), `no em dash in ${m.id}`);
const haiku = getModel('claude-haiku-5-5')!;
const opus = getModel('claude-opus-5-5')!;
ok(estimateTurnUsd(haiku) < 0.02 && estimateTurnUsd(haiku) > 0.001, `haiku turn ${estimateTurnUsd(haiku)}`);
ok(estimateTurnUsd(opus) > estimateTurnUsd(haiku) * 10, 'opus much dearer than haiku');
ok(formatTurnCost(0.004) === '<1¢' && formatTurnCost(0.12) === '~12¢' && formatTurnCost(1.5) === '~$1.50', 'format');

const c = new pg.Client({ host: process.env.SUPABASE_DB_HOST, port: Number(process.env.SUPABASE_DB_PORT || 5432), user: process.env.SUPABASE_DB_USER, password: process.env.SUPABASE_DB_PASSWORD, database: process.env.SUPABASE_DB_NAME || 'postgres', ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query('set default_transaction_read_only = on');
for (const m of MODELS) {
  const r = await c.query(
    `select input_per_mtok::float i, output_per_mtok::float o from ai_rate_cards where model = $1 and effective_date <= current_date order by effective_date desc limit 1`,
    [m.id],
  );
  const row = r.rows[0];
  ok(Boolean(row), `rate card for ${m.id}`);
  if (row) ok(Math.abs(row.i - m.inPerM) < 1e-6 && Math.abs(row.o - m.outPerM) < 1e-6, `prices match for ${m.id} (card ${row.i}/${row.o})`);
}
await c.end();
console.log(fail ? `${fail} failure(s)` : `ok: ${MODELS.length} models, haiku turn ${formatTurnCost(estimateTurnUsd(haiku))}, opus turn ${formatTurnCost(estimateTurnUsd(opus))}`);
process.exit(fail ? 1 : 0);
