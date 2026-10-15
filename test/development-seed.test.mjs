import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { localSeedTarget } from '../scripts/seed-development.mjs';

const local =
  'postgresql://developer:fake-secret@127.0.0.1:5432/gdg_platform?schema=public';

test('accepts only local PostgreSQL hosts with the public schema', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]', 'db']) {
    for (const scheme of ['postgresql', 'postgres']) {
      const value = `${scheme}://user:password@${host}:5432/gdg_platform`;
      assert.equal(localSeedTarget(value, 'development'), value);
      assert.equal(
        localSeedTarget(`${value}?schema=public`),
        `${value}?schema=public`,
      );
    }
  }
});

test('rejects unsafe or malformed targets without disclosing their values', () => {
  for (const value of [
    undefined,
    '',
    'not-a-url',
    local.replace('127.0.0.1', 'db.example.com'),
    local.replace('127.0.0.1', 'db.project.supabase.co'),
    local.replace('127.0.0.1', '127.0.0.1.example.com'),
    local.replace('postgresql:', 'https:'),
    'postgresql://localhost/',
    `${local}&host=remote.example.com`,
    `${local}&schema=public`,
    local.replace('schema=public', 'schema=private'),
    `${local}#fragment`,
    `${local}#`,
    local.replace('schema=public', 'options=-csearch_path%3Dprivate'),
  ]) {
    assert.throws(
      () => localSeedTarget(value),
      (error) => {
        assert.match(error.message, /local PostgreSQL/);
        assert.doesNotMatch(
          error.message,
          /fake-secret|remote.example.com|supabase/,
        );
        return true;
      },
    );
  }
});

test('rejects production mode even with a local URL', () => {
  for (const mode of ['production', 'PRODUCTION', ' production ']) {
    assert.throws(() => localSeedTarget(local, mode), /non-production/);
  }
});

test('importing the launcher never runs its command', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "await import('./scripts/seed-development.mjs')",
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: 'invalid' },
    },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('the public command rejects remote targets before Prisma runs and keeps credentials private', () => {
  const result = spawnSync(process.execPath, ['scripts/seed-development.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://user:fake-secret@remote.example.com/demo',
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /local PostgreSQL/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /fake-secret|remote.example.com|Prisma/,
  );
});

test('an env-file override cannot replace the explicit target before validation', () => {
  const root = mkdtempSync(join(tmpdir(), 'gdg-seed-env-'));
  try {
    const envFile = join(root, '.env');
    writeFileSync(
      envFile,
      'DATABASE_URL=postgresql://user:file-secret@127.0.0.1:1/not_a_database\n',
    );
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/seed-development.mjs')],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DATABASE_URL: 'postgresql://user:explicit-secret@remote.invalid/demo',
          DOTENV_CONFIG_PATH: envFile,
          DOTENV_CONFIG_OVERRIDE: 'true',
        },
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /local PostgreSQL/);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /explicit-secret|file-secret|Prisma/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
