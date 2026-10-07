import { Module } from '@nestjs/common';
import { UnitOfWork } from '../infra/database/unit-of-work.js';
import { StockReservationConsumer } from './stock-reservation.consumer.js';

@Module({
  controllers: [StockReservationConsumer],
  providers: [UnitOfWork],
})
export class InventoryModule {}
