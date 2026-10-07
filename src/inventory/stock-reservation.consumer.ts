import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { Outbox, OutboxInbox, type OutboxEnvelope } from '@nestjs/outbox';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Transaction } from '../infra/database/drizzle.js';
import { UnitOfWork } from '../infra/database/unit-of-work.js';
import { products } from '../infra/schemas/schema.js';
import type { Order } from '../orders/order.js';

class OutOfStockError extends Error {
  constructor(readonly productId: string) {
    super(`Not enough stock for "${productId}"`);
  }
}

@Controller()
export class StockReservationConsumer {
  private readonly logger = new Logger(StockReservationConsumer.name);

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly inbox: OutboxInbox,
    private readonly outbox: Outbox<Transaction>,
  ) {}

  @EventPattern('order.placed')
  async reserve(@Payload() envelope: OutboxEnvelope<Order>) {
    const order = envelope.payload;
    await this.unitOfWork.run(async (tx) => {
      // Records the message id through tx, then runs the callback only if this consumer
      // hasn't processed it yet. Await it: the record commits with the reservation.
      await this.inbox.processInTransaction(tx, 'stock-reservation', envelope.id, async () => {
        const missingProductId = await this.reserveAllOrNothing(tx, order);
        if (!missingProductId) {
          this.logger.log(`Reserved stock for order ${order.id}`);
          return;
        }
        // Redelivering won't create stock, and throwing would block the partition:
        // publish the outcome instead, for whoever restocks or cancels the order.
        this.logger.warn(`Not enough stock for "${missingProductId}" (order ${order.id})`);
        await this.outbox.add(tx, {
          topic: 'order.stock-rejected',
          key: order.id,
          payload: { orderId: order.id, productId: missingProductId },
        });
      });
    });
  }

  /** Reserves every line or none of them; returns the first product short of stock. */
  private async reserveAllOrNothing(tx: Transaction, order: Order): Promise<string | undefined> {
    try {
      // A savepoint: a short line rolls back the lines reserved before it, not the inbox record.
      await tx.transaction(async (savepoint) => {
        for (const { productId, quantity } of order.items) {
          const reserved = await savepoint
            .update(products)
            .set({ inStock: sql`${products.inStock} - ${quantity}`, reserved: sql`${products.reserved} + ${quantity}` })
            .where(and(eq(products.id, productId), gte(products.inStock, quantity)))
            .returning({ id: products.id });
          if (reserved.length === 0) throw new OutOfStockError(productId);
        }
      });
      return undefined;
    } catch (error) {
      if (error instanceof OutOfStockError) return error.productId;
      throw error;
    }
  }
}
