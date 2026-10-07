import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transport, type KafkaOptions } from '@nestjs/microservices';
import { HealthIndicatorService, MicroserviceHealthIndicator } from '@nestjs/terminus';
import { kafkaClientConfig } from '../infra/messaging/kafka.js';

@Injectable()
export class KafkaHealthIndicator {
  constructor(
    private readonly microservice: MicroserviceHealthIndicator,
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Degraded, not down, when the broker is unreachable: orders still commit with their
   * outbox messages, and the relay publishes them once Kafka is back. Taking the instance
   * out of the load balancer would turn a delay into failed requests.
   */
  async pingCheck(key: string) {
    const session = this.healthIndicatorService.check(key);
    const result = await this.microservice
      .pingCheck<KafkaOptions>(key, {
        transport: Transport.KAFKA,
        // kafkajs retries the connection on its own; the probe has to fail within its timeout.
        options: { client: { ...kafkaClientConfig(this.config), retry: { retries: 0 } } },
        timeout: 2000,
      })
      // Each probe opens and closes a connection: don't do it on every poll.
      .cacheFor(10_000);
    const outcome = result[key];
    return outcome?.status === 'down' ? session.degraded({ message: outcome.message }) : result;
  }
}
