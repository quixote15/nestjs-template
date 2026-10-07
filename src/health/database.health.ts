import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { HealthIndicatorService } from '@nestjs/terminus';
import { sql } from 'drizzle-orm';
import type { Database } from '../infra/database/drizzle.js';

/** Terminus has no Drizzle indicator: a `SELECT 1` through the app's own pool. */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  pingCheck(key: string) {
    return this.healthIndicatorService
      .check(key)
      .attempt(async () => {
        await this.db.execute(sql`SELECT 1`);
      })
      .withTimeout(1000);
  }
}
