import { PGlite } from '@electric-sql/pglite';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Outbox, OutboxDeadLetters, OutboxRelay } from '@nestjs/outbox';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { of } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ANALYTICS_SERVICE, AppModule } from '../src/app.module.js';
import * as schema from '../src/infra/schemas/schema.js';
import { MailerService } from '../src/notifications/mailer.service.js';
import { OrdersService } from '../src/orders/orders.service.js';

describe('OrdersService (outbox)', () => {
  const client = new PGlite(); // PostgreSQL, in-process
  const db = drizzle({ client });
  const mailer = { sendOrderConfirmation: vi.fn() };
  const analytics = { emit: vi.fn((_topic: string, _envelope: unknown) => of(undefined)) };
  let moduleRef: TestingModule;
  let orders: OrdersService;
  let relay: OutboxRelay;

  beforeAll(async () => {
    // The real migrations, the outbox's tables and the product seed included.
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
    process.env.OUTBOX_RELAY = 'off'; // no poll loop: the test drives the relay
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDrizzleToken())
      .useValue(db) // DrizzleOutboxStore injects it too
      .overrideProvider(MailerService)
      .useValue(mailer)
      .overrideProvider(ANALYTICS_SERVICE)
      .useValue(analytics)
      .compile();
    await moduleRef.init();
    orders = moduleRef.get(OrdersService);
    relay = moduleRef.get(OutboxRelay);
  });

  afterAll(async () => {
    await moduleRef.close();
    await client.close();
  });

  it('publishes order events only after the order commits', async () => {
    const order = await orders.placeOrder({ userId: 'user-42', items: [{ productId: 'salmon-kibble-2kg', quantity: 1 }] });
    expect(mailer.sendOrderConfirmation).not.toHaveBeenCalled();

    await relay.runOnce(); // claim and publish one batch

    expect(mailer.sendOrderConfirmation).toHaveBeenCalledWith(order);
    expect(analytics.emit).toHaveBeenCalledWith(
      'analytics.order.placed',
      expect.objectContaining({ key: order.id, payload: order }),
    );
    expect(await relay.stats()).toMatchObject({ pending: 0, deadLetters: 0 });
  });

  it('publishes nothing when the transaction rolls back', async () => {
    const outbox = moduleRef.get(Outbox);
    const add = outbox.add.bind(outbox);
    vi.spyOn(outbox, 'add').mockImplementationOnce(async (tx, messages) => {
      await add(tx, messages); // the messages are written...
      throw new Error('Connection terminated unexpectedly'); // ...then the transaction fails
    });

    await expect(
      orders.placeOrder({ userId: 'user-42', items: [{ productId: 'salmon-kibble-2kg', quantity: 1 }] }),
    ).rejects.toThrow('Connection terminated unexpectedly');

    expect(await relay.stats()).toMatchObject({ pending: 0 });
    expect(await relay.runOnce()).toMatchObject({ claimed: 0 });
  });

  it('dead-letters a reservation without stock, and requeues it without a second email', async () => {
    mailer.sendOrderConfirmation.mockClear();
    const order = await orders.placeOrder({ userId: 'user-7', items: [{ productId: 'clumping-litter-10l', quantity: 2 }] });
    await relay.runOnce();

    expect(mailer.sendOrderConfirmation).toHaveBeenCalledTimes(1);
    const deadLetters = moduleRef.get(OutboxDeadLetters);
    const [dead] = await deadLetters.list({ topic: 'order.placed' });
    expect(dead).toMatchObject({ reason: 'rejected', payload: { id: order.id } });

    await db.update(schema.products).set({ inStock: 5 }).where(eq(schema.products.id, 'clumping-litter-10l'));
    expect(await deadLetters.requeue(dead!.id)).toBe(1);
    await relay.runOnce();

    const [litter] = await db.select().from(schema.products).where(eq(schema.products.id, 'clumping-litter-10l'));
    expect(litter).toMatchObject({ inStock: 3, reserved: 2 });
    expect(mailer.sendOrderConfirmation).toHaveBeenCalledTimes(1); // the email inbox skipped it
    expect(await relay.stats()).toMatchObject({ pending: 0, deadLetters: 0 });
  });

  it('publishes a cancellation behind the placement of the same order', async () => {
    analytics.emit.mockClear();
    const order = await orders.placeOrder({ userId: 'user-42', items: [{ productId: 'salmon-kibble-2kg', quantity: 1 }] });
    await orders.cancelOrder(order.id);
    await expect(orders.cancelOrder(order.id)).rejects.toThrow(`Order ${order.id} is cancelled`);

    await relay.runOnce();

    expect(analytics.emit.mock.calls.map(([topic]) => topic)).toEqual([
      'analytics.order.placed',
      'analytics.order.cancelled',
    ]);
  });
});
