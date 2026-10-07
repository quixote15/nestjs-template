import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { OutboxInbox, type OutboxEnvelope } from '@nestjs/outbox';
import type { Order } from '../orders/order.js';
import { MailerService } from './mailer.service.js';

@Controller()
export class OrderEmailsConsumer {
  constructor(
    private readonly mailerService: MailerService,
    private readonly inbox: OutboxInbox,
  ) {}

  @EventPattern('order.placed')
  async sendConfirmation(@Payload() envelope: OutboxEnvelope<Order>) {
    // Skips redeliveries. The email lives outside our database, so a crash between the send
    // and the inbox record can still send it twice: the provider's idempotency key covers that.
    await this.inbox.process('order-confirmation-email', envelope.id, () =>
      this.mailerService.sendOrderConfirmation(envelope.payload),
    );
  }
}
