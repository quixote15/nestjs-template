import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './database.health.js';
import { KafkaHealthIndicator } from './kafka.health.js';
import { OutboxHealthIndicator } from './outbox.health.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    private readonly kafka: KafkaHealthIndicator,
    private readonly outbox: OutboxHealthIndicator,
  ) {}

  /** Liveness: the process answers. No dependencies, or a database outage would restart every pod. */
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  /**
   * Readiness: 503 only when the database is down, since no request can succeed without it.
   * Kafka and the outbox report degraded (200). 503 too while shutting down.
   */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.database.pingCheck('database'),
      () => this.kafka.pingCheck('kafka'),
      () => this.outbox.check('outbox'),
    ]);
  }
}
