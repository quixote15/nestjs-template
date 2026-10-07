import { Logger } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export type Database = NodePgDatabase;
/** The `tx` that `db.transaction()` passes its callback. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const logger = new Logger('Database');

/** A pg pool on `connectionString`; DrizzleModule closes it in onApplicationShutdown(), after the relay drained. */
export function createDatabase(connectionString: string): Database {
  const pool = new Pool({ connectionString });
  // An idle connection's error (Postgres restarting, a network cut) is emitted on the pool,
  // and an 'error' event without a listener crashes the process. The pool drops that
  // connection and opens a new one for the next query; /health/ready reports the outage.
  pool.on('error', (error) => logger.warn(`Idle database connection lost: ${error.message}`));
  return drizzle({ client: pool });
}
