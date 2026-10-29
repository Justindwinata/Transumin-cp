import assert from 'node:assert/strict';
import { chromium, request } from 'playwright-core';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertCp2Runtime } from './cp2-runtime-guard.mjs';
await assertCp2Runtime();
const web = process.env.PASSENGER_WEB_URL;
const dir = process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR;
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const admin = await request.newContext({
  ignoreHTTPSErrors: true,
  extraHTTPHeaders: { origin: web },
});
const results = [];
let reportId;
async function adminPost(path, data) {
  let response = await admin.post(`${web}${path}`, {
    data,
    headers: { 'idempotency-key': randomUUID() },
    timeout: 30000,
  });
  // Respect the existing login limit; bounded retry only, no reset/bypass.
  for (
    let attempt = 0;
    path.endsWith('/auth/login') && response.status() === 429 && attempt < 12;
    attempt++
  ) {
    console.log(
      JSON.stringify({
        suite: 'SIMPLE_UI',
        stage: 'waiting-for-login-rate-window',
        attempt,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30000));
    response = await admin.post(`${web}${path}`, {
      data,
      headers: { 'idempotency-key': randomUUID() },
      timeout: 30000,
    });
  }
  assert.ok(
    response.ok(),
    `Admin ${response.status()} ${await response.text()}`,
  );
  return (await response.json()).data;
}
try {
  await adminPost('/api/v1/auth/login', {
    email: 'admin.sample@local.test',
    password: 'SAMPLE-Admin-123456',
  });
  const previous = (
    await (await admin.get(`${web}/api/v1/admin/passenger-reports`)).json()
  ).data;
  for (const row of previous) {
    if (
      /^SIMULASI UAT (390|1280): layanan 6H diuji/.test(row.description) &&
      row.verification_status === 'ADMIN_RESTRICTED' &&
      row.restriction_active === true
    ) {
      await adminPost(
        `/api/v1/admin/passenger-reports/${row.report_id}/close`,
        {
          decision: 'RETRACTED',
          reason: 'SIMULASI UAT: cleanup percobaan UI sebelumnya.',
        },
      );
    }
  }
  for (const width of [390, 1280]) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      ignoreHTTPSErrors: true,
      permissions: [],
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    console.log(
      JSON.stringify({ suite: 'SIMPLE_UI', width, stage: 'planning' }),
    );
    await page.goto(web);
    await page
      .getByText('Status layanan & contoh perjalanan', { exact: true })
      .click();
    await page.getByRole('button', { name: /Muat contoh perjalanan/ }).click();
    const choices = page.getByRole('region', { name: 'Pilihan perjalanan' });
    await choices
      .getByRole('button')
      .filter({ hasText: 'TransJakarta 6H' })
      .click({ timeout: 120000 });
    await page
      .getByRole('button', { name: 'Mulai Perjalanan', exact: true })
      .click();
    await page
      .getByRole('heading', { name: 'Perjalanan aktif Anda' })
      .waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Ada masalah', exact: true })
        .count(),
      1,
    );
    assert.equal(
      await page.getByLabel('Keterangan', { exact: true }).isVisible(),
      false,
    );
    await page
      .getByLabel('Waktu tahapan perjalanan (WIB, skenario uji)')
      .fill('2026-10-02T08:05');
    await page
      .getByRole('button', { name: 'Lanjutkan Perjalanan', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Saya Sudah Naik', exact: true })
      .waitFor();
    await page.reload();
    await page
      .getByRole('button', { name: 'Saya Sudah Naik', exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByLabel('Waktu tahapan perjalanan (WIB, skenario uji)')
        .inputValue(),
      '2026-10-02T08:05',
    );
    await page
      .getByRole('button', { name: 'Ada masalah', exact: true })
      .click();
    const target = page.locator('#report-target');
    await target.selectOption({ label: '6H · Trayek' });
    await page
      .getByLabel('Keterangan', { exact: true })
      .fill(
        `SIMULASI UAT ${width}: layanan 6H diuji tidak beroperasi. Bukan kejadian nyata.`,
      );
    const responsePromise = page.waitForResponse(
      (r) =>
        r.url().endsWith('/passenger-reports') &&
        r.request().method() === 'POST',
    );
    await page
      .getByRole('button', { name: 'Kirim laporan', exact: true })
      .click();
    console.log(
      JSON.stringify({ suite: 'SIMPLE_UI', width, stage: 'report-submitted' }),
    );
    const response = await responsePromise;
    assert.ok(response.ok());
    const report = (await response.json()).data;
    reportId = report.report_id;
    assert.equal(report.verification_status, 'REPORTED_UNVERIFIED');
    await adminPost(`/api/v1/admin/passenger-reports/${reportId}/restrict`, {
      operational_state: 'UNAVAILABLE',
      incident_type: 'SERVICE_SUSPENSION',
      evidence_reference: 'SAMPLE local UI workflow evidence',
      observed_at: new Date().toISOString(),
      valid_for_minutes: 5,
      reason: 'SIMULASI UAT: pengujian UI; bukan gangguan nyata.',
    });
    console.log(
      JSON.stringify({ suite: 'SIMPLE_UI', width, stage: 'restricted' }),
    );
    await page.reload();
    await page.getByRole('button', { name: 'Gangguan', exact: true }).click();
    await page
      .getByRole('button', { name: 'Cari rute pengganti', exact: true })
      .click({ timeout: 30000 });
    await page
      .getByRole('button', { name: 'Gunakan rute pengganti ini', exact: true })
      .waitFor({ timeout: 120000 });
    const links = page.locator('.external-handoff a');
    assert.equal(await links.count(), 3);
    for (const link of await links.all()) {
      assert.ok(await link.getAttribute('aria-label'));
      assert.equal(new URL(await link.getAttribute('href')).search, '');
    }
    await page.locator('.external-handoff img').first().waitFor();
    assert.equal(
      await page
        .locator('.external-handoff img')
        .evaluateAll((nodes) =>
          nodes.every((n) => n.complete && n.naturalWidth > 0),
        ),
      true,
    );
    await page
      .getByRole('button', { name: 'Salin tujuan', exact: true })
      .isVisible()
      .then((v) => assert.equal(v, false));
    await page
      .getByText('Salin lokasi untuk pemesanan', { exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Salin tujuan', exact: true })
      .waitFor();
    await page
      .getByRole('button', { name: 'Gunakan rute pengganti ini', exact: true })
      .click();
    await page
      .getByText(/Rute pengganti diterima/)
      .last()
      .waitFor({ timeout: 30000 });
    console.log(
      JSON.stringify({ suite: 'SIMPLE_UI', width, stage: 'restricted' }),
    );
    await page.reload();
    await page.getByRole('button', { name: 'Gangguan', exact: true }).click();
    await page
      .getByText(/Rute pengganti diterima/)
      .last()
      .waitFor();
    await page.screenshot({ path: join(dir, `simple-ui-${width}.png`) });
    assert.deepEqual(errors, []);
    await adminPost(`/api/v1/admin/passenger-reports/${reportId}/close`, {
      decision: 'RETRACTED',
      reason: 'SIMULASI UAT selesai; cabut pembatasan pengujian.',
    });
    reportId = undefined;
    results.push({
      width,
      status: 'PASS',
      single_report_entry: true,
      report_unverified_before_admin: true,
      recovery_accept_reload: true,
      provider_logos_loaded: true,
      page_errors: errors.length,
    });
    await ctx.close();
  }
  console.log(
    JSON.stringify({
      suite: 'SIMPLE_UI',
      status: 'PASS',
      provenance:
        'SIMULATED reports/restrictions; real UI/API/OTP; historical schedules',
      results,
    }),
  );
} catch (error) {
  console.error(error);
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      await page.screenshot({ path: join(dir, 'simple-ui-failure.png') });
      await writeFile(
        join(dir, 'simple-ui-failure.txt'),
        await page.locator('body').innerText(),
      );
    }
  }
  throw error;
} finally {
  if (reportId)
    await adminPost(`/api/v1/admin/passenger-reports/${reportId}/close`, {
      decision: 'RETRACTED',
      reason: 'SIMULASI UAT cleanup; cabut pembatasan pengujian.',
    });
  await writeFile(
    join(dir, 'simple-ui-results.json'),
    JSON.stringify(results, null, 2),
  );
  await admin.dispose();
  await browser.close();
}
