# AGENTS.md

NestJS 12 + PostgreSQL + Drizzle ORM. Orders API with a transactional outbox (`@nestjs/outbox`) and in-process consumers.
ESM (`module: nodenext`), strict TypeScript, vitest, oxlint, prettier.

The bar: every design decision should be explainable in 30 seconds. Correctness → simplicity → reliability → testability → maintainability → performance (when measured).

## Commands

```bash
docker compose up -d && cp .env.example .env && set -a && . ./.env && set +a
npm run db:migrate              # apply drizzle/ migrations
npx drizzle-kit generate        # after editing src/infra/schemas/schema.ts
npm run start:dev
npm test                        # unit: **/*.spec.ts
npm run test:e2e                # e2e: test/*.e2e-spec.ts (PGlite in-process, no Docker needed)
npm run lint
npx tsc --noEmit -p tsconfig.json
```

Before finishing a change, run the relevant tests, `npm run lint`, and the type-check.

## Layout

```text
src/
  <feature>/                    orders/, inventory/, notifications/, outbox-admin/
    <feature>.module.ts
    <feature>.controller.ts     HTTP entry point (thin)
    <feature>.service.ts        business operations (transaction scripts)
    <name>.handler.ts           outbox message consumers
    <type>.ts                   feature types and request DTOs
  infra/
    database/                   Drizzle types, UnitOfWork, DrizzleOutboxStore
    schemas/schema.ts           every table; migrations are generated from it
drizzle/                        generated SQL migrations (never edit applied ones)
test/                           e2e tests against the real AppModule and migrations
```

Keep features flat. Add a subfolder (`dto/`, `application/`) only once a feature has enough files that a flat list gets hard to scan. Put unit specs next to the file they test (`orders.service.spec.ts`).

## Business operations: Transaction Script

- One public service method = one business operation (`placeOrder`, `cancelOrder`). It reads top to bottom: validate → load → decide → persist → enqueue side effects → return.
- Group related operations of a feature in one `<Feature>Service`. Split one out into its own class (`RefundPayment`) only when it grows its own dependencies or when the service is mixing unrelated workflows.
- No repositories, aggregates, value objects, CQRS, mediators, `Base*`/`Generic*` classes, or use-case interfaces. Query Drizzle directly inside the transaction. Extract a function only for logic that is reused or that needs its own tests (e.g., pricing rules).
- Controllers parse input, call one service method, and return its result. No workflow logic in controllers or message handlers.

## Transactions

- Use `UnitOfWork.run(async (tx) => …)` for any operation with more than one write, or with a read that a later write depends on. Pass `tx` down explicitly, and never mix `this.db` with `tx` inside one operation.
- `UnitOfWork.run` also wakes the outbox relay after commit. Don't call `db.transaction` directly in request paths; inside outbox handlers it's fine, as `StockReservationHandler` shows.
- For a read-check-write race, use `SELECT … FOR UPDATE` (see `cancelOrder`), a conditional `UPDATE … WHERE` (see stock reservation), or a unique constraint. Name the race in a comment.
- Enforce invariants in the database too: `NOT NULL`, FKs, unique constraints, checks. Model the column in `schema.ts`, then run `drizzle-kit generate`.

## Outbox and messaging

- Use the outbox only when committed state must reliably produce an async side effect (email, stock reservation, an event for another service). Call `this.outbox.add(tx, …)` inside the same `UnitOfWork.run` as the state change. Plain synchronous code needs no outbox.
- Topics are `<entity>.<past-tense-verb>` (`order.placed`). Set `key` to the entity id when per-entity ordering matters.
- Consumers: `@OnOutboxMessage(topic, { consumer: '<unique-name>' })`. Delivery is at-least-once, so:
  - if the handler writes to the DB, wrap the writes in `ctx.processInTransaction(tx, …)` so the inbox record commits with them;
  - if the handler calls an external API, pass the message id as the provider's idempotency key, or make the call safe to repeat;
  - throw `NonRetryableMessageError` for deterministic failures (bad data, business rule). Those go straight to dead letters; transient errors retry with backoff (`app.module.ts`).
- Keep handlers short. Once a handler holds more than a few lines of business logic, move that logic into a service method and call it.
- Don't add Kafka, RabbitMQ or SQS unless the task requires a cross-service broker. Routing lives in `OutboxModule`'s `route`.

## Errors

- Validation problems → `BadRequestException`; missing → `NotFoundException`; state conflict → `ConflictException`. Services throw Nest's built-in exceptions directly, which is the current convention. Introduce domain error classes and an exception filter only when a non-HTTP caller needs to tell those errors apart.
- Never return raw DB or driver errors. Don't catch an error just to rethrow it unchanged.

## Input, config, security

- Treat HTTP bodies, params, message payloads and external responses as untrusted. Validate at the boundary. If you add `class-validator` and a global `ValidationPipe`, remove the hand-written shape checks they replace.
- Read configuration through `ConfigService` / `forRootAsync` factories, never with `process.env` in business code. Every new variable goes into `.env.example`.
- Never log secrets, tokens or personal data. Log entity ids (order id, message id, consumer).

## Resilience

Use what Nest and `@nestjs/outbox` already provide before writing anything custom: `enableShutdownHooks` (already on), outbox retry/backoff/lease, `@nestjs/terminus` for health checks (app + DB) and `@nestjs/throttler` for rate limiting. Add a timeout, retry or circuit breaker only for a named failure mode. Never retry validation errors or business failures.

Add idempotency (an `Idempotency-Key` header plus a unique constraint storing the result) to non-read endpoints where a client retry would duplicate a side effect, such as creating payments or charges. Read endpoints don't need it.

## TypeScript and style

- `strict` stays on. Use `unknown` instead of `any`. Annotate return types on public service methods. Model state with literal unions (`'placed' | 'cancelled'`).
- Relative imports use the `.js` suffix (ESM). Money is integer cents. Ids are `randomUUID()` strings.
- Guard clauses over nesting. Names must be specific enough to grep (`StockReservationHandler`, not `Handler`).
- Comments explain *why*: invariants, locks, ordering, external limits. Keep the existing ones when refactoring.

## Tests

- Every business rule and bug fix gets a test that checks behavior: returned values, DB rows, published messages.
- E2E: build `AppModule` with `Test.createTestingModule`, override the Drizzle token with PGlite plus the real migrations, set `OUTBOX_RELAY=off`, and drive `OutboxRelay` by hand. Override external services (`MailerService`) with `vi.fn()` fakes.
- Unit-test pure logic without Nest. Don't mock Drizzle query builders; use PGlite instead.

## Working rules for agents

- Read the feature you are touching and search (`rg`) for existing helpers before adding new ones. Mirror `orders/` for new features.
- Keep diffs small and on-task. No drive-by refactors, no new dependencies or patterns without a stated reason.
- Before adding an abstraction, answer: what concrete problem does it solve, and is there a simpler way? If you can't answer, don't add it.
- Preserve behavior unless asked to change it. Mention non-obvious architectural choices in one line.

## Done means

Logic sits in a service method; the controller is thin; multi-write operations use `UnitOfWork`; outbox only where async reliability is needed; consumers are idempotent; errors map to the right status; tests cover the behavior; lint, type-check and tests pass; no unused abstraction was added.
