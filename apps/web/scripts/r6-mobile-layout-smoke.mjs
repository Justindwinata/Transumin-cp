import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

// R6-B mobile-layout smoke: 390x844, console errors, failed requests, overflow check.
const web = process.env.R6_WEB_URL ?? 'http://127.0.0.1:3000';
const chrome =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dir =
  process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR ?? '.release-evidence/R6/mobile';
const out = {
  web,
  viewport: { width: 390, height: 844 },
  consoleErrors: [],
  failedRequests: [],
  checks: {},
};

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type()))
      out.consoleErrors.push(message.text().slice(0, 300));
  });
  page.on('requestfailed', (request) =>
    out.failedRequests.push(`${request.failure()?.errorText} ${request.url()}`),
  );
  await page.goto(web, { waitUntil: 'domcontentloaded' });
  await page
    .getByText('Interactive route map ready.', { exact: true })
    .waitFor();
  out.checks.horizontalOverflow = await page.evaluate(() => {
    const el = document.scrollingElement;
    return el ? el.scrollWidth > el.clientWidth + 1 : null;
  });
  out.checks.title = await page.title().then((t) => t.slice(0, 80));
  const shot = join(dir, 'mobile-390-plan.png');
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: shot, fullPage: true });
  out.screenshot = shot;
  if (out.consoleErrors.length) {
    out.consoleErrors = out.consoleErrors.filter(
      (entry) => !entry.includes('Download the React DevTools'),
    );
  }
  await writeFile(
    join(dir, 'mobile-smoke.json'),
    JSON.stringify(out, null, 2),
    'utf8',
  );
  assert.ok(!out.checks.horizontalOverflow, 'no horizontal overflow at 390px');
  assert.equal(out.consoleErrors.length, 0, JSON.stringify(out.consoleErrors));
  assert.equal(
    out.failedRequests.length,
    0,
    JSON.stringify(out.failedRequests),
  );
  console.log(JSON.stringify(out, null, 2));
} finally {
  await browser.close();
}
