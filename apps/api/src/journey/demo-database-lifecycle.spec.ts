import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  HEADROOM,
  SEED,
  assertDropIdentity,
  localUrl,
  scratchIdentityName,
  type Identity,
} from './demo-database-lifecycle.js';

describe('D8 demo database lifecycle guards', () => {
  it('accepts only exact local endpoint and derives UUID scratch names', () => {
    assert.equal(
      localUrl({
        DATABASE_URL: 'postgresql://127.0.0.1:5433/anything',
        POSTGRES_HOST: '127.0.0.1',
        POSTGRES_PORT: '5433',
      }).pathname,
      '/transum_in_nexus',
    );
    assert.equal(
      scratchIdentityName('12345678-1234-4234-9234-123456789abc'),
      'tnx_demo_ci_12345678123442349234123456789abc',
    );
    assert.equal(HEADROOM, 8_724_152_320);
  });

  it('rejects remote or alternate endpoints', () => {
    for (const DATABASE_URL of [
      'postgresql://localhost:5433/db',
      'postgresql://127.0.0.1:5432/db',
      'postgresql://example.com:5433/db',
      'postgresql://127.0.0.1:5433/db?sslmode=require',
    ])
      assert.throws(() => localUrl({ DATABASE_URL }));
  });

  it('permits drop only with exact current-invocation identity and zero sessions', () => {
    const identity: Identity = {
      name: 'tnx_demo_ci_12345678123442349234123456789abc',
      oid: 42,
      owner: 'transum_in',
      marker: 'tnx_demo:D8:one',
    };
    assert.doesNotThrow(() =>
      assertDropIdentity(identity, identity, identity.marker, 0),
    );
    assert.throws(() =>
      assertDropIdentity(
        identity,
        { ...identity, oid: 43 },
        identity.marker,
        0,
      ),
    );
    assert.throws(() => assertDropIdentity(identity, identity, 'other', 0));
    assert.throws(() =>
      assertDropIdentity(identity, identity, identity.marker, 1),
    );
  });

  it('rejects untrusted lifecycle inputs without issuing DROP', () => {
    const seedIdentity: Identity = {
      name: SEED,
      oid: 999,
      owner: 'transum_in',
      marker: 'tnx_demo:seed_20261011',
    };
    const unrelatedIdentity: Identity = {
      name: 'transum_in_nexus',
      oid: 1000,
      owner: 'transum_in',
      marker: 'any',
    };
    const trusted: Identity = {
      name: 'tnx_demo_ci_12345678123442349234123456789abc',
      oid: 42,
      owner: 'transum_in',
      marker: 'tnx_demo:D8:trusted',
    };
    // Protected / unrelated / wrong-invocation all throw via assertDropIdentity.
    assert.throws(() =>
      assertDropIdentity(seedIdentity, seedIdentity, seedIdentity.marker, 0),
    );
    assert.throws(() =>
      assertDropIdentity(
        unrelatedIdentity,
        unrelatedIdentity,
        unrelatedIdentity.marker,
        0,
      ),
    );
    assert.throws(() =>
      assertDropIdentity(trusted, trusted, 'tnx_demo:D8:other', 0),
    );
    assert.throws(() =>
      assertDropIdentity(
        trusted,
        { ...trusted, name: `${trusted.name}0` },
        trusted.marker,
        0,
      ),
    );
    assert.throws(() =>
      assertDropIdentity(trusted, { ...trusted, oid: 43 }, trusted.marker, 0),
    );
    assert.throws(() =>
      assertDropIdentity(
        trusted,
        { ...trusted, owner: 'other' },
        trusted.marker,
        0,
      ),
    );
    assert.throws(() =>
      assertDropIdentity(
        trusted,
        { ...trusted, marker: 'tnx_demo:D8:other' },
        'tnx_demo:D8:trusted',
        0,
      ),
    );
    assert.throws(() =>
      assertDropIdentity(trusted, trusted, trusted.marker, 1),
    );
    // Server/port guards reject remote hostnames before any destructive query can run.
    assert.throws(() =>
      localUrl({ DATABASE_URL: 'postgresql://example.com:5433/db' }),
    );
    assert.throws(() =>
      localUrl({
        DATABASE_URL: 'postgresql://127.0.0.1:5433/db',
        POSTGRES_PORT: '5432',
      }),
    );
  });

  it('rejects dispose CLI invocation without evidence-file provenance', async () => {
    const tsx = fileURLToPath(
      new URL('./demo-database-lifecycle.cli.ts', import.meta.url),
    );
    await new Promise<void>((resolve, reject) => {
      execFile(
        process.execPath,
        ['--import', 'tsx', tsx, 'dispose'],
        (error, _stdout, stderr) => {
          try {
            assert.ok(error, 'dispose without evidence path should fail');
            assert.equal(
              (error as NodeJS.ErrnoException & { code?: number }).code,
              1,
            );
            assert.match(stderr, /Expected command: seed, run or present/);
            assert.ok(
              !/DROP\s+DATABASE/i.test(_stdout ?? ''),
              'no DROP emitted on rejection',
            );
            resolve();
          } catch (assertionError) {
            reject(assertionError);
          }
        },
      );
    });

    await new Promise<void>((resolve, reject) => {
      execFile(
        process.execPath,
        ['--import', 'tsx', tsx, 'dispose', '/tmp/missing-evidence.json'],
        (error, _stdout, stderr) => {
          try {
            assert.ok(error);
            assert.match(
              stderr,
              /Expected command: seed, run or present|No such file|ENOENT/i,
            );
            assert.ok(!/DROP\s+DATABASE/i.test(_stdout ?? ''));
            resolve();
          } catch (assertionError) {
            reject(assertionError);
          }
        },
      );
    });
  });

  it('rejects fabricated evidence before database access', async () => {
    const tsx = fileURLToPath(
      new URL('./demo-database-lifecycle.cli.ts', import.meta.url),
    );
    const dir = await mkdtemp(join(tmpdir(), 'tnx-neg-'));
    try {
      const fabricated = join(dir, 'evidence.json');
      await writeFile(
        fabricated,
        JSON.stringify({
          command: 'run',
          invocation: '11111111-1111-4111-8111-111111111111',
          status: 'FAILED',
          created: {
            name: 'tnx_demo_ci_11111111111141118111111111111111',
            oid: 1,
            owner: 'transum_in',
            marker: 'tnx_demo:D8:11111111-1111-4111-8111-111111111111',
          },
        }),
      );
      // Caller-supplied evidence file is not a deletion authority: any dispose
      // attempt must fail at argument parsing before any database action.
      await new Promise<void>((resolve, reject) => {
        execFile(
          process.execPath,
          ['--import', 'tsx', tsx, 'dispose', fabricated],
          (error, _stdout, stderr) => {
            try {
              assert.ok(error, 'fabricated evidence must be rejected');
              assert.match(stderr, /Expected command: seed, run or present/);
              assert.ok(!/DROP\s+DATABASE/i.test(_stdout ?? ''));
              resolve();
            } catch (assertionError) {
              reject(assertionError);
            }
          },
        );
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
