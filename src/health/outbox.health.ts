import { Injectable } from '@nestjs/common';
import { OutboxRelay } from '@nestjs/outbox';
import { HealthIndicatorService } from '@nestjs/terminus';

/** Above this, the relay is stuck or far behind (it polls every second). */
const MAX_LAG_MS = 60_000;

@Injectable()
export class OutboxHealthIndicator {
  constructor(
    private readonly relay: OutboxRelay,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  /**
   * Degraded when messages wait too long or sit in dead letters. Either needs a human, but
   * the API still works: new messages are safe in the database.
   */
  async check(key: string) {
    const session = this.healthIndicatorService.check(key);
    try {
      const { pending, lagMs, deadLetters } = await this.relay.stats();
      const details = { pending, lagMs, deadLetters };
      return lagMs > MAX_LAG_MS || deadLetters > 0 ? session.degraded(details) : session.up(details);
    } catch {
      // The stats live in the database: a thrown error here would escape Terminus as a 500.
      return session.down({ message: 'Outbox stats unavailable' });
    }
  }
}
