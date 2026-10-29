import type { PoolConfig } from 'pg';

export type CliEnvironment = NodeJS.ProcessEnv;

export type ResolvedCliEnvironment = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  databaseUrl: string | null;
};

function decode(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`${label} has invalid URL encoding.`);
  }
}

function loopback(value: string, label: string): string {
  if (value !== '127.0.0.1' && value !== '::1' && value !== 'localhost') {
    throw new Error(`${label} must be loopback-only.`);
  }
  return value;
}

export function resolveCliEnvironment(
  environment: CliEnvironment,
): ResolvedCliEnvironment {
  const rawUrl = environment.DATABASE_URL?.trim() ?? '';
  const url = rawUrl ? new URL(rawUrl) : null;
  if (url && url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use postgres or postgresql protocol.');
  }
  const urlHost = url ? loopback(url.hostname, 'DATABASE_URL') : null;
  const urlPort = url?.port ? Number(url.port) : null;
  const urlDatabase = url
    ? decode(url.pathname.slice(1), 'DATABASE_URL database')
    : null;
  if (url && (!urlPort || !urlDatabase)) {
    throw new Error('DATABASE_URL must include explicit port and database.');
  }

  const componentPort = environment.POSTGRES_PORT?.trim() ?? '';
  const componentDatabase = environment.POSTGRES_DB?.trim() ?? '';
  const componentHost = environment.POSTGRES_HOST?.trim() ?? '';
  const hasComponents = Boolean(
    componentPort ||
    componentDatabase ||
    componentHost ||
    environment.POSTGRES_USER ||
    environment.POSTGRES_PASSWORD,
  );
  if (!url && !hasComponents) {
    throw new Error(
      'Database CLI requires DATABASE_URL or explicit POSTGRES_PORT and POSTGRES_DB.',
    );
  }

  if (url && hasComponents) {
    if (componentPort && Number(componentPort) !== urlPort) {
      throw new Error('DATABASE_URL and POSTGRES_PORT disagree.');
    }
    if (componentDatabase && componentDatabase !== urlDatabase) {
      throw new Error('DATABASE_URL and POSTGRES_DB disagree.');
    }
    if (componentHost && componentHost !== urlHost) {
      throw new Error('DATABASE_URL and POSTGRES_HOST disagree.');
    }
  }

  if (url) {
    return {
      host: urlHost!,
      port: urlPort!,
      database: urlDatabase!,
      user: decode(url.username, 'DATABASE_URL username'),
      password: decode(url.password, 'DATABASE_URL password'),
      databaseUrl: rawUrl,
    };
  }

  const port = Number(componentPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      'POSTGRES_PORT must be explicitly set to integer 1..65535.',
    );
  }
  if (!componentDatabase)
    throw new Error('POSTGRES_DB must be explicitly set.');
  return {
    host: loopback(componentHost || '127.0.0.1', 'POSTGRES_HOST'),
    port,
    database: componentDatabase,
    user: environment.POSTGRES_USER?.trim() ?? '',
    password: environment.POSTGRES_PASSWORD ?? '',
    databaseUrl: null,
  };
}

export function databaseCliPoolConfig(
  resolved: ResolvedCliEnvironment,
): PoolConfig {
  return {
    ...(resolved.databaseUrl
      ? { connectionString: resolved.databaseUrl }
      : {
          host: resolved.host,
          port: resolved.port,
          database: resolved.database,
          user: resolved.user,
          password: resolved.password,
        }),
    application_name: 'transum-in-nexus-db-cli',
    connectionTimeoutMillis: 3_000,
    max: 1,
  };
}

export function assertMigrateDatabaseIdentity(
  expected: Pick<ResolvedCliEnvironment, 'database' | 'user'>,
  actual: { database: string; user: string },
): void {
  if (actual.database !== expected.database) {
    throw new Error(
      'Connected database does not match configured POSTGRES_DB/DATABASE_URL.',
    );
  }
  if (expected.user && actual.user !== expected.user) {
    throw new Error('Connected role does not match configured POSTGRES_USER.');
  }
}
