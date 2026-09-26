// Local render check for a Savant issue's PDF (not a test, needs the DB):
// renders the issue for a week to <out>/savant-<week>.pdf and prints the page
// count. Run: npx -y tsx scripts/render-savant-pdf.mts <outDir> [week]
import { config } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
config({ path: '.env.local' });

const [outDir, weekArg] = process.argv.slice(2);
if (!outDir) { console.error('usage: tsx scripts/render-savant-pdf.mts <outDir> [week]'); process.exit(1); }

const { getSavantIssue, getLatestSavantIssue } = await import('../lib/data/savant-issues');
const { renderSavantPdf } = await import('../lib/pdf/savant-doc');
const { getDocumentProxy } = await import('unpdf');

const issue = weekArg ? await getSavantIssue(weekArg) : await getLatestSavantIssue(false);
if (!issue) { console.error('no issue'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
const buf = await renderSavantPdf(issue, 'https://ai-atlas.example');
const file = path.join(outDir, `savant-${issue.week_end}.pdf`);
fs.writeFileSync(file, buf);
const pdf = await getDocumentProxy(new Uint8Array(buf));
console.log(issue.week_end, `${pdf.numPages} pages`, `${(buf.length / 1024).toFixed(0)} KB`, `${Date.now() - t0} ms`, file);
process.exit(0);
