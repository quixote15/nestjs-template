import { Workflow, WorkflowSignal, type WorkflowContext, type WorkflowRunner } from '@nestjs/workflows';
import { MailerService } from '../notifications/mailer.service.js';
import type { Order } from '../orders/order.js';
import { PaymentsService } from './payments.service.js';

export interface ShipmentDelivered {
  orderId: string;
  trackingNumber: string;
}

/** Sent by the carrier webhook (FulfilmentController), keyed by order id. */
export const shipmentDelivered = new WorkflowSignal<ShipmentDelivered>('shipment.delivered');

export interface FulfilmentResult {
  chargeId: string;
  trackingNumber: string;
}

/** One fulfilment per order: starting it twice for the same order is a no-op. */
export const fulfilmentId = (orderId: string) => `fulfilment:${orderId}`;

/**
 * An order from payment to review request, over days: every step is journaled, so a restart
 * resumes where it stopped instead of charging again. Keep run() deterministic: side effects
 * only inside ctx.step(), time only through ctx.
 */
@Workflow('order-fulfilment', { version: 1, timeout: '30d' })
export class OrderFulfilmentWorkflow implements WorkflowRunner<Order, FulfilmentResult> {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly mailerService: MailerService,
  ) {}

  async run(ctx: WorkflowContext, order: Order): Promise<FulfilmentResult> {
    const { chargeId } = await ctx.step(
      'charge-payment',
      ({ idempotencyKey }) => this.paymentsService.charge(order, idempotencyKey),
      {
        retry: { attempts: 5, backoff: { delay: '2s' } },
        // Runs if the workflow fails or is cancelled before commit('delivered').
        compensate: ({ chargeId }, { idempotencyKey }) => this.paymentsService.refund(chargeId, idempotencyKey),
      },
    );

    ctx.setStatus('awaiting-delivery');
    const delivery = await ctx.waitForSignal('await-delivery', shipmentDelivered, { key: order.id, timeout: '3d' });
    // Failing runs the compensations: the customer gets their money back.
    if (!delivery) ctx.fail(`Order ${order.id} wasn't delivered within 3 days`);
    // Point of no return: a cancellation from here on no longer refunds a delivered order.
    ctx.commit('delivered');

    ctx.setStatus('awaiting-review-request');
    await ctx.sleep('before-review-request', '7d');
    await ctx.step('send-review-request', ({ idempotencyKey }) =>
      this.mailerService.sendReviewRequest(order, idempotencyKey),
    );

    ctx.setStatus('done');
    return { chargeId, trackingNumber: delivery.trackingNumber };
  }
}
