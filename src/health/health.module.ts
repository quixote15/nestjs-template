import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './database.health.js';
import { HealthController } from './health.controller.js';
import { KafkaHealthIndicator } from './kafka.health.js';
import { OutboxHealthIndicator } from './outbox.health.js';

@Module({
  imports: [
    TerminusModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // On SIGTERM, /health/ready answers 503 for this long before the app closes, so the
        // load balancer stops routing to it first. Needs enableShutdownHooks() (main.ts).
        gracefulShutdownTimeoutMs: Number(config.get('HEALTH_SHUTDOWN_DELAY_MS', 0)),
      }),
    }),
  ],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator, KafkaHealthIndicator, OutboxHealthIndicator],
})
export class HealthModule {}
