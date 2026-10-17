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
  const statements = sql
    .replace(
      /--[^\n]*|\/\*[\s\S]*?\*\/|\bE'(?:\\.|''|[^'\\])*'|'(?:''|[^'])*'|"(?:""|[^"])*"|(?<body>\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$)[\s\S]*?\k<body>/gi,
      (token) => {
        assert(
          !token.startsWith('/*') || !token.slice(2, -2).includes('/*'),
          'Failure injection requires review of nested transaction comments',
        );
        return token.replace(/[^\n]/g, ' ');
      },
    )
    .trim();
  assert(
    !/['"$]|\/\*|\*\//.test(statements),
    'Failure injection requires complete transaction SQL tokens',
  );
  const boundaries =
    statements.match(
      /\b(?:BEGIN|COMMIT|ROLLBACK|ABORT|START\s+TRANSACTION|PREPARE\s+TRANSACTION)\b|\bEND\s*(?:(?:WORK|TRANSACTION)\s*)?(?:AND\s+(?:NO\s+)?CHAIN\s*)?;/gi,
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
