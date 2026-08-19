// Captures the /showcase deck's platform screenshots into public/showcase/.
// Re-run whenever the UI changes:
//
//   node scripts/capture-showcase.mjs                # guest shots only
//   ADMIN_COOKIE="atlas_admin=admin.<hmac>" node scripts/capture-showcase.mjs
//
// The admin cookie (needed only for ask.png, the deep-capability shot) is
// passed via env, never stored here. Targets local dev by default; point BASE
// at the deployed app to capture what demo guests see.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = new URL('../public/showcase/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const GUEST_SHOTS = [
  { file: 'signals.png', path: '/signals' },
  { file: 'blotter.png', path: '/blotter' },
  { file: 'map.png', path: '/map' },
  { file: 'reports.png', path: '/reports' },
  { file: 'datasets.png', path: '/datasets' },
  { file: 'research.png', path: '/research' },
];

const ASK_QUESTION = 'What did the University of Pittsburgh layoffs study find?';

function cookieFromEnv() {
  const raw = process.env.ADMIN_COOKIE || '';
  const i = raw.indexOf('=');
  if (i < 1) return null;
  return {
    name: raw.slice(0, i),
    value: raw.slice(i + 1),
    domain: new URL(BASE).hostname,
    path: '/',
    httpOnly: true,
    secure: BASE.startsWith('https'),
    sameSite: 'Lax',
  };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});

const page = await ctx.newPage();

if (process.env.ONLY !== 'ask') {
  for (const shot of GUEST_SHOTS) {
    await page.goto(BASE + shot.path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700); // let entrance animations settle
    await page.screenshot({ path: OUT + shot.file });
    console.log('captured', shot.file);
  }
}

const cookie = cookieFromEnv();
if (!cookie) {
  console.log('ADMIN_COOKIE not set: skipping ask.png');
} else {
  await ctx.addCookies([cookie]);
  await page.goto(BASE + '/ask', { waitUntil: 'networkidle' });
  await page.fill('.ask-composer textarea, .ask-composer input[type="text"], .ask-composer input:not([type])', ASK_QUESTION).catch(async () => {
    // The composer may be a textarea inside a form; fall back to the first
    // visible text input on the page.
    await page.locator('textarea, input[type="text"]').first().fill(ASK_QUESTION);
  });
  await page.keyboard.press('Enter');
  // Wait for the streamed answer to finish: a citation chip appearing is the
  // signal, then a grace period for the tail of the stream.
  await page.waitForSelector('.ask-cite', { timeout: 90_000 });
  await page.waitForTimeout(12_000);
  // Open the first signal citation chip, then the document viewer.
  const chips = page.locator('.ask-cite');
  const count = await chips.count();
  let opened = false;
  for (let i = 0; i < count && !opened; i++) {
    await chips.nth(i).click().catch(() => {});
    // Loaded means the record TITLE is in, not just the panel shell.
    opened = await page
      .waitForSelector('.ask-peek h3', { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
  }
  let docOpen = false;
  if (opened) {
    const readBtn = page.getByRole('button', { name: 'Read the retained text' });
    docOpen = await readBtn
      .first()
      .waitFor({ timeout: 8000 })
      .then(async () => {
        await readBtn.first().click();
        await page.waitForSelector('.ask-doc-text', { timeout: 12_000 });
        // Jump to the first highlight so the visible text is marked article
        // prose, not the page's header cruft.
        await page.locator('button:has-text("Jump to first")').first().click().catch(() => {});
        await page.waitForTimeout(1500); // smooth scroll + highlights settle
        return true;
      })
      .catch(() => false);
  }
  await page.screenshot({ path: OUT + 'ask.png' });
  console.log(
    'captured ask.png',
    docOpen ? '(doc viewer open)' : opened ? '(peek open, NO doc viewer: re-check)' : '(PEEK DID NOT OPEN: re-check)'
  );
}

await browser.close();
console.log('done ->', OUT);
