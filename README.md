# NestJS Reliability Template

A scaffold for NestJS services that must not lose data, must not do things twice, and must keep working when a dependency doesn't. It collects the practices and guidelines I start new backend projects from, each one implemented, tested and runnable.

The code is a small orders service: place an order, reserve stock, send emails, charge a payment, wait for the delivery. The domain is only the example. The patterns, wiring and conventions around it are what you copy.

**Stack:** NestJS 12 · TypeScript (strict, ESM) · PostgreSQL + Drizzle · Kafka · `@nestjs/outbox` · `@nestjs/workflows` · `@nestjs/terminus` · Vitest + PGlite · oxlint

## Principles

- **Simple first.** Business operations are explicit transaction scripts. Add a pattern only for a failure mode you can name. [`AGENTS.md`](AGENTS.md) holds the full coding and architecture conventions, for people and for AI coding agents.
- **No dual writes.** State and the messages it produces commit in one database transaction, or not at all.
- **At-least-once everywhere, idempotent everywhere.** Messages can be redelivered and steps retried. Every consumer and every external call is safe to repeat.
- **Business failures are outcomes, not errors.** A deterministic failure, like no stock, becomes an event. Retrying it would only block a partition.
- **Degrade, don't fall over.** A dependency outage is reported, isolated and recovered from. It shouldn't take the service down with it.
- **The database guards invariants.** Constraints, row locks and conditional updates, not only application checks.
- **Tested against real PostgreSQL.** E2E tests run the real migrations on PGlite, in-process, with no Docker.

## What's inside

