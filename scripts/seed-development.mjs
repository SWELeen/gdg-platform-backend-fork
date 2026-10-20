import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// An explicitly supplied target always takes precedence over env-file contents.
config({ path: process.env.DOTENV_CONFIG_PATH, override: false });

export function localSeedTarget(value, nodeEnv = process.env.NODE_ENV) {
  const message =
    'Development seed requires a local PostgreSQL URL and a non-production environment.';
  try {
    const target = new URL(value ?? '');
    if (
      nodeEnv?.trim().toLowerCase() === 'production' ||
      !['postgresql:', 'postgres:'].includes(target.protocol) ||
      !['localhost', '127.0.0.1', '[::1]', 'db'].includes(target.hostname) ||
      !target.pathname ||
      target.pathname === '/' ||
      [...target.searchParams.keys()].some((key) => key !== 'schema') ||
      target.searchParams.getAll('schema').length > 1 ||
      (target.searchParams.has('schema') &&
        target.searchParams.get('schema') !== 'public') ||
      value.includes('#')
    )
      throw new Error(message);
    return target.toString();
  } catch {
    throw new Error(message);
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const databaseUrl = localSeedTarget(process.env.DATABASE_URL);
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const childEnv = { ...process.env, DATABASE_URL: databaseUrl };
    // Prisma's config imports dotenv/config too; it must not replace the checked target.
    delete childEnv.DOTENV_CONFIG_OVERRIDE;
    // The constant shell wrapper supports the shebang-less pnpm shim on macOS; arguments are not interpolated.
    const result = spawnSync(
      'sh',
      [
        '-c',
        'exec pnpm "$@"',
        'pnpm',
        'exec',
        'prisma',
        'db',
        'execute',
        '--file',
        'prisma/seed-development.sql',
        '--config',
        'prisma7.config.ts',
      ],
      {
        cwd: root,
        env: childEnv,
        encoding: 'utf8',
        timeout: 60000,
      },
    );
    if (result.status !== 0) {
      const reason = `${result.stdout ?? ''}${result.stderr ?? ''}`.match(
        /development_seed_[a-z_]+/,
      )?.[0];
      throw new Error(
        `Development seed failed${reason ? `: ${reason}` : '; check migrations and local database availability'}. No partial fixture was committed.`,
      );
    }
    console.log('Local development seed completed.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
