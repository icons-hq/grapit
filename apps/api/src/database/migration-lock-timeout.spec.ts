import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Drizzle applies every pending migration in one transaction, and the Deploy
 * workflow gives that session `lock_timeout` through PGOPTIONS
 * (MIGRATION_LOCK_TIMEOUT, default 5s). A `SET LOCAL lock_timeout` inside one
 * migration lasts until the batch commits, so a longer value silently raises
 * the wait for every later migration of the same deploy. Migrations up to 0037
 * are already applied in production and stay untouched (0033 keeps its 10s).
 */
const MIGRATIONS_DIR = resolve(__dirname, 'migrations');
const DEPLOY_WORKFLOW = resolve(__dirname, '../../../../.github/workflows/deploy.yml');
const FIRST_GUARDED_MIGRATION = 38;

const UNIT_MS = { ms: 1, s: 1_000, min: 60_000, h: 3_600_000, d: 86_400_000 } as const;

function durationMs(text: string): number {
  const match = /^(\d+)\s*(ms|s|min|h|d)?$/.exec(text.trim());
  if (!match) throw new Error(`Unrecognized lock_timeout value: ${text}`);
  return Number(match[1]) * UNIT_MS[(match[2] ?? 'ms') as keyof typeof UNIT_MS];
}

type LockTimeoutSetting = { statement: string; scope: 'local' | 'session'; ms: number };

/** Every lock_timeout change in a migration, ignoring `--` comments. */
function lockTimeoutSettings(sql: string): LockTimeoutSetting[] {
  const code = sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  const settings: LockTimeoutSetting[] = [];
  for (const match of code.matchAll(/\bSET\s+(LOCAL\s+|SESSION\s+)?lock_timeout\s*(?:=|TO)\s*'?([^';\s]+)'?/gi)) {
    settings.push({
      statement: match[0],
      scope: /LOCAL/i.test(match[1] ?? '') ? 'local' : 'session',
      ms: durationMs(match[2]!),
    });
  }
  for (const match of code.matchAll(/set_config\(\s*'lock_timeout'\s*,\s*'([^']*)'\s*,\s*(true|false)\s*\)/gi)) {
    settings.push({ statement: match[0], scope: match[2]!.toLowerCase() === 'true' ? 'local' : 'session', ms: durationMs(match[1]!) });
  }
  return settings;
}

function defaultMigrationLockTimeoutMs(): number {
  const workflow = readFileSync(DEPLOY_WORKFLOW, 'utf8');
  const match = /MIGRATION_LOCK_TIMEOUT: \$\{\{ vars\.MIGRATION_LOCK_TIMEOUT \|\| '([^']+)' \}\}/.exec(workflow);
  if (!match) throw new Error('MIGRATION_LOCK_TIMEOUT default not found in deploy.yml');
  return durationMs(match[1]!);
}

function migrationFiles(): Array<{ file: string; number: number; sql: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort()
    .map((file) => ({
      file,
      number: Number(file.slice(0, 4)),
      sql: readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8'),
    }));
}

describe('migration lock_timeout stays within the deploy session limit (x4 migration-ops)', () => {
  it('reads the Deploy workflow MIGRATION_LOCK_TIMEOUT default', () => {
    expect(defaultMigrationLockTimeoutMs()).toBe(5_000);
  });

  it('detects lock_timeout changes in every form a migration could use', () => {
    expect(lockTimeoutSettings("SET LOCAL lock_timeout = '10s';")).toEqual([
      { statement: "SET LOCAL lock_timeout = '10s'", scope: 'local', ms: 10_000 },
    ]);
    expect(lockTimeoutSettings('SET lock_timeout TO 2000;').map(({ scope, ms }) => [scope, ms])).toEqual([['session', 2_000]]);
    expect(lockTimeoutSettings("SELECT set_config('lock_timeout', '1min', true);").map(({ scope, ms }) => [scope, ms]))
      .toEqual([['local', 60_000]]);
    expect(lockTimeoutSettings("-- SET LOCAL lock_timeout = '10s' was removed\nSELECT 1;")).toEqual([]);
    // The applied 0033 still carries its 10s, which proves the scan reads the real files.
    const applied = migrationFiles().find((migration) => migration.number === 33);
    expect(applied && lockTimeoutSettings(applied.sql).map((setting) => setting.ms)).toEqual([10_000]);
  });

  it(`no migration from 00${FIRST_GUARDED_MIGRATION} on waits longer than MIGRATION_LOCK_TIMEOUT or changes the session`, () => {
    const limitMs = defaultMigrationLockTimeoutMs();
    const guarded = migrationFiles().filter((migration) => migration.number >= FIRST_GUARDED_MIGRATION);
    expect(guarded.map((migration) => migration.number)).toContain(39);

    const violations = guarded.flatMap(({ file, sql }) =>
      lockTimeoutSettings(sql)
        // 0 disables the timeout (wait forever); a session-level SET outlives the batch.
        .filter((setting) => setting.scope === 'session' || setting.ms === 0 || setting.ms > limitMs)
        .map((setting) => `${file}: ${setting.statement}`),
    );
    expect(violations).toEqual([]);
  });
});
