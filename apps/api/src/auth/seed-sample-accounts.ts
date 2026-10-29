// FR-014: SAMPLE accounts seed only on an invocation-owned scratch database; public registration never exposed.
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { assertInvocationScratchDatabase } from '../infrastructure/database/scratch.guard.js';
import type { AuthService } from './auth.service.js';
import type { FoundationDatabase } from '../infrastructure/database/database.constants.js';

const SAMPLE: Array<{
  email: string;
  password: string;
  roles: Array<'PASSENGER' | 'RESEARCHER_OPERATOR' | 'ADMIN'>;
}> = [
  {
    email: 'passenger.sample@local.test',
    password: 'SAMPLE-Passenger-123',
    roles: ['PASSENGER'],
  },
  {
    email: 'researcher.sample@local.test',
    password: 'SAMPLE-Researcher-123',
    roles: ['RESEARCHER_OPERATOR'],
  },
  {
    email: 'admin.sample@local.test',
    password: 'SAMPLE-Admin-123456',
    roles: ['ADMIN', 'PASSENGER', 'RESEARCHER_OPERATOR'],
  },
];

/** Runs only against an owned scratch database; assertInvocationScratchDatabase rejects any other target. */
export async function seedSampleAccounts(
  database: Kysely<FoundationDatabase>,
  auth: AuthService,
): Promise<void> {
  await assertInvocationScratchDatabase(database);
  const present = await sql<{
    c: number;
  }>`select count(*)::int c from auth.user_account where email = any(${SAMPLE.map((a) => a.email)}::text[])`.execute(
    database as Kysely<unknown>,
  );
  if (present.rows[0]!.c > 0) return;
  for (const account of SAMPLE)
    await auth.provision(account.email, account.password, account.roles);
}
