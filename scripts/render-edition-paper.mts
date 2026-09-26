// Local render check for the Daily Edition's newspaper PDF (not a test, needs
// the DB): renders each requested day's stored edition to <out>/paper-<day>.pdf
// and prints the page count. Run: npx -y tsx scripts/render-edition-paper.mts <outDir> [day ...]
import 'dotenv/config';
import { config } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
config({ path: '.env.local' });

const [outDir, ...days] = process.argv.slice(2);
if (!outDir) { console.error('usage: tsx scripts/render-edition-paper.mts <outDir> [day ...]'); process.exit(1); }

const { getEditionForDay, listEditions } = await import('../lib/data/editions');
const { buildEditionPaper } = await import('../lib/edition/paper');
const { renderEditionPaperPdf } = await import('../lib/pdf/edition-paper');
const { getDocumentProxy } = await import('unpdf');

const targets = days.length ? days : (await listEditions(5, false)).map((e) => e.day);
fs.mkdirSync(outDir, { recursive: true });
for (const day of targets) {
  const ed = await getEditionForDay(day);
  if (!ed) { console.log(day, 'no edition'); continue; }
  const model = buildEditionPaper(ed, 'https://ai-atlas.example');
  const t0 = Date.now();
  const buf = await renderEditionPaperPdf(model, `Daily edition, ${day}`);
  const file = path.join(outDir, `paper-${day}.pdf`);
  fs.writeFileSync(file, buf);
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  console.log(day, `${pdf.numPages} pages`, `${(buf.length / 1024).toFixed(0)} KB`, `${Date.now() - t0} ms`, `things=${model.thingsCount} desks=${model.deskColumns.flat().length} industry=${model.industry.length} column=${model.column ? 'yes' : 'no'}`);
}
process.exit(0);
