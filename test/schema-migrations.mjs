import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function migrationNames(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function copyMigrationHistory(source, target, names) {
  mkdirSync(join(target, 'migrations'), { recursive: true });
  cpSync(join(source, 'schema.prisma'), join(target, 'schema.prisma'));
  cpSync(
    join(source, 'migrations', 'migration_lock.toml'),
    join(target, 'migrations', 'migration_lock.toml'),
  );
  for (const name of names)
    cpSync(join(source, 'migrations', name), join(target, 'migrations', name), {
      recursive: true,
    });
}

export function injectMigrationFailure(sql) {
  // shortcut: accepts simple transaction scripts with full-line comments; review SQL bodies/keywords manually.
  const statements = sql.replace(/^[ \t]*--[^\n]*/gm, '').trim();
  const boundaries =
    statements.match(
      /\b(?:BEGIN|COMMIT|ROLLBACK|ABORT|START\s+TRANSACTION|PREPARE\s+TRANSACTION)\b|\bEND\s*(?:WORK|TRANSACTION)?\s*;/gi,
    ) ?? [];
  assert(
    /^BEGIN;/i.test(statements) &&
      /(?:^|\n)[ \t]*COMMIT;\s*$/i.test(sql) &&
      boundaries.length === 2 &&
      boundaries[0].toUpperCase() === 'BEGIN' &&
      boundaries[1].toUpperCase() === 'COMMIT',
    'Failure injection requires one explicit BEGIN/COMMIT transaction',
  );
  return sql.replace(/COMMIT;\s*$/i, 'SELECT 1 / 0;\nCOMMIT;\n');
}
