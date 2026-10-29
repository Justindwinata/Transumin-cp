import assert from 'node:assert/strict';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { assertCp2Runtime } from './cp2-runtime-guard.mjs';
await assertCp2Runtime();
const browser = await chromium.launch({
  executablePath:
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const results = [];
try {
  for (const { width, option } of [390, 1280].flatMap((width) =>
    [0, 1, 2].map((option) => ({ width, option })),
  )) {
    console.log(
      JSON.stringify({
        suite: 'DIRECT_PROGRESS',
        width,
        option,
        stage: 'planning',
      }),
    );
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(process.env.PASSENGER_WEB_URL);
    await page
      .getByText('Status layanan & contoh perjalanan', { exact: true })
      .click();
    await page.getByRole('button', { name: /Muat contoh perjalanan/ }).click();
    await page
      .getByRole('region', { name: 'Pilihan perjalanan' })
      .getByRole('button')
      .first()
      .waitFor({ timeout: 120000 });
    await page
      .getByRole('region', { name: 'Pilihan perjalanan' })
      .getByRole('button')
      .nth(option)
      .click();
    await page
      .getByRole('button', { name: 'Mulai Perjalanan', exact: true })
      .click();
    await page
      .getByRole('heading', { name: 'Perjalanan aktif Anda' })
      .waitFor();
    let completed = false,
      actions = 0;
    for (; actions < 20; actions++) {
      const action = page.getByRole('button', {
        name: /^(Lanjutkan Perjalanan|Saya Sudah Naik|Saya Sudah Turun|Selesaikan Perjalanan)$/,
      });
      assert.equal(await action.count(), 1);
      const responsePromise = page.waitForResponse(
        (r) =>
          /journeys\/[^/]+\/(progress|boarding|alighting)/.test(r.url()) &&
          ['POST', 'PATCH'].includes(r.request().method()),
      );
      await action.click();
      const response = await responsePromise;
      const body = await response.json();
      assert.ok(response.ok(), JSON.stringify(body.error));
      console.log(
        JSON.stringify({
          suite: 'DIRECT_PROGRESS',
          width,
          option,
          action: actions,
          status: body.data.status,
        }),
      );
      if (body.data.status === 'COMPLETED') {
        completed = true;
        break;
      }
      if (actions === 0) await page.reload();
      await page
        .getByLabel('Waktu tahapan perjalanan (WIB, skenario uji)')
        .waitFor();
      await page
        .getByRole('button', {
          name: /^(Lanjutkan Perjalanan|Saya Sudah Naik|Saya Sudah Turun|Selesaikan Perjalanan)$/,
        })
        .waitFor();
    }
    assert.equal(completed, true);
    await page.reload();
    await page
      .getByText('Selesaikan Perjalanan — perjalanan ini sudah selesai.', {
        exact: true,
      })
      .waitFor();
    await page.screenshot({
      path: join(
        process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR,
        `direct-complete-${width}-${option}.png`,
      ),
    });
    results.push({
      width,
      option,
      status: 'PASS',
      actions: actions + 1,
      completion_persisted: true,
    });
    await context.close();
  }
  console.log(
    JSON.stringify({
      suite: 'COMPLETE_JOURNEY_UI',
      status: 'PASS',
      provenance:
        'Direct button clicks without editing stage time; real UI/API/OTP; historical schedule',
      results,
    }),
  );
} finally {
  await browser.close();
}
