import { filesOfProject } from 'tsarch';
import { describe, expect, it } from 'vitest';

// Dependency guardrails from AGENTS.md, between the project's own files. Package imports and
// syntax rules (drivers, process.env, Date.now() in workflows) are in eslint.config.js.

/** Only src/, without specs: tsarch reads this tsconfig (it can't follow `extends`). */
const project = () => filesOfProject('tsconfig.arch.json');

const features = ['auth', 'orders', 'inventory', 'notifications', 'fulfilment', 'health', 'outbox-admin'];

type Rule = { check(): Promise<{ dependency?: { sourceLabel: string; targetLabel: string } }[]> };

/** Fails with the offending edges ("a.ts -> b.ts"), not just a count. */
async function expectNoViolations(rule: Rule) {
  const violations = await rule.check();
  expect(
    violations.map(({ dependency }) =>
      dependency ? `${dependency.sourceLabel} -> ${dependency.targetLabel}` : 'cycle',
    ),
  ).toEqual([]);
}

describe('Architecture', () => {
  it('keeps infra below the features: infra never imports a feature', async () => {
    await expectNoViolations(
      project()
        .matchingPattern('^src/infra/')
        .shouldNot()
        .dependOnFiles()
        .matchingPattern(`^src/(${features.join('|')})/`),
    );
  });

  it('keeps controllers thin: no database access, only services', async () => {
    await expectNoViolations(
      project()
        .matchingPattern('\\.controller\\.ts$')
        .shouldNot()
        .dependOnFiles()
        .matchingPattern('^src/infra/(database|schemas)/'),
    );
  });

  it('keeps workflows deterministic: no database or broker, side effects through injected services', async () => {
    await expectNoViolations(
      project().matchingPattern('\\.workflow\\.ts$').shouldNot().dependOnFiles().matchingPattern('^src/infra/'),
    );
  });

  it('treats controllers and consumers as entry points: only modules import them', async () => {
    await expectNoViolations(
      project()
        .matchingPattern('^src/(?!.*\\.module\\.ts$)')
        .shouldNot()
        .dependOnFiles()
        .matchingPattern('\\.(controller|consumer)\\.ts$'),
    );
  });

  it('has no import cycles', async () => {
    await expectNoViolations(project().matchingPattern('^src/').should().beFreeOfCycles());
  });
});
