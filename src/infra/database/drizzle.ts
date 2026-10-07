import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export type Database = NodePgDatabase;
/** The `tx` that `db.transaction()` passes its callback. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
