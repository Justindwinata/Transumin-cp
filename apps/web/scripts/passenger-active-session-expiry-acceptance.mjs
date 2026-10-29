import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

// FR-009 / FR-014. Reuse an ACTIVE WALK journey; never run outside owned CP2.
export async function assertActiveSessionExpiry(
  page,
  context,
  browser,
  journeyId,
) {
  await assertCp2Runtime();
  const secret = process.env.PASSENGER_SESSION_SECRET;
  assert.ok(secret?.length >= 32, 'Injected CP2 session secret required');
  const original = (await context.cookies()).find(
    (cookie) => cookie.name === 'transumin_proto_session',
  );
  assert.ok(original?.httpOnly, 'Signed HttpOnly session required');
  const [owner, expiry, signature, extra] = decodeURIComponent(
    original.value,
  ).split('.');
  const sign = (expiresAt) =>
    createHmac('sha256', secret)
      .update(`${owner}.${expiresAt}`)
      .digest('base64url');
  assert.ok(
    !extra &&
      /^passenger:[0-9a-f-]{36}$/.test(owner) &&
      signature === sign(expiry),
    'Injected secret must match actual runtime session',
  );
  assert.ok(
    Number(expiry) > Date.now() / 1000 + 30,
    'Original session near expiry',
  );
  // Runtime identity is checked above; only this owned test context accepts its local self-signed leaf.
  const observer = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    // Independent valid session copy reads authoritative state without reviving UI.
    await observer.addCookies([original]);
    const read = async () => {
      const response = await observer.request.get(
        `${process.env.PASSENGER_WEB_URL}/api/passenger/journeys/${journeyId}`,
      );
      assert.equal(response.status(), 200, 'Authoritative journey read failed');
      return (await response.json()).data;
    };
    const before = await read();
    assert.equal(before.status, 'ACTIVE');
    assert.equal(
      before.segments[before.progress.completed_segment_count].mode,
      'WALK',
    );
    const card = page.locator('.navigation-card');
    const scope = await card.getAttribute('data-navigation-scope');
    const index = Number(await card.getAttribute('data-maneuver-index'));
    const total = Number(await card.getAttribute('data-maneuver-total'));
    assert.ok(index >= 0 && index + 1 < total, 'Advanceable WALK required');

    // Real signed payload expires on server wall clock. Browser retains cookie
    // deliberately: proves expiry validation, not malformed/tampered HMAC refusal.
    const expiresAt = Math.floor(Date.now() / 1000) + 2;
    const expiredValue = `${owner}.${expiresAt}.${sign(expiresAt)}`;
    await context.addCookies([{ ...original, value: expiredValue }]);
    await setTimeout(Math.max(0, expiresAt * 1000 - Date.now()) + 100);

    const mutations = [];
    const record = (request) => {
      if (
        request.url().includes('/api/passenger/') &&
        ['POST', 'PATCH', 'DELETE'].includes(request.method())
      )
        mutations.push(request);
    };
    page.on('request', record);
    try {
      await page
        .getByRole('button', { name: 'Manuver berikutnya', exact: true })
        .click();
      await page.waitForFunction(
        (expected) =>
          Number(
            document
              .querySelector('.navigation-card')
              ?.getAttribute('data-maneuver-index'),
          ) === expected,
        index + 1,
      );
      await page
        .getByRole('button', { name: 'Jeda navigasi', exact: true })
        .click();
      assert.equal(await card.getAttribute('data-navigation-paused'), 'true');
      await page
        .getByRole('button', { name: 'Lanjutkan navigasi', exact: true })
        .click();
      assert.equal(await card.getAttribute('data-navigation-paused'), 'false');
      assert.equal(
        mutations.length,
        0,
        'Local navigation issued protected mutation',
      );

      const rejected = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/journeys/${journeyId}/progress`) &&
          response.request().method() === 'PATCH',
      );
      await page
        .getByRole('button', { name: 'Lanjutkan Perjalanan', exact: true })
        .click();
      const response = await rejected;
      assert.equal(
        response.status(),
        403,
        'Expired session mutation not refused',
      );
      assert.equal((await response.json()).error?.code, 'INVALID_SESSION');
      assert.ok(
        !response.headers()['set-cookie'],
        'Refusal silently replaced owner',
      );
      await page
        .getByRole('alert')
        .filter({ hasText: 'Sesi sudah berakhir.' })
        .first()
        .waitFor();
      assert.equal(mutations.length, 1, 'Unexpected mutation retry');
      assert.equal(await card.getAttribute('data-navigation-scope'), scope);
      assert.equal(
        Number(await card.getAttribute('data-maneuver-index')),
        index + 1,
      );
      assert.ok(
        JSON.stringify(await read()) === JSON.stringify(before),
        'Expired UI changed authoritative journey',
      );
      assert.ok(
        (await context.cookies()).find(
          (cookie) => cookie.name === original.name,
        )?.value === expiredValue,
        'Expired session silently rotated',
      );

      // Refresh refuses restore, clears only the inaccessible local pointer, and never mints a new owner.
      const restore = page.waitForResponse(
        (result) =>
          result.url().endsWith(`/journeys/${journeyId}`) &&
          result.request().method() === 'GET',
      );
      await page.reload();
      const restored = await restore;
      assert.equal(restored.status(), 403);
      assert.equal((await restored.json()).error?.code, 'INVALID_SESSION');
      assert.ok(
        !restored.headers()['set-cookie'],
        'Restore silently replaced owner',
      );
      await page
        .getByRole('alert')
        .filter({ hasText: 'Sesi perjalanan tersimpan sudah berakhir.' })
        .first()
        .waitFor();
      assert.equal(
        await card.count(),
        0,
        'Rejected restore exposed stale navigation',
      );
      assert.equal(
        await page
          .getByRole('heading', { name: 'Perjalanan aktif Anda' })
          .count(),
        0,
      );
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem('transumin.passenger.journey'),
        ),
        null,
        'Rejected restore retained inaccessible local pointer',
      );
      assert.equal(mutations.length, 1, 'Refresh retried protected mutation');
      assert.ok(
        (await context.cookies()).find(
          (cookie) => cookie.name === original.name,
        )?.value === expiredValue,
        'Refresh silently rotated expired session',
      );
      assert.ok(
        JSON.stringify(await read()) === JSON.stringify(before),
        'Refresh changed authoritative journey',
      );
    } finally {
      page.off('request', record);
    }
    return {
      signed_expiry_refused: true,
      local_navigation_safe: true,
      authoritative_journey_unchanged: true,
      no_owner_replacement: true,
      expired_refresh_safe: true,
    };
  } finally {
    await observer.close();
  }
}
