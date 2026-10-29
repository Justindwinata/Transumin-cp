import type { PoolConfig } from 'pg';

const DEFAULT_PORT = 5433;

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('POSTGRES_PORT must be an integer from 1 to 65535');
  }

  return port;
}

function parseConnectionString(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(
      'DATABASE_URL must use the postgres or postgresql protocol',
    );
  }

  return value;
}

export function getDatabaseConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PoolConfig {
  const databaseUrl = environment.DATABASE_URL?.trim();

  if (databaseUrl !== undefined && databaseUrl !== '') {
    return {
      connectionString: parseConnectionString(databaseUrl),
      application_name: 'transum-in-nexus-api',
      connectionTimeoutMillis: 3_000,
      max: 10,
    };
  }

  return {
    host: environment.POSTGRES_HOST?.trim() || '127.0.0.1',
    port: parsePort(environment.POSTGRES_PORT),
    database: environment.POSTGRES_DB?.trim() || 'transum_in_nexus',
    user: environment.POSTGRES_USER?.trim() || 'transum_in',
    password: environment.POSTGRES_PASSWORD ?? '',
    application_name: 'transum-in-nexus-api',
    connectionTimeoutMillis: 3_000,
    max: 10,
  };
}
