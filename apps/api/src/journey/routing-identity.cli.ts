import { createDatabase } from '../infrastructure/database/database.client.js';
import { prepareRoutingIdentities } from './infrastructure/routing-identity-preparation.js';

const database = createDatabase();
try {
  const result = await prepareRoutingIdentities(database);
  process.stdout.write(
    `${JSON.stringify({ status: 'COMPLETED', ...result })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await database.destroy();
}
