# AGENTS.md

NestJS 12 + PostgreSQL + Drizzle ORM. A template of reliability building blocks, shown on an orders domain: transactional outbox (`@nestjs/outbox`) publishing to Kafka, idempotent Kafka consumers, durable workflows (`@nestjs/workflows`) and health checks (`@nestjs/terminus`).
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
npm run test:arch               # architecture guardrails (tsarch)
npm run lint                    # oxlint + eslint (eslint holds the architecture rules)
npx tsc --noEmit -p tsconfig.json
```

Before finishing a change, run the relevant tests, `npm run test:arch`, `npm run lint`, and the type-check.

## Guardrails

The rules below that a tool can check are enforced, so a violation fails `npm run lint` or `npm run test:arch`:

| Rule | Enforced by |
|---|---|
| `src/infra` never imports a feature | tsarch |
| Controllers don't reach `infra/database`, `infra/schemas` or `drizzle-orm` | tsarch + eslint |
| Workflows don't import `src/infra`, Drizzle or `@nestjs/microservices`, and don't use `Date`, `Math.random`, `setTimeout` or `randomUUID` | tsarch + eslint |
| Only modules import controllers and consumers | tsarch |
| No import cycles in `src/` | tsarch |
| `pg` and `kafkajs` only in `src/infra` | eslint |
| No `@OnOutboxMessage` or `NonRetryableMessageError`: consumers are Kafka `@EventPattern` | eslint |
| No `this.db.transaction(…)`: use `UnitOfWork.run` | eslint |
| No `Base*`, `Generic*`, `Abstract*`, `*Repository`, `*Manager`, `*Helper` or `*Utils` classes | eslint |
| No `process.env` outside `main.ts` and `app.module.ts` | eslint |
| No `any` | eslint |

The rules live in `test/architecture/architecture.arch-spec.ts` and `eslint.config.js`, and each message points back to the section of this file it comes from. When a rule blocks a change that is right, change the rule in the same PR and say why. Don't silence it with an inline disable.

## Layout

```text
src/
  <feature>/                    orders/, inventory/, notifications/, fulfilment/, outbox-admin/
    <feature>.module.ts
    <feature>.controller.ts     HTTP entry point (thin)
    <feature>.service.ts        business operations (transaction scripts)
    <name>.consumer.ts          Kafka consumers: @Controller() with @EventPattern()
    <name>.workflow.ts          durable workflows: @Workflow() providers
    <type>.ts                   feature types and request DTOs
  health/                       /health/live, /health/ready and their indicators
  infra/
    database/                   Drizzle types, pool, UnitOfWork, DrizzleOutboxStore
    messaging/                  Kafka producer, consumer options, outbox transport
    schemas/schema.ts           every table; migrations are generated from it
