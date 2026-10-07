import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import type { OutboxEnvelope } from '@nestjs/outbox';
import { WorkflowClient, WorkflowNotFoundError } from '@nestjs/workflows';
import type { Order } from '../orders/order.js';
import { fulfilmentId } from './order-fulfilment.workflow.js';

@Controller()
export class FulfilmentCancellationConsumer {
  constructor(private readonly workflowClient: WorkflowClient) {}

  /**
   * Redeliveries need no inbox: cancelling an instance that is already cancelled, or that
   * completed first, isn't accepted and changes nothing.
   */
  @EventPattern('order.cancelled')
  async cancelFulfilment(@Payload() envelope: OutboxEnvelope<Order>) {
    try {
      await this.workflowClient.cancel(fulfilmentId(envelope.payload.id), 'Order cancelled');
    } catch (error) {
      // Orders placed before fulfilment workflows existed have none: throwing would redeliver forever.
      if (error instanceof WorkflowNotFoundError) return;
      throw error;
    }
  }
}