| Practice | Problem it solves | Where |
|---|---|---|
| Transaction script + `UnitOfWork` | A business operation is one readable function with one explicit transaction boundary | `src/orders/orders.service.ts`, `src/infra/database/unit-of-work.ts` |
| [Transactional outbox](https://docs.nestjs.com/reliability/outbox) | The dual-write problem: an event lost after a commit, or sent for a rolled-back change | `outbox.add(tx, …)` in `orders.service.ts`, `src/infra/database/drizzle-outbox.store.ts` |
| Kafka transport, keyed by entity | One order's events stay in order on one partition, while orders spread across partitions | `src/infra/messaging/kafka.ts` |
| Idempotent consumers (inbox) | Kafka redelivers after a crash or a rebalance | `src/notifications/order-emails.consumer.ts` |
| Exactly-once local effects | Inbox record and side effect commit together, so a stock reservation never happens twice | `src/inventory/stock-reservation.consumer.ts` |
| All-or-nothing with savepoints | A partial failure rolls back its own writes without losing the inbox record | `reserveAllOrNothing()` in the stock consumer |
| Failure as an event | A poison message would block its partition forever | `order.stock-rejected` |
| Retries, backoff, dead letters | Transient failures heal themselves; permanent ones wait for a human, with requeue | outbox `retry` in `src/app.module.ts`, `src/outbox-admin` |
| [Durable workflows](https://docs.nestjs.com/reliability/workflows) (saga) | Processes that span days survive restarts, wait for external events and timers, and undo completed steps | `src/fulfilment/order-fulfilment.workflow.ts` |
| Idempotency keys on external calls | Payment and email providers don't charge or send twice on a retry | `ctx.step(…, ({ idempotencyKey }) => …)` |
| Deduplicated webhooks | A carrier retrying its webhook is a no-op | signal `id` in `src/fulfilment/fulfilment.controller.ts` |
| [Health checks](https://docs.nestjs.com/reliability/terminus) | The orchestrator learns what's broken: liveness never depends on others; readiness fails only on what blocks every request | `src/health` |
| Graceful shutdown | Deploys don't drop requests or in-flight messages | `enableShutdownHooks()`, `HEALTH_SHUTDOWN_DELAY_MS` |
| Connection-loss resilience | A database restart doesn't crash the process | `pool.on('error')` in `src/infra/database/drizzle.ts` |
| Row locks and conditional updates | Concurrent requests can't break an invariant (double cancel, negative stock) | `cancelOrder()`, stock reservation |

## Scaling out

The API is stateless and every background loop coordinates through PostgreSQL leases, so you scale by adding instances:

- **Outbox relay:** instances claim messages under leases and keep per-key order, so several can run at once.
- **Kafka consumers:** consumers in one group split the partitions; keying by entity id keeps each entity's events in order.
- **Workflow workers:** instances claim workflow instances under leases. A crashed worker's work moves to another one once its lease expires.
- **Split roles when load differs:** `OUTBOX_RELAY=off` and `WORKFLOW_WORKER=off` give API-only pods that write messages and start workflows, while dedicated pods publish and run them.

## Run it locally

```bash
docker compose up -d            # Postgres, Kafka (KRaft), topic creation, Kafka UI
cp .env.example .env
npm install
npm run db:migrate
npm run start:dev               # http://localhost:3000
```

- **Kafka UI:** http://localhost:8080
- **API requests:** open `bruno/` in [Bruno](https://www.usebruno.com) and pick the `local` environment. *Place order* stores the order id for the other requests.
- **Health:** `GET /health/live`, `GET /health/ready`

### Try the example flow

| Request | What happens |
|---|---|
| `POST /orders` | Order, outbox message and fulfilment workflow commit in one transaction |
| (Kafka) `order.placed` | The confirmation email and the stock reservation each run once per order |
| `GET /fulfilments/:orderId` | The workflow is charged and `awaiting-delivery` |
| `POST /fulfilments/:orderId/delivered` | Carrier webhook. The workflow sleeps 7 days, then sends a review request |
| `POST /orders/:id/cancel` | `order.cancelled` reaches Kafka; the workflow is cancelled and refunds if not yet delivered |
| `GET /admin/outbox/stats`, `/admin/outbox/dead-letters` | Outbox backlog, dead letters, requeue and purge (header `x-admin-token`) |

Stop Kafka (`docker stop outbox-poc-kafka`) and keep placing orders: `/health/ready` reports `degraded`, orders still commit, and their events go out once Kafka is back.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | required | PostgreSQL connection string |
| `KAFKA_BROKERS` | required | Comma-separated brokers (`localhost:9092`) |
| `KAFKA_CLIENT_ID` / `KAFKA_GROUP_ID` | `orders-api` | Kafka client id and consumer group (Nest appends `-server` to the group) |
| `ADMIN_TOKEN` | none (admin routes answer 403) | Token for `/admin/outbox/*` |
| `OUTBOX_RELAY` | on | `off`: this instance writes outbox messages but doesn't publish them |
| `WORKFLOW_WORKER` | on | `off`: this instance starts and signals workflows but doesn't run them |
| `HEALTH_SHUTDOWN_DELAY_MS` | `0` | After SIGTERM, readiness answers 503 for this long before the app closes |
| `PORT` | `3000` | HTTP port |

## Tests

```bash
npm test                        # unit
npm run test:e2e                # e2e on PGlite: real migrations, no Docker
npm run lint
npx tsc --noEmit -p tsconfig.json
```

The e2e suites drive time and background work by hand: `relay.runOnce()` publishes the outbox, `worker.drain()` runs due workflows, and `ManualWorkflowClock` jumps days ahead. They cover rollbacks, redeliveries, timeouts, compensations and health under outages.

## Starting a project from this template

1. Keep `src/infra`, `src/health`, `src/outbox-admin`, the module wiring in `src/app.module.ts`, `docker-compose.yml` and `AGENTS.md`.
2. Replace `orders`, `inventory`, `notifications` and `fulfilment` with your domain. Mirror their shape: a thin controller, a service with one method per business operation, consumers as `@EventPattern()` controllers, long processes as workflows.
3. Model tables in `src/infra/schemas/schema.ts`, run `npx drizzle-kit generate`, and add the new topics to `kafka-init` in `docker-compose.yml`.
4. Before merging anything, check the definition of done in [`AGENTS.md`](AGENTS.md).

## Project layout

```text
src/
  orders/          HTTP API and transaction scripts (place, cancel)
  inventory/       Kafka consumer: exactly-once stock reservation
  notifications/   Kafka consumer: confirmation email; mailer stand-in
  fulfilment/      durable workflow, carrier webhook, cancellation consumer
  health/          Terminus liveness/readiness and indicators
  outbox-admin/    dead letters and stats
  infra/
    database/      Drizzle, UnitOfWork, outbox store
    messaging/     Kafka producer/consumer and outbox transport
    schemas/       table definitions (migrations are generated from them)
drizzle/           SQL migrations, workflow store schema included
test/              e2e suites
bruno/             API collection
```

## Known gaps

Not done yet, and what each one is for:

- **Request validation:** a global `ValidationPipe` with DTO classes. Today the services check input by hand.
- **Idempotency on `POST /orders`:** an `Idempotency-Key` header, so a client retry can't create a second order.
- **Observability:** structured logs with correlation ids, metrics and tracing.
- **Domain gaps:** nothing consumes `order.stock-rejected` yet, and the fulfilment workflow charges without waiting for the stock reservation.
- **Leftover analytics wiring:** the `start:analytics` scripts and `drizzle.analytics.config.ts` point at a service that isn't in the repository.
