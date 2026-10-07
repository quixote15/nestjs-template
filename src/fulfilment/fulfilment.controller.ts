import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post } from '@nestjs/common';
import { WorkflowClient } from '@nestjs/workflows';
import { fulfilmentId, shipmentDelivered } from './order-fulfilment.workflow.js';

@Controller('fulfilments')
export class FulfilmentController {
  constructor(private readonly workflowClient: WorkflowClient) {}

  @Get(':orderId')
  async status(@Param('orderId') orderId: string) {
    const instance = await this.workflowClient.getStatus(fulfilmentId(orderId));
    if (!instance) throw new NotFoundException(`No fulfilment for order ${orderId}`);
    const { status, customStatus, wakeAt, output, error } = instance;
    return { orderId, status, step: customStatus, wakeAt, output, error: error?.message ?? null };
  }

  /** The carrier's delivery webhook. */
  @Post(':orderId/delivered')
  @HttpCode(HttpStatus.ACCEPTED)
  async delivered(@Param('orderId') orderId: string, @Body() body: { trackingNumber?: unknown }) {
    const { trackingNumber } = body;
    if (typeof trackingNumber !== 'string' || !trackingNumber) {
      throw new BadRequestException('trackingNumber is required');
    }
    // Carriers retry webhooks: the signal id makes a repeated one a no-op.
    await this.workflowClient.signal(
      shipmentDelivered,
      { orderId, trackingNumber },
      { key: orderId, id: `delivered:${trackingNumber}` },
    );
    return { accepted: true };
  }
}
