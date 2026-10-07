import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { FulfilmentCancellationConsumer } from './fulfilment-cancellation.consumer.js';
import { FulfilmentController } from './fulfilment.controller.js';
import { OrderFulfilmentWorkflow } from './order-fulfilment.workflow.js';
import { PaymentsService } from './payments.service.js';

@Module({
  imports: [NotificationsModule],
  controllers: [FulfilmentController, FulfilmentCancellationConsumer],
  providers: [OrderFulfilmentWorkflow, PaymentsService],
})
export class FulfilmentModule {}
