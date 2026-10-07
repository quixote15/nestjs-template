import { Module } from '@nestjs/common';
import { MailerService } from './mailer.service.js';
import { OrderEmailsConsumer } from './order-emails.consumer.js';

@Module({
  controllers: [OrderEmailsConsumer],
  providers: [MailerService],
})
export class NotificationsModule {}
