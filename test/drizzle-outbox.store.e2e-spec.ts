import { PGlite } from '@electric-sql/pglite';
import { OutboxStorage } from '@nestjs/outbox';
import { outboxInboxStoreContract, outboxStoreContract, type OutboxStoreHarness } from '@nestjs/outbox/testing';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { DrizzleOutboxStore } from '../src/infra/database/drizzle-outbox.store.js';
import type { Database, Transaction } from '../src/infra/database/drizzle.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/** A store on emptied tables, built the way Nest builds it: with the database and a registry. */
async function freshStore(db: Database): Promise<OutboxStoreHarness<Transaction> & { store: DrizzleOutboxStore }> {
  await db.execute(sql`TRUNCATE outbox_messages, outbox_dead_letters, outbox_inbox RESTART IDENTITY`);
  const store = new DrizzleOutboxStore(db, new OutboxStorage());
  return { store, transaction: (work) => db.transaction(work), notATransaction: db };
}

describe('DrizzleOutboxStore on PGlite: the store contract', () => {
  const client = new PGlite();
  const db = drizzle({ client }) as unknown as Database;
  beforeAll(() => migrate(db as never, { migrationsFolder }));
  afterAll(() => client.close());

  // The concurrency cases run too; with one connection, PGlite runs them one transaction at a time.
  for (const c of outboxStoreContract(() => freshStore(db), { concurrent: true })) it(c.name, () => c.run());
  describe('the inbox contract', () => {
    for (const c of outboxInboxStoreContract(() => freshStore(db), { concurrent: true })) it(c.name, () => c.run());
  });
});
