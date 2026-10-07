import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Outbox } from '@nestjs/outbox';
import type { Database, Transaction } from './drizzle.js';

/** Runs `work` in a transaction; once it commits, the relay publishes its outbox messages. */
@Injectable()
export class UnitOfWork {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly outbox: Outbox<Transaction>,
  ) {}

  async run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const result = await this.db.transaction(work);
    // After the commit, or the poll wouldn't see the rows. Without it they wait for the next poll.
    this.outbox.notify();
    return result;
  }
}
