import { PGlite } from '@electric-sql/pglite';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Outbox, type OutboxEnvelope } from '@nestjs/outbox';
import { Test, type TestingModule } from '@nestjs/testing';
import { ManualWorkflowClock, WORKFLOWS_MODULE_OPTIONS, WorkflowClient, WorkflowWorker } from '@nestjs/workflows';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { of } from 'rxjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { FulfilmentCancellationConsumer } from '../src/fulfilment/fulfilment-cancellation.consumer.js';
import { fulfilmentId, shipmentDelivered } from '../src/fulfilment/order-fulfilment.workflow.js';
import { PaymentsService } from '../src/fulfilment/payments.service.js';
import { KAFKA_CLIENT } from '../src/infra/messaging/kafka.js';
import { MailerService } from '../src/notifications/mailer.service.js';
import type { Order } from '../src/orders/order.js';
import { OrdersService } from '../src/orders/orders.service.js';

describe('Order fulfilment workflow', () => {
  const client = new PGlite();
  const db = drizzle({ client });
  // Time moves only when the test says so: 3 days pass in a line.
  const clock = new ManualWorkflowClock(Date.parse('2026-10-07T12:00:00Z'));
  const payments = {
    charge: vi.fn(async (_order: Order, _key: string) => ({ chargeId: 'ch_1' })),
    refund: vi.fn(async (_chargeId: string, _key: string) => undefined),
  };
  const mailer = { sendOrderConfirmation: vi.fn(), sendReviewRequest: vi.fn() };
  let moduleRef: TestingModule;
  let orders: OrdersService;
  let workflows: WorkflowClient;
  let worker: WorkflowWorker;

  const placeOrder = () =>
    orders.placeOrder({ userId: 'user-42', items: [{ productId: 'salmon-kibble-2kg', quantity: 1 }] });
  const statusOf = (order: Order) => workflows.getStatus(fulfilmentId(order.id));

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
    process.env.OUTBOX_RELAY = 'off';
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDrizzleToken())
      .useValue(db)
      .overrideProvider(KAFKA_CLIENT)
      .useValue({ emit: () => of(undefined) })
      .overrideProvider(PaymentsService)
      .useValue(payments)
      .overrideProvider(MailerService)
      .useValue(mailer)
      // No polling worker: the test runs due instances with drain().
      .overrideProvider(WORKFLOWS_MODULE_OPTIONS)
      .useValue({ clock, worker: { enabled: false } })
      .compile();
    await moduleRef.init();
    orders = moduleRef.get(OrdersService);
    workflows = moduleRef.get(WorkflowClient);
    worker = moduleRef.get(WorkflowWorker);
  });

  beforeEach(() => vi.clearAllMocks());

  afterAll(async () => {
    await moduleRef.close();
    await client.close();
  });

  it('charges, waits for the delivery, then asks for a review a week later', async () => {
    const order = await placeOrder();
    await worker.drain();

    expect(payments.charge).toHaveBeenCalledTimes(1);
    expect(payments.charge).toHaveBeenCalledWith(order, expect.stringContaining('charge-payment'));
    expect(await statusOf(order)).toMatchObject({ status: 'suspended', customStatus: 'awaiting-delivery' });

    await workflows.signal(shipmentDelivered, { orderId: order.id, trackingNumber: 'TRK-1' }, { key: order.id });
    await worker.drain();
    expect(await statusOf(order)).toMatchObject({ status: 'suspended', customStatus: 'awaiting-review-request' });

    clock.advance('6d');
    await worker.drain();
    expect(mailer.sendReviewRequest).not.toHaveBeenCalled();

    clock.advance('1d');
    await worker.drain();
    expect(mailer.sendReviewRequest).toHaveBeenCalledTimes(1);
    expect(await statusOf(order)).toMatchObject({
      status: 'completed',
      output: { chargeId: 'ch_1', trackingNumber: 'TRK-1' },
    });
    expect(payments.charge).toHaveBeenCalledTimes(1); // replays never charge again
    expect(payments.refund).not.toHaveBeenCalled();
  });

  it('refunds when the order is not delivered within 3 days', async () => {
    const order = await placeOrder();
    await worker.drain();

    clock.advance('3d');
    await worker.drain();

    expect(payments.refund).toHaveBeenCalledWith('ch_1', expect.any(String));
    expect(await statusOf(order)).toMatchObject({
      status: 'failed',
      error: expect.objectContaining({ message: `Order ${order.id} wasn't delivered within 3 days` }),
    });
  });

  it('refunds when order.cancelled arrives before the delivery, even twice', async () => {
    const order = await placeOrder();
    await worker.drain();
    const cancelled = await orders.cancelOrder(order.id);

    // What Kafka hands the consumer for order.cancelled, delivered twice.
    const envelope = { id: 'message-1', payload: cancelled } as OutboxEnvelope<Order>;
    const consumer = moduleRef.get(FulfilmentCancellationConsumer);
    await consumer.cancelFulfilment(envelope);
    await worker.drain();
    await consumer.cancelFulfilment(envelope);
    await worker.drain();

    expect(payments.refund).toHaveBeenCalledTimes(1);
    expect(await statusOf(order)).toMatchObject({ status: 'cancelled' });
  });

  it('keeps the charge when the order is cancelled after its delivery', async () => {
    const order = await placeOrder();
    await worker.drain();
    await workflows.signal(shipmentDelivered, { orderId: order.id, trackingNumber: 'TRK-2' }, { key: order.id });
    await worker.drain();

    await moduleRef.get(FulfilmentCancellationConsumer).cancelFulfilment({
      id: 'message-2',
      payload: { ...order, status: 'cancelled' },
    } as OutboxEnvelope<Order>);
    await worker.drain();

    // commit('delivered') dropped the refund: the cancellation only stops the review request.
    expect(payments.refund).not.toHaveBeenCalled();
    expect(await statusOf(order)).toMatchObject({ status: 'cancelled' });
  });

  it('starts no fulfilment when the order rolls back', async () => {
    const outbox = moduleRef.get(Outbox);
    vi.spyOn(outbox, 'add').mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));

    await expect(placeOrder()).rejects.toThrow('Connection terminated unexpectedly');
    await worker.drain();

    expect(payments.charge).not.toHaveBeenCalled();
  });

  it('ignores order.cancelled for an order that has no fulfilment', async () => {
    await expect(
      moduleRef.get(FulfilmentCancellationConsumer).cancelFulfilment({
        id: 'message-3',
        payload: { id: 'order-from-before-workflows' },
      } as OutboxEnvelope<Order>),
    ).resolves.toBeUndefined();
  });
});