drizzle/                        generated SQL migrations (never edit applied ones)
test/                           e2e tests against the real AppModule and migrations
```

Keep features flat. Add a subfolder (`dto/`, `application/`) only once a feature has enough files that a flat list gets hard to scan. Put unit specs next to the file they test (`orders.service.spec.ts`).

## Business operations: Transaction Script

- One public service method = one business operation (`placeOrder`, `cancelOrder`). It reads top to bottom: validate → load → decide → persist → enqueue side effects → return.
- Group related operations of a feature in one `<Feature>Service`. Split one out into its own class (`RefundPayment`) only when it grows its own dependencies or when the service is mixing unrelated workflows.
- No repositories, aggregates, value objects, CQRS, mediators, `Base*`/`Generic*` classes, or use-case interfaces. Query Drizzle directly inside the transaction. Extract a function only for logic that is reused or that needs its own tests (e.g., pricing rules).
- Controllers parse input, call one service method, and return its result. No business logic in controllers or consumers.

## Transactions

- Use `UnitOfWork.run(async (tx) => …)` for any operation with more than one write, or with a read that a later write depends on. Pass `tx` down explicitly, and never mix `this.db` with `tx` inside one operation.
- `UnitOfWork.run` also wakes the outbox relay after commit. Use it in consumers too (`StockReservationConsumer`), and don't call `db.transaction` directly.
- For a read-check-write race, use `SELECT … FOR UPDATE` (see `cancelOrder`), a conditional `UPDATE … WHERE` (see stock reservation), or a unique constraint. Name the race in a comment.
- Enforce invariants in the database too: `NOT NULL`, FKs, unique constraints, checks. Model the column in `schema.ts`, then run `drizzle-kit generate`.

## Outbox and messaging

- Use the outbox only when committed state must reliably produce an async side effect (email, stock reservation, an event for another service). Call `this.outbox.add(tx, …)` inside the same `UnitOfWork.run` as the state change. Plain synchronous code needs no outbox.
- Every outbox message goes to Kafka (`route: () => 'kafka'` in `app.module.ts`), through `KafkaOutboxTransport` (`src/infra/messaging/kafka.ts`). Don't add another broker.
- Topics are `<entity>.<past-tense-verb>` (`order.placed`). Set `key` to the entity id: one entity's events share a partition and stay in order. Add each new topic to `kafka-init` in `docker-compose.yml`.
- Consumers are `@Controller()` classes with `@EventPattern('<topic>')`, receiving the `OutboxEnvelope<T>`. Delivery is at-least-once, so deduplicate on `envelope.id` through `OutboxInbox` with a unique consumer name:
  - DB writes: `inbox.processInTransaction(tx, '<consumer>', envelope.id, …)` inside `UnitOfWork.run`, so the inbox record commits with them;
  - external calls: `inbox.process('<consumer>', envelope.id, …)`, and pass the message id as the provider's idempotency key;
  - naturally idempotent operations (cancelling a workflow) need no inbox.
- A consumer that throws gets the message redelivered, blocking its partition. Throw only for transient failures. Turn deterministic ones (no stock, unknown entity) into an outcome: publish an event (`order.stock-rejected`) or skip with a log line.
- Keep consumers short. Once one holds more than a few lines of business logic, move that logic into a service method and call it.

## Building blocks

Reuse these before writing anything similar:

| Need | Building block | Example |
|---|---|---|
| Atomic multi-write operation | `UnitOfWork.run` | `OrdersService` |
| Reliable async side effect | Outbox + Kafka | `order.placed` |
| Consume an event once | `@EventPattern` + `OutboxInbox` | `OrderEmailsConsumer`, `StockReservationConsumer` |
| Process spanning time, external events or undo | Durable workflow | `OrderFulfilmentWorkflow` |
| Report health to the orchestrator | Terminus indicators | `src/health` |

### Durable workflows (`@nestjs/workflows`)

Use one when a process waits for something outside a request (a webhook, a timer, days) or must undo earlier steps when a later one fails: charge → wait for delivery → refund on timeout. A single async side effect is an outbox message, not a workflow.

- A workflow is an `@Workflow('<name>', { version, timeout })` class implementing `WorkflowRunner<Input, Output>`, registered as a provider in its feature module. See `src/fulfilment/order-fulfilment.workflow.ts`.
- Start it inside the `UnitOfWork.run` that writes its entity: `workflowClient.start(Workflow, input, { id: '<workflow>:<entityId>', transaction: tx })`. It commits or rolls back with the entity, and the id makes a second start a no-op.
- `run()` is replayed after every wake-up and restart, so it must be deterministic:
  - side effects only inside `ctx.step('<unique-name>', …)`;
  - time only through `ctx.sleep`, `ctx.timer` and `ctx.now()`, never `Date` or `Math.random`;
  - no per-run state on `this`, no `ctx` calls inside a step, and JSON-serializable inputs and results.
- Pass the step's `idempotencyKey` to every external call, compensations included. Give undoable steps a `compensate`, and call `ctx.commit('<name>')` at the point of no return.
- External events are `WorkflowSignal`s keyed by entity id. Senders that can retry, like webhooks and consumers, pass a dedup `id`. Every wait has a timeout.
- Cancel from the event that ends the process (the `order.cancelled` consumer). Treat `WorkflowNotFoundError` as nothing to do, or the message redelivers forever.
- A breaking change to `run()` is a new `version`. Keep the old class registered until `list()` shows none of its instances unfinished.
- The `nest_workflows` schema comes from a drizzle custom migration (`PostgresWorkflowStore.migrationSql()`), and the store runs with `migrate: false`. When an upgrade raises `PostgresWorkflowStore.schemaVersion`, add a new custom migration with `migrationSql({ from, to })`.
- `WORKFLOW_WORKER=off` runs an instance that starts and signals workflows but doesn't execute them.

### Health checks (`@nestjs/terminus`)

- `GET /health/live` checks only the process. Never add a dependency to it: a database outage would restart every pod.
- `GET /health/ready` checks dependencies. A new dependency gets an indicator in `src/health`, and a decision:
  - **down (503)** only if no request can succeed without it (the database);
  - **degraded (200)** if the service still works without it (Kafka, since the outbox buffers; an outbox backlog or dead letters).
- Use Terminus's built-in indicator when one exists (`MicroserviceHealthIndicator` for Kafka). Otherwise write one with `HealthIndicatorService.check(key).attempt(…)`, as `DatabaseHealthIndicator` does.
- Every probe has a timeout (`withTimeout`). Cache expensive ones (`cacheFor`). An indicator never throws: return `session.down(…)`, or Terminus answers 500 instead of 503. Messages don't leak SQL, hosts or credentials.
- `HEALTH_SHUTDOWN_DELAY_MS` keeps readiness at 503 after SIGTERM, so the load balancer drains the pod before it closes.

## Errors

- Validation problems → `BadRequestException`; missing → `NotFoundException`; state conflict → `ConflictException`. Services throw Nest's built-in exceptions directly, which is the current convention. Introduce domain error classes and an exception filter only when a non-HTTP caller needs to tell those errors apart.
- Never return raw DB or driver errors. Don't catch an error just to rethrow it unchanged.

## Input, config, security

- Treat HTTP bodies, params, message payloads and external responses as untrusted. Validate at the boundary. If you add `class-validator` and a global `ValidationPipe`, remove the hand-written shape checks they replace.
- Read configuration through `ConfigService` / `forRootAsync` factories, never with `process.env` in business code. Every new variable goes into `.env.example`.
- Never log secrets, tokens or personal data. Log entity ids (order id, message id, consumer).

## Resilience

Use what Nest and the building blocks already provide before writing anything custom: `enableShutdownHooks` (already on), outbox retry/backoff/lease, workflow step retries and compensations, Terminus health checks, and `@nestjs/throttler` for rate limiting. Add a timeout, retry or circuit breaker only for a named failure mode. Never retry validation errors or business failures.

Add idempotency (an `Idempotency-Key` header plus a unique constraint storing the result) to non-read endpoints where a client retry would duplicate a side effect, such as creating payments or charges. Read endpoints don't need it.

## TypeScript and style

- `strict` stays on. Use `unknown` instead of `any`. Annotate return types on public service methods. Model state with literal unions (`'placed' | 'cancelled'`).
- Relative imports use the `.js` suffix (ESM). Money is integer cents. Ids are `randomUUID()` strings.
- Guard clauses over nesting. Names must be specific enough to grep (`StockReservationConsumer`, not `Consumer`).
- Comments explain *why*: invariants, locks, ordering, external limits. Keep the existing ones when refactoring.

## Tests

- Every business rule and bug fix gets a test that checks behavior: returned values, DB rows, published messages.
- E2E: build `AppModule` with `Test.createTestingModule` and override the Drizzle token with PGlite plus the real migrations. Override `KAFKA_CLIENT` with a fake `emit`, and external services (`MailerService`, `PaymentsService`) with `vi.fn()` fakes.
- Drive background work by hand. Set `OUTBOX_RELAY=off` and call `relay.runOnce()`. Hand Kafka records to consumers by calling their methods, twice to prove idempotency.
- Workflows: override `WORKFLOWS_MODULE_OPTIONS` with `{ clock: new ManualWorkflowClock(…), worker: { enabled: false } }`, then `clock.advance('3d')` and `worker.drain()`. Suites that don't run workflows set `WORKFLOW_WORKER=off`.
- Health: request `/health/*` with supertest, and simulate an outage with `vi.spyOn(…).mockRejectedValueOnce`.
- Unit-test pure logic without Nest. Don't mock Drizzle query builders; use PGlite instead.

## Working rules for agents

- Read the feature you are touching and search (`rg`) for existing helpers before adding new ones. Mirror `orders/` for new features.
- Keep diffs small and on-task. No drive-by refactors, no new dependencies or patterns without a stated reason.
- Before adding an abstraction, answer: what concrete problem does it solve, and is there a simpler way? If you can't answer, don't add it.
- Preserve behavior unless asked to change it. Mention non-obvious architectural choices in one line.

## Done means

Logic sits in a service method; the controller is thin; multi-write operations use `UnitOfWork`; outbox only where async reliability is needed; consumers are idempotent; long-running processes are deterministic workflows with idempotent steps; a new dependency has a readiness decision (down or degraded); errors map to the right status; tests cover the behavior; lint, type-check, architecture and other tests pass; no unused abstraction was added.
