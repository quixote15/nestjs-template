import { PGlite } from '@electric-sql/pglite';
import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { OutboxRelay } from '@nestjs/outbox';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { KAFKA_CLIENT } from '../src/infra/messaging/kafka.js';
import * as schema from '../src/infra/schemas/schema.js';

describe('Health', () => {
  const client = new PGlite();
  const db = drizzle({ client });
  let app: INestApplication;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
    process.env.OUTBOX_RELAY = 'off';
    process.env.KAFKA_BROKERS = '127.0.0.1:1'; // nothing listens there: Kafka is unreachable
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDrizzleToken())
      .useValue(db)
      .overrideProvider(KAFKA_CLIENT)
      .useValue({ emit: () => undefined })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  it('is live without checking any dependency', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(response.body).toMatchObject({ status: 'ok' });
  });

  it('stays ready, degraded, while Kafka is unreachable: the outbox holds the messages', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready').expect(200);

    expect(response.body.status).toBe('degraded');
    expect(response.body.details).toMatchObject({
      database: { status: 'up' },
      kafka: { status: 'degraded' },
      outbox: { status: 'up', pending: 0, deadLetters: 0 },
    });
  });

  it('is not ready while the database is down, but stays live', async () => {
    vi.spyOn(db, 'execute').mockRejectedValueOnce(new Error('Connection terminated'));
    vi.spyOn(app.get(OutboxRelay), 'stats').mockRejectedValueOnce(new Error('Connection terminated'));

    const response = await request(app.getHttpServer()).get('/health/ready').expect(503);

    expect(response.body.error).toMatchObject({
      database: { status: 'down' },
      outbox: { status: 'down', message: 'Outbox stats unavailable' },
    });
    await request(app.getHttpServer()).get('/health/live').expect(200);
  });

  it('reports the outbox degraded while a message sits in dead letters', async () => {
    await db.insert(schema.outboxDeadLetters).values({
      id: 'dead-1',
      seq: 1,
      topic: 'order.placed',
      payload: {},
      headers: {},
      createdAt: new Date(),
      attempts: 10,
      history: [],
      reason: 'exhausted',
      failedAt: new Date(),
    });

    const response = await request(app.getHttpServer()).get('/health/ready').expect(200);

    expect(response.body.details.outbox).toMatchObject({ status: 'degraded', deadLetters: 1 });
  });
});
