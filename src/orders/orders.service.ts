import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Outbox } from '@nestjs/outbox';
import { WorkflowClient } from '@nestjs/workflows';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../infra/database/drizzle.js';
import { UnitOfWork } from '../infra/database/unit-of-work.js';
import { orders, products } from '../infra/schemas/schema.js';
import { fulfilmentId, OrderFulfilmentWorkflow } from '../fulfilment/order-fulfilment.workflow.js';
import type { Order, PlaceOrderDto } from './order.js';

@Injectable()
export class OrdersService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly outbox: Outbox<Transaction>,
    private readonly workflowClient: WorkflowClient,
  ) {}

  async placeOrder({ userId, items }: PlaceOrderDto): Promise<Order> {
    if (!items?.length) throw new BadRequestException('An order needs at least one item');

    const order = await this.unitOfWork.run(async (tx) => {
      const ids = items.map((item) => item.productId);
      const prices = await tx.select().from(products).where(inArray(products.id, ids));
      const lines = items.map(({ productId, quantity }) => {
        const product = prices.find((row) => row.id === productId);
        if (!product) throw new BadRequestException(`Unknown product "${productId}"`);
        if (!Number.isInteger(quantity) || quantity < 1) {
          throw new BadRequestException(`Invalid quantity for "${productId}"`);
        }
        return { productId, quantity, price: product.price };
      });
      const order: Order = {
        id: randomUUID(),
        userId,
        items: lines,
        total: lines.reduce((sum, line) => sum + line.price * line.quantity, 0),
        status: 'placed',
      };
      await tx.insert(orders).values(order);

      // Drizzle's tx: the messages commit or roll back with the order.
      await this.outbox.add(tx, [
        // Keyed by order: its events share a Kafka partition, so its cancellation comes after it.
        { topic: 'order.placed', key: order.id, payload: order },
      ]);
      // Same transaction again: no order without its fulfilment, and no fulfilment for a rolled-back order.
      await this.workflowClient.start(OrderFulfilmentWorkflow, order, { id: fulfilmentId(order.id), transaction: tx });
      return order;
    });

    return order;
  }

  async cancelOrder(id: string): Promise<Order> {
    const order = await this.unitOfWork.run(async (tx) => {
      const [row] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
      if (!row) throw new NotFoundException(`Order ${id} not found`);
      if (row.status !== 'placed') throw new ConflictException(`Order ${id} is ${row.status}`);

      await tx.update(orders).set({ status: 'cancelled' }).where(eq(orders.id, id));
      const order: Order = { ...row, status: 'cancelled' };
      await this.outbox.add(tx, { topic: 'order.cancelled', key: order.id, payload: order });
      return order;
    });

    return order;
  }
}
