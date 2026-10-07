import { PGlite } from '@electric-sql/pglite';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Outbox, OutboxRelay, type OutboxEnvelope } from '@nestjs/outbox';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { of } from 'rxjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { KAFKA_CLIENT } from '../src/infra/messaging/kafka.js';
import * as schema from '../src/infra/schemas/schema.js';
import { StockReservationConsumer } from '../src/inventory/stock-reservation.consumer.js';
import { MailerService } from '../src/notifications/mailer.service.js';
import { OrderEmailsConsumer } from '../src/notifications/order-emails.consumer.js';
import type { Order } from '../src/orders/order.js';
import { OrdersService } from '../src/orders/orders.service.js';

type KafkaRecord = { key?: string; value: OutboxEnvelope; headers: Record<string, string> };

describe('Orders through Kafka (outbox)', () => {
  const client = new PGlite(); // PostgreSQL, in-process
  const db = drizzle({ client });
  const mailer = { sendOrderConfirmation: vi.fn() };
  // Stands in for the broker: records what the relay publishes.
  const kafka = { emit: vi.fn((_topic: string, _record: KafkaRecord) => of(undefined)) };
  let moduleRef: TestingModule;
  let orders: OrdersService;
  let relay: OutboxRelay;

  /** What the relay published to `topic`, in order. */
  const published = (topic: string) =>
    kafka.emit.mock.calls.filter(([emitted]) => emitted === topic).map(([, record]) => record);

  /** Hands each `order.placed` record to this service's consumers, as the Kafka server would. */
  const deliverOrderPlaced = async (records: KafkaRecord[]) => {
    for (const { value } of records) {
      const envelope = value as OutboxEnvelope<Order>;
      await Promise.all([
        moduleRef.get(OrderEmailsConsumer).sendConfirmation(envelope),
        moduleRef.get(StockReservationConsumer).reserve(envelope),
      ]);
    }
  };

  const stockOf = async (productId: string) => {
    const [product] = await db.select().from(schema.products).where(eq(schema.products.id, productId));
    return product;
  };

  beforeAll(async () => {
    // The real migrations, the outbox's tables and the product seed included.
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
    process.env.OUTBOX_RELAY = 'off'; // no poll loop: the test drives the relay
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDrizzleToken())
      .useValue(db) // DrizzleOutboxStore injects it too
      .overrideProvider(MailerService)
      .useValue(mailer)
      .overrideProvider(KAFKA_CLIENT)
      .useValue(kafka)
      .compile();
    await moduleRef.init();
    orders = moduleRef.get(OrdersService);
    relay = moduleRef.get(OutboxRelay);
  });

  beforeEach(() => {
    kafka.emit.mockClear();
    mailer.sendOrderConfirmation.mockClear();
  });

  afterAll(async () => {
    await moduleRef.close();
    await client.close();
  });

  it('publishes order.placed to Kafka only after the order commits, keyed by order', async () => {
    const order = await orders.placeOrder({ userId: 'user-42', items: [{ productId: 'salmon-kibble-2kg', quantity: 1 }] });
    expect(kafka.emit).not.toHaveBeenCalled();

    await relay.runOnce(); // claim and publish one batch

    expect(published('order.placed')).toEqual([
      {
        key: order.id,
        value: expect.objectContaining({ topic: 'order.placed', payload: order }),
        headers: expect.objectContaining({ 'outbox-message-id': expect.any(String) }),
      },
    ]);
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

  it('emails and reserves stock once, however many times Kafka redelivers', async () => {
    const before = await stockOf('salmon-kibble-2kg');
    await orders.placeOrder({ userId: 'user-42', items: [{ productId: 'salmon-kibble-2kg', quantity: 2 }] });
    await relay.runOnce();

    const records = published('order.placed');
    await deliverOrderPlaced(records);
    await deliverOrderPlaced(records); // a redelivery: a crash before the offset commit

    expect(mailer.sendOrderConfirmation).toHaveBeenCalledTimes(1);
    expect(await stockOf('salmon-kibble-2kg')).toMatchObject({
      inStock: before!.inStock - 2,
      reserved: before!.reserved + 2,
    });
  });

  it('reserves nothing and publishes order.stock-rejected when a line is short', async () => {
    const kibbleBefore = await stockOf('salmon-kibble-2kg');
    // The seed has one litter in stock; the kibble line is reserved first, then rolled back.
    const order = await orders.placeOrder({
      userId: 'user-7',
      items: [
        { productId: 'salmon-kibble-2kg', quantity: 1 },
        { productId: 'clumping-litter-10l', quantity: 2 },
      ],
    });
    await relay.runOnce();
    await deliverOrderPlaced(published('order.placed'));
    await relay.runOnce(); // publishes what the consumer added to the outbox

    expect(await stockOf('salmon-kibble-2kg')).toMatchObject({ inStock: kibbleBefore!.inStock });
    expect(await stockOf('clumping-litter-10l')).toMatchObject({ inStock: 1, reserved: 0 });
    expect(published('order.stock-rejected')).toEqual([
      expect.objectContaining({
        key: order.id,
        value: expect.objectContaining({ payload: { orderId: order.id, productId: 'clumping-litter-10l' } }),
      }),
    ]);
    expect(mailer.sendOrderConfirmation).toHaveBeenCalledTimes(1); // the order was still placed
  });

  it('publishes a cancellation behind the placement of the same order', async () => {
    const order = await orders.placeOrder({ userId: 'user-42', items: [{ productId: 'salmon-kibble-2kg', quantity: 1 }] });
    await orders.cancelOrder(order.id);
    await expect(orders.cancelOrder(order.id)).rejects.toThrow(`Order ${order.id} is cancelled`);

    await relay.runOnce();

    expect(kafka.emit.mock.calls.map(([topic, record]) => [topic, record.key])).toEqual([
      ['order.placed', order.id],
      ['order.cancelled', order.id],
    ]);
  });
});
