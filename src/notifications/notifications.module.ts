import { Module } from '@nestjs/common';
import { MailerService } from './mailer.service.js';
import { OrderEmailsHandler } from './order-emails.handler.js';

@Module({
  providers: [MailerService, OrderEmailsHandler],
})
export class NotificationsModule {}
