// Architecture guardrails from AGENTS.md: what a lint rule can see in one file (syntax, package
// imports). Dependencies between the project's own folders are checked by tsarch in
// test/architecture. General linting stays with oxlint (`npm run lint` runs both).
import tseslint from 'typescript-eslint';

const workflowGuide = 'Workflows replay run() after every restart (AGENTS.md, "Durable workflows")';

/** Selectors every file in src/ is held to; overrides below add to them (a rule set later replaces it). */
const srcSyntax = [
  {
    selector:
      'ClassDeclaration[id.name=/^(Base|Generic|Abstract)|(Repository|Manager|Helper|Utils?)$/]',
    message:
      'No generic base classes, repositories or managers (AGENTS.md, "Transaction Script"): name the business operation, and query Drizzle inside the transaction.',
  },
  {
    selector:
      'CallExpression[callee.property.name="transaction"][callee.object.type="MemberExpression"][callee.object.object.type="ThisExpression"][callee.object.property.name="db"]',
    message:
      'Open transactions with UnitOfWork.run(): it also wakes the outbox relay after commit (AGENTS.md, "Transactions").',
  },
];

const srcImports = {
  paths: [
    {
      name: '@nestjs/outbox',
      importNames: ['OnOutboxMessage', 'NonRetryableMessageError'],
      message:
        'Every outbox message goes to Kafka, so @OnOutboxMessage() handlers never run: write an @EventPattern() consumer with OutboxInbox (AGENTS.md, "Outbox and messaging").',
    },
  ],
  patterns: [
    {
      group: ['pg', 'kafkajs'],
      message: 'Drivers stay in src/infra: use the Drizzle database, the outbox or the Kafka client module.',
    },
  ],
};

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/'] },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.spec.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...srcSyntax],
      'no-restricted-imports': ['error', srcImports],
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read configuration through ConfigService (AGENTS.md, "Input, config, security").',
        },
      ],
    },
  },
  {
    // Bootstrap and module wiring are where configuration enters the app.
    files: ['src/main.ts', 'src/app.module.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['src/infra/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: srcImports.paths }],
      'no-restricted-syntax': ['error', srcSyntax[0]],
    },
  },
  {
    files: ['src/**/*.controller.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: srcImports.paths,
          patterns: [
            ...srcImports.patterns,
            {
              group: ['drizzle-orm', 'drizzle-orm/*', '@nestjs/drizzle'],
              message:
                'Controllers stay thin: parse the input, call one service method, return its result (AGENTS.md, "Business operations").',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.workflow.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...srcImports.paths,
            { name: 'node:crypto', importNames: ['randomUUID'], message: `Use ctx.uuid(). ${workflowGuide}.` },
          ],
          patterns: [
            ...srcImports.patterns,
            {
              group: ['drizzle-orm', 'drizzle-orm/*', '@nestjs/drizzle', '@nestjs/microservices'],
              message: `Side effects go through injected services called inside ctx.step(). ${workflowGuide}.`,
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        ...srcSyntax,
        { selector: 'NewExpression[callee.name="Date"]', message: `Use ctx.now(). ${workflowGuide}.` },
        { selector: 'MemberExpression[object.name="Date"][property.name="now"]', message: `Use ctx.now(). ${workflowGuide}.` },
        { selector: 'MemberExpression[object.name="Math"][property.name="random"]', message: `Use ctx.random(). ${workflowGuide}.` },
        {
          selector: 'CallExpression[callee.name=/^set(Timeout|Interval)$/]',
          message: `Use ctx.sleep() or ctx.timer(). ${workflowGuide}.`,
        },
      ],
    },
  },
);
