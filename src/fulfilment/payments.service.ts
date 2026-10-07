import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Order } from '../orders/order.js';

/** Stand-in for your payment provider's SDK. Both calls take an idempotency key, as real providers do. */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  async charge(order: Order, idempotencyKey: string): Promise<{ chargeId: string }> {
    const chargeId = `ch_${randomUUID()}`;
    this.logger.log(`Charged ${order.total} cents for order ${order.id} (${chargeId}, key ${idempotencyKey})`);
    return { chargeId };
  }

  async refund(chargeId: string, idempotencyKey: string): Promise<void> {
    this.logger.log(`Refunded ${chargeId} (key ${idempotencyKey})`);
  }
}
