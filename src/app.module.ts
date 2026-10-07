import { Module } from '@nestjs/common';
import { DrizzleModule } from '@nestjs/drizzle';
import { OutboxModule } from '@nestjs/outbox';
import { drizzle } from 'drizzle-orm/node-postgres';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DrizzleOutboxStore } from './infra/database/drizzle-outbox.store.js';
import { KafkaClientModule, KafkaOutboxTransport } from './infra/messaging/kafka.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { OutboxAdminModule } from './outbox-admin/outbox-admin.module.js';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({isGlobal: true}),
    DrizzleModule.forRootAsync({
      // A pg pool on DATABASE_URL, closed in onApplicationShutdown(), after the relay drained.
      useFactory: () => ({ drizzle, connection: process.env.DATABASE_URL! }),
    }),
    OutboxModule.forRootAsync({
      imports: [KafkaClientModule],
      transports: { kafka: KafkaOutboxTransport },
      useFactory: () => ({
        // Every event goes through Kafka, consumers in this service included (@EventPattern()).
        route: () => 'kafka',
        relay: {
          enabled: process.env.OUTBOX_RELAY !== 'off',
          pollInterval: '1s',
          lease: '30s',
          publishTimeout: '10s',
        },
        retry: {
          attempts: 10,
          backoff: { delay: '1s', maxDelay: '1m' },
        },
      }),
    }),

    OrdersModule,
    NotificationsModule,
    InventoryModule,
    OutboxAdminModule,
  ],
  controllers: [AppController],
  // DrizzleOutboxStore registers itself as the outbox's store.
  providers: [AppService, DrizzleOutboxStore],
})
export class AppModule {}
