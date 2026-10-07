import { Module } from '@nestjs/common';
import { UnitOfWork } from '../infra/database/unit-of-work.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, UnitOfWork],
})
export class OrdersModule {}
