import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

await assertCp2Runtime();
const web = process.env.PASSENGER_WEB_URL;
const dir = process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR;
assert.ok(web && dir && process.env.PASSENGER_SESSION_SECRET);
const cookieName = 'transumin_proto_session';
const obsoleteOwner = 'passenger:00000000-0000-4000-8000-000000000001';
const summary = {
  suite: 'SESSION_STABILITY',
  status: 'NOT VERIFIED',
  evidence:
    'Real same-origin UI and OTP; synthetic obsolete/expired cookie only',
  results: [],
};
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PRODUCT_P1R_CHROME ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  for (const width of [390, 1280]) {
    for (const kind of ['obsolete-key', 'expired']) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        ignoreHTTPSErrors: true,
      });
      try {
        const expiry =
          Math.floor(Date.now() / 1000) + (kind === 'expired' ? -60 : 3600);
        const key =
          kind === 'expired'
            ? process.env.PASSENGER_SESSION_SECRET
            : 'SIMULATED-obsolete-secret-not-an-active-key';
        const signature = createHmac('sha256', key)
          .update(`${obsoleteOwner}.${expiry}`)
          .digest('base64url');
        const obsoleteCookie = `${obsoleteOwner}.${expiry}.${signature}`;
        await context.addCookies([
          {
            name: cookieName,
            value: obsoleteCookie,
            url: web,
            httpOnly: true,
            secure: true,
            sameSite: 'Strict',
          },
        ]);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.addInitScript(() => {
          localStorage.setItem(
            'transumin.passenger.journey',
            '00000000-0000-4000-8000-000000000002',
          );
        });
        await page.goto(web, { waitUntil: 'domcontentloaded' });
        await page
          .getByText(
            'Sesi perjalanan tersimpan sudah berakhir. Cari rute baru untuk memulai sesi baru.',
            { exact: true },
          )
          .waitFor();
        assert.equal(
          await page.evaluate(() =>
            localStorage.getItem('transumin.passenger.journey'),
          ),
          null,
          'Expired session retained inaccessible local journey pointer',
        );
        await page
          .getByRole('combobox', { name: 'Dari', exact: true })
          .waitFor();
        async function choose(label, query) {
          const pending = page.waitForResponse(
            (r) =>
              new URL(r.url()).pathname.endsWith('/transit/places') &&
              new URL(r.url()).searchParams.get('q') === query,
          );
          await page
            .getByRole('combobox', { name: label, exact: true })
            .fill(query);
          const response = await pending;
          assert.equal(
            response.status(),
            200,
            'Stale cookie blocked public place lookup',
          );
          const rows = (await response.json()).data;
          assert.ok(rows.length);
          await page.getByRole('option').first().click();
        }
        await choose('Dari', 'Gambir');
        await choose('Ke', 'Pejaten');
        assert.equal(
          (await context.cookies()).find((c) => c.name === cookieName)?.value,
          obsoleteCookie,
          'Public startup/lookup silently rotated session',
        );
        const preferences = [];
        let selected;
        let freshCookie;
        for (const preference of [
          'BALANCED',
          'FASTEST',
          'FEWEST_TRANSFERS',
          'LEAST_WALKING',
        ]) {
          const pending = page.waitForResponse(
            (r) =>
              r.url().endsWith('/journeys/plan') &&
              r.request().method() === 'POST',
          );
          if (preference === 'BALANCED')
            await page
              .getByRole('button', { name: 'Cari perjalanan', exact: true })
              .click();
          else
            await page
              .getByRole('combobox', { name: /^Urutkan berdasarkan/ })
              .selectOption(preference);
          const response = await pending;
          const body = await response.json();
          assert.equal(response.status(), 201, JSON.stringify(body.error));
          assert.ok(body.data.length, `${preference}: no routes`);
          selected = body.data[0];
          assert.equal(selected.routing_context.provider, 'OTP');
          await page
            .getByRole('region', { name: 'Pilihan perjalanan' })
            .getByRole('button')
            .first()
            .waitFor();
          assert.equal(
            await page
              .getByRole('alert')
              .filter({ hasText: 'Sesi sudah berakhir.' })
              .count(),
            0,
          );
          const current = (await context.cookies()).find(
            (c) => c.name === cookieName,
          );
          assert.ok(current?.httpOnly && current.secure);
          assert.notEqual(current.value, obsoleteCookie);
          assert.notEqual(
            decodeURIComponent(current.value).split('.')[0],
            obsoleteOwner,
          );
          if (freshCookie)
            assert.equal(
              current.value,
              freshCookie.value,
              'Preference changed session owner',
            );
          else {
            assert.equal(
              response.headers()['x-passenger-session-renewed'],
              'true',
            );
            freshCookie = current;
          }
          preferences.push({
            preference,
            options: body.data.length,
            request_id: body.meta.request_id,
          });
        }
        await page.screenshot({
          path: join(dir, `session-${width}-${kind}.png`),
          fullPage: true,
        });
        // Prove new owner can activate, but an invalid cookie cannot read or mutate it.
        await page
          .getByRole('button', { name: 'Mulai Perjalanan', exact: true })
          .click();
        await page
          .getByRole('heading', { name: 'Perjalanan aktif Anda' })
          .waitFor();
        const journeyId = await page.evaluate(() =>
          localStorage.getItem('transumin.passenger.journey'),
        );
        assert.ok(journeyId);
        const observer = await browser.newContext({ ignoreHTTPSErrors: true });
        try {
          await observer.addCookies([freshCookie]);
          const read = () =>
            observer.request.get(`${web}/api/passenger/journeys/${journeyId}`);
          const before = await (await read()).json();
          await context.addCookies([{ ...freshCookie, value: obsoleteCookie }]);
          for (const method of ['GET', 'PATCH']) {
            const response = await context.request.fetch(
              `${web}/api/passenger/journeys/${journeyId}${method === 'PATCH' ? '/progress' : ''}`,
              {
                method,
                headers: { origin: new URL(web).origin },
                ...(method === 'PATCH'
                  ? { data: { completed_segment_count: 99 } }
                  : {}),
              },
            );
            assert.equal(response.status(), 403);
            assert.equal((await response.json()).error.code, 'INVALID_SESSION');
            assert.ok(!response.headers()['set-cookie']);
          }
          const after = await (await read()).json();
          assert.deepEqual(
            after.data,
            before.data,
            'Rejected stale mutation changed journey',
          );
        } finally {
          await observer.close();
        }
        assert.deepEqual(errors, []);
        summary.results.push({
          width,
          cookie: kind,
          preferences,
          owned_read_and_mutation_refusal: 'PASS',
        });
        console.log(
          JSON.stringify({
            suite: 'SESSION_STABILITY',
            width,
            cookie: kind,
            status: 'PASS',
          }),
        );
      } finally {
        await context.close();
      }
    }
  }
  summary.status = 'PASS';
} finally {
  await writeFile(
    join(dir, 'session-stability.json'),
    JSON.stringify(summary, null, 2) + '\n',
  );
  await browser.close();
}
console.log(JSON.stringify(summary));
