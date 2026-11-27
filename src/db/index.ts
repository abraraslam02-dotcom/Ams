import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export function isPostgresEnvConfigured(): boolean {
  return Boolean(
    process.env.SQL_HOST &&
      process.env.SQL_USER &&
      process.env.SQL_PASSWORD &&
      process.env.SQL_DB_NAME
  );
}

function buildPoolConfig(): PoolConfig {
  const host = String(process.env.SQL_HOST || '').trim();
  const isUnixSocket = host.startsWith('/');
  const portRaw = Number(process.env.SQL_PORT || 5432);
  const useSsl =
    !isUnixSocket &&
    String(process.env.SQL_SSL || '').trim().toLowerCase() === 'true';

  const cfg: PoolConfig = {
    host: host || undefined,
    user: process.env.SQL_USER || undefined,
    password: process.env.SQL_PASSWORD || undefined,
    database: process.env.SQL_DB_NAME || undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  };

  if (!isUnixSocket && Number.isFinite(portRaw) && portRaw > 0) {
    cfg.port = portRaw;
  }
  if (useSsl) {
    cfg.ssl = { rejectUnauthorized: false };
  }
  return cfg;
}

export const createPool = (): Pool => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool(buildPoolConfig());

    global._postgresPool.on('error', (err) => {
      console.error('[AMS Cloud SQL] Idle PostgreSQL pool client error:', err.message);
    });
  }
  return global._postgresPool;
};

export const pool = createPool();
export const db = drizzle(pool, { schema });
