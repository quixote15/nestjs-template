import { Module } from '@nestjs/common';
import { DrizzleModule, getDrizzleToken } from '@nestjs/drizzle';
import { OutboxModule } from '@nestjs/outbox';
import { WorkflowsModule, WorkflowStorage } from '@nestjs/workflows';
import { fromDrizzle, PostgresWorkflowStore } from '@nestjs/workflows/postgres';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { createDatabase, type Database } from './infra/database/drizzle.js';
import { DrizzleOutboxStore } from './infra/database/drizzle-outbox.store.js';
import { KafkaClientModule, KafkaOutboxTransport } from './infra/messaging/kafka.js';
import { AuthModule } from './auth/auth.module.js';
import { FulfilmentModule } from './fulfilment/fulfilment.module.js';
import { HealthModule } from './health/health.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { OutboxAdminModule } from './outbox-admin/outbox-admin.module.js';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ObserveModule } from './observe.js';

@Module({
  imports: [
    ConfigModule.forRoot({isGlobal: true}),
    // After ConfigModule.forRoot(): it loads .env into process.env synchronously, before this line is evaluated.
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY!,
      appSecret: process.env.OBSERVE_APP_SECRET!,
      serviceId: 'interview-application',
    }),
    DrizzleModule.forRootAsync({
      useFactory: () => ({ db: createDatabase(process.env.DATABASE_URL!) }),
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
    WorkflowsModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // WORKFLOW_WORKER=off: an API-only instance starts and signals workflows, never runs them.
        worker:
          config.get('WORKFLOW_WORKER') === 'off'
            ? false
            : { concurrency: 10, leaseDuration: '30s', shutdownTimeout: '10s' },
      }),
    }),

    AuthModule,
    OrdersModule,
    NotificationsModule,
    InventoryModule,
    OutboxAdminModule,
    HealthModule,
    FulfilmentModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // DrizzleOutboxStore registers itself as the outbox's store.
    DrizzleOutboxStore,
    {
      provide: PostgresWorkflowStore,
      inject: [getDrizzleToken(), WorkflowStorage],
      // Its schema (nest_workflows) comes from a drizzle migration, PostgresWorkflowStore.migrationSql(),
      // applied by db:migrate like every other table: no DDL at startup.
      useFactory: (db: Database, storage: WorkflowStorage) =>
        new PostgresWorkflowStore({ executor: fromDrizzle(db), migrate: false }, storage),
    },
  ],
})
export class AppModule {}
