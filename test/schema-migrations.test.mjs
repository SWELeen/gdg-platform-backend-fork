import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  copyMigrationHistory,
  injectMigrationFailure,
  migrationNames,
} from './schema-migrations.mjs';

test('copies an ordered migration prefix without altering source SQL', () => {
  const root = mkdtempSync(join(tmpdir(), 'gdg-migration-unit-'));
  try {
    const source = join(root, 'source');
    mkdirSync(join(source, 'migrations'), { recursive: true });
    writeFileSync(join(source, 'schema.prisma'), 'test schema');
    writeFileSync(
      join(source, 'migrations', 'migration_lock.toml'),
      'provider = "postgresql"',
    );
    for (const name of ['20261015_second', '20261009_first']) {
      mkdirSync(join(source, 'migrations', name));
      writeFileSync(
        join(source, 'migrations', name, 'migration.sql'),
        `BEGIN;\nSELECT '${name}';\nCOMMIT;\n`,
      );
    }
    writeFileSync(
      join(source, 'migrations', '20261020_not_a_directory'),
      'ignored',
    );
    assert.deepEqual(migrationNames(join(source, 'migrations')), [
      '20261009_first',
      '20261015_second',
    ]);
    const target = join(root, 'prefix');
    copyMigrationHistory(source, target, ['20261009_first']);
    assert.deepEqual(migrationNames(join(target, 'migrations')), [
      '20261009_first',
    ]);
    assert.equal(
      readFileSync(join(target, 'schema.prisma'), 'utf8'),
      'test schema',
    );
    assert.equal(
      readFileSync(join(target, 'migrations', 'migration_lock.toml'), 'utf8'),
      'provider = "postgresql"',
    );
    const full = join(root, 'full');
    copyMigrationHistory(source, full, ['20261009_first', '20261015_second']);
    const targetFile = join(
      full,
      'migrations',
      '20261015_second',
      'migration.sql',
    );
    writeFileSync(
      targetFile,
      injectMigrationFailure(readFileSync(targetFile, 'utf8')),
    );
    assert.match(readFileSync(targetFile, 'utf8'), /SELECT 1 \/ 0;\nCOMMIT;/);
    assert.equal(
      readFileSync(
        join(source, 'migrations', '20261015_second', 'migration.sql'),
        'utf8',
      ),
      "BEGIN;\nSELECT '20261015_second';\nCOMMIT;\n",
    );
    assert.equal(
      readFileSync(
        join(full, 'migrations', '20261009_first', 'migration.sql'),
        'utf8',
      ),
      "BEGIN;\nSELECT '20261009_first';\nCOMMIT;\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects failure injection without an enclosing transaction', () => {
  for (const sql of [
    'SELECT 1;\nCOMMIT;',
    'BEGIN;\nSELECT 1;',
    'BEGIN;\nCOMMIT;\nBEGIN;\nCOMMIT;',
  ]) {
    assert.throws(() => injectMigrationFailure(sql), /transaction/);
  }
  assert.match(
    injectMigrationFailure('-- migration\nBEGIN;\nSELECT 1;\nCOMMIT;\n'),
    /SELECT 1 \/ 0;\nCOMMIT;/,
  );
});

test('injects into lowercase transactions and refuses trailing SQL comments', () => {
  assert.equal(
    injectMigrationFailure('begin;\nSELECT 1;\ncommit;\n'),
    'begin;\nSELECT 1;\nSELECT 1 / 0;\nCOMMIT;\n',
  );
  assert.throws(
    () => injectMigrationFailure('BEGIN;\nCOMMIT; -- trailing comment'),
    /transaction/,
  );
});

test('refuses transaction aliases and comment markers inside SQL literals', () => {
  for (const sql of [
    'BEGIN;\nCREATE TABLE probe(id int);\nCOMMIT WORK;\nBEGIN WORK;\nCOMMIT;',
    'BEGIN;\nCREATE TABLE probe(id int);\nEND;\nSTART TRANSACTION;\nCOMMIT;',
    "BEGIN;\nSELECT '--'; COMMIT;\nCREATE TABLE probe(id int);\nCOMMIT;",
    'BEGIN;\nCREATE TABLE probe(id int);\nEND AND CHAIN;\nCOMMIT;',
    'BEGIN;\nCREATE TABLE probe(id int);\nEND WORK AND CHAIN;\nCOMMIT;',
    'BEGIN;\nCREATE TABLE probe(id int);\nEND TRANSACTION AND NO CHAIN;\nCOMMIT;',
    'BEGIN;\nABORT;\nSTART TRANSACTION;\nCOMMIT;',
  ])
    assert.throws(() => injectMigrationFailure(sql), /transaction/);
});

test('ignores SQL bodies, literals, identifiers and comments when checking outer transactions', () => {
  const sql = String.raw`-- BEGIN is a comment
BEGIN;
DO $guard$ BEGIN IF false THEN RAISE EXCEPTION 'COMMIT'; END IF; END $guard$;
CREATE FUNCTION touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
SELECT '--', 'it''s COMMIT;', "BEGIN", E'escaped\'value';
/* COMMIT WORK; */
COMMIT;
`;
  assert.match(injectMigrationFailure(sql), /SELECT 1 \/ 0;\nCOMMIT;/);
  assert.throws(
    () =>
      injectMigrationFailure(
        'BEGIN;\n/* outer /* nested */ comment */\nCOMMIT;',
      ),
    /transaction/,
  );
});
