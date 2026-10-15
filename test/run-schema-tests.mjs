import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import {
  copyMigrationHistory,
  injectMigrationFailure,
  migrationNames,
} from './schema-migrations.mjs';

const initialTables = [
  'committee',
  'event_questions',
  'event_registrations',
  'events',
  'member',
  'member_committee',
  'permissions',
  'registration_answers',
  'registration_blacklist_entries',
  'role_permissions',
  'roles',
  'user_roles',
  'users',
];
// Update this explicit manifest when a migration adds or removes project tables.
const expectedTables = [
  ...initialTables.filter(
    (table) => !['users', 'user_roles', 'roles'].includes(table),
  ),
  'person',
  'role',
].sort();

// This runner creates its own server; it never accepts an application database URL.
const name = `gdg-schema-test-${process.pid}-${randomBytes(4).toString('hex')}`;
const password = randomBytes(24).toString('hex');
const env = {
  ...process.env,
  POSTGRES_USER: 'postgres',
  POSTGRES_PASSWORD: password,
  POSTGRES_DB: 'gdg_schema_test_a',
};
const scratch = mkdtempSync(join(tmpdir(), 'gdg-schema-test-'));
let started = false;
let backendStarted = false;
let networkStarted = false;
let imageBuilt = false;
const backendName = `${name}-backend`;
const image = `${name}:startup`;
function run(command, args, overrides = {}) {
  // pnpm 12 may be a shebang-less shim on macOS; a shell handles its ENOEXEC fallback.
  if (command === 'pnpm') {
    return run('sh', ['-c', 'exec pnpm "$@"', 'pnpm', ...args], overrides);
  }
  try {
    return execFileSync(command, args, {
      env: { ...env, ...overrides },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.replaceAll(
      password,
      '[redacted]',
    );
    throw new Error(
      `${command} failed (${error.status ?? error.code})\n${output}`,
    );
  }
}
function sql(database, query) {
  return run('docker', [
    'exec',
    name,
    'psql',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'postgres',
    '-d',
    database,
    '-At',
    '-c',
    query,
  ]).trim();
}
function tables(database) {
  const result = sql(
    database,
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename",
  );
  return result ? result.split('\n') : [];
}
function assertTables(database, expected) {
  assert.deepEqual(
    tables(database),
    [...expected].sort(),
    'Unexpected project tables',
  );
}
function schemaDump(database) {
  return run('docker', [
    'exec',
    name,
    'pg_dump',
    '-U',
    'postgres',
    '-d',
    database,
    '--schema-only',
    '--no-owner',
    '--no-privileges',
    '--exclude-table=public._prisma_migrations',
  ])
    .split('\n')
    .filter(
      (line) =>
        !line.startsWith('--') &&
        !line.startsWith('\\restrict ') &&
        !line.startsWith('\\unrestrict '),
    )
    .join('\n');
}
function domainRows(database) {
  return tables(database).map((table) => [
    table,
    sql(
      database,
      `SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text), '[]'::jsonb) FROM "${table.replaceAll('"', '""')}" r`,
    ),
  ]);
}

try {
  run('docker', ['network', 'create', name]);
  networkStarted = true;
  run('docker', [
    'run',
    '--network',
    name,
    '--detach',
    '--rm',
    '--name',
    name,
    '-e',
    'POSTGRES_USER',
    '-e',
    'POSTGRES_PASSWORD',
    '-e',
    'POSTGRES_DB',
    '-p',
    '127.0.0.1::5432',
    'postgres:17',
  ]);
  started = true;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      // The image's temporary initialization server accepts Unix sockets before the test database exists.
      run('docker', [
        'exec',
        name,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'postgres',
      ]);
      ready = true;
      break;
    } catch {
      await delay(500);
    }
  }
  assert(ready, 'Disposable PostgreSQL did not become ready');
  const port = run('docker', ['port', name, '5432/tcp'])
    .trim()
    .split(':')
    .at(-1);
  assert(/^\d+$/.test(port), 'Expected one loopback PostgreSQL port');
  const url = (database) =>
    `postgresql://postgres:${password}@127.0.0.1:${port}/${database}?schema=public`;
  const testEnv = {
    DATABASE_URL: url('postgres'),
    TEST_DATABASE_URL: url('gdg_schema_test_a'),
  };
  assert.equal(
    sql(
      'gdg_schema_test_a',
      "SELECT count(*) FROM pg_tables WHERE schemaname='public'",
    ),
    '0',
  );

  console.log(
    'RED: expecting schema tests to fail on an empty disposable database.',
  );
  let failedBeforeMigration = false;
  try {
    run('pnpm', ['test:schema'], testEnv);
  } catch (error) {
    assert.match(
      error.message,
      /does not exist|P2021/,
      'Expected missing-schema failure, not a broken test harness',
    );
    failedBeforeMigration = true;
  }
  assert(
    failedBeforeMigration,
    'Schema tests unexpectedly passed before migration',
  );

  const dumps = [];
  for (const database of ['gdg_schema_test_a', 'gdg_schema_test_b']) {
    if (database.endsWith('_b'))
      run('docker', ['exec', name, 'createdb', '-U', 'postgres', database]);
    console.log(`Migrating and testing ${database}.`);
    run('pnpm', ['prisma:migrate:deploy'], { DATABASE_URL: url(database) });
    console.log(
      run('pnpm', ['test:schema'], {
        ...testEnv,
        TEST_DATABASE_URL: url(database),
      }),
    );
    const repeat = run('pnpm', ['prisma:migrate:deploy'], {
      DATABASE_URL: url(database),
    });
    assert.match(repeat, /No pending migrations/);
    assertTables(database, expectedTables);
    assert.deepEqual(
      domainRows(database).map(([table, rows]) => [
        table,
        JSON.parse(rows).sort((a, b) =>
          (a.role_code ?? '').localeCompare(b.role_code ?? ''),
        ),
      ]),
      [...expectedTables].sort().map((table) => [
        table,
        table === 'role'
          ? [
              {
                role_code: 'ADVISOR',
                description: 'Club advisor',
                is_privileged: true,
              },
              {
                role_code: 'GROUP_LEADER',
                description: 'Club (group) leader',
                is_privileged: true,
              },
              {
                role_code: 'GROUP_CO_LEADER',
                description: 'Club (group) co-leader',
                is_privileged: true,
              },
            ].sort((a, b) => a.role_code.localeCompare(b.role_code))
          : [],
      ]),
      'Tests must preserve approved seeds and clean up all committed fixtures',
    );
    dumps.push(schemaDump(database));
  }
  assert.equal(dumps[0], dumps[1], 'Clean database schemas differ');
  console.log(
    'PASS: two clean replays are equivalent; repeat deploy is a no-op.',
  );

  const migrations = migrationNames('prisma/migrations');
  assert(migrations.length > 0, 'Expected committed migration history');

  // Prove the fresh-only precondition independently for every old table, not just users.
  const freshMigration = '20261015164000_people_membership_fresh';
  const freshIndex = migrations.indexOf(freshMigration);
  assert(
    freshIndex > 0,
    'Expected the fresh-schema migration after initial history',
  );
  const preservedDatabase = 'gdg_schema_test_nonempty';
  run('docker', [
    'exec',
    name,
    'createdb',
    '-U',
    'postgres',
    preservedDatabase,
  ]);
  const preservedRoot = join(scratch, 'nonempty', 'prisma');
  copyMigrationHistory(
    'prisma',
    preservedRoot,
    migrations.slice(0, freshIndex),
  );
  const preservedConfig = join(scratch, 'nonempty', 'prisma.config.ts');
  writeFileSync(
    preservedConfig,
    `export default { schema: ${JSON.stringify(join(preservedRoot, 'schema.prisma'))}, migrations: { path: ${JSON.stringify(join(preservedRoot, 'migrations'))} }, datasource: { url: process.env.DATABASE_URL } };\n`,
  );
  run(
    'pnpm',
    ['exec', 'prisma', 'migrate', 'deploy', '--config', preservedConfig],
    { DATABASE_URL: url(preservedDatabase) },
  );
  const preservedSchema = schemaDump(preservedDatabase);
  const fixtures = JSON.parse(
    readFileSync('test/fixtures/initial-nonempty.json', 'utf8'),
  );
  assert.deepEqual(Object.keys(fixtures).sort(), [...initialTables].sort());
  const freshSQL = readFileSync(
    join('prisma/migrations', freshMigration, 'migration.sql'),
    'utf8',
  );
  for (const [table, insert] of Object.entries(fixtures)) {
    // Test server only: disable FK triggers to isolate one populated table at a time.
    sql(preservedDatabase, `SET session_replication_role=replica; ${insert}`);
    const rows = domainRows(preservedDatabase);
    assert.throws(
      () => sql(preservedDatabase, freshSQL),
      /people_membership_requires_empty_database/,
    );
    assert.equal(
      schemaDump(preservedDatabase),
      preservedSchema,
      `Nonempty ${table} schema changed`,
    );
    assert.deepEqual(
      domainRows(preservedDatabase),
      rows,
      `Nonempty ${table} records changed`,
    );
    assert.equal(
      sql(
        preservedDatabase,
        'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
      ),
      String(freshIndex),
    );
    assert.equal(
      sql(
        preservedDatabase,
        'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL',
      ),
      '0',
    );
    sql(
      preservedDatabase,
      `SET session_replication_role=replica; DELETE FROM "${table}"`,
    );
  }
  console.log(
    'PASS: fresh-schema migration rejected each populated initial table without changing records, schema, or history.',
  );

  // Verify this role-only step rejects old role rows but preserves unrelated people/permissions.
  const roleMigration = '20261015190000_role_registry';
  const roleIndex = migrations.indexOf(roleMigration);
  assert(roleIndex > freshIndex);
  const roleDatabase = 'gdg_schema_test_role_guard';
  run('docker', ['exec', name, 'createdb', '-U', 'postgres', roleDatabase]);
  for (const migration of migrations.slice(0, roleIndex)) {
    sql(
      roleDatabase,
      readFileSync(
        join('prisma/migrations', migration, 'migration.sql'),
        'utf8',
      ),
    );
  }
  sql(
    roleDatabase,
    "INSERT INTO person(full_name) VALUES ('Preserved role-stage person'); INSERT INTO permissions(permission_name) VALUES ('preserved.permission')",
  );
  const roleSQL = readFileSync(
    join('prisma/migrations', roleMigration, 'migration.sql'),
    'utf8',
  );
  for (const [table, insert] of [
    ['roles', "INSERT INTO roles(role_name) VALUES ('Legacy role')"],
    [
      'role_permissions',
      'INSERT INTO role_permissions(role_id,permission_id) VALUES (1,1)',
    ],
  ]) {
    sql(roleDatabase, `SET session_replication_role=replica; ${insert}`);
    const beforeSchema = schemaDump(roleDatabase);
    const beforeRows = domainRows(roleDatabase);
    assert.throws(
      () => sql(roleDatabase, roleSQL),
      /role_registry_requires_empty_role_tables/,
    );
    assert.equal(schemaDump(roleDatabase), beforeSchema);
    assert.deepEqual(domainRows(roleDatabase), beforeRows);
    sql(
      roleDatabase,
      `SET session_replication_role=replica; DELETE FROM "${table}"`,
    );
  }
  sql(roleDatabase, roleSQL);
  assert.equal(
    sql(roleDatabase, 'SELECT full_name FROM person'),
    'Preserved role-stage person',
  );
  assert.equal(
    sql(roleDatabase, 'SELECT permission_name FROM permissions'),
    'preserved.permission',
  );
  assert.equal(sql(roleDatabase, 'SELECT count(*) FROM role'), '3');
  console.log(
    'PASS: role migration preserves unrelated records and rejects each populated legacy role table.',
  );

  function verifyFailure(source, history, database, expected) {
    run('docker', ['exec', name, 'createdb', '-U', 'postgres', database]);
    const target = history.at(-1);
    const predecessors = history.slice(0, -1);
    const failureRoot = join(scratch, database, 'prisma');
    copyMigrationHistory(source, failureRoot, predecessors);
    const config = join(scratch, database, 'prisma.config.ts');
    // Config contains no credentials and uses only the runner-owned URL.
    writeFileSync(
      config,
      `export default { schema: ${JSON.stringify(join(failureRoot, 'schema.prisma'))}, migrations: { path: ${JSON.stringify(join(failureRoot, 'migrations'))} }, datasource: { url: process.env.DATABASE_URL } };\n`,
    );
    const args = ['exec', 'prisma', 'migrate', 'deploy', '--config', config];
    if (predecessors.length) {
      run('pnpm', args, { DATABASE_URL: url(database) });
      // Separate schema: the sentinel never changes the expected project-table manifest.
      sql(
        database,
        "CREATE SCHEMA runner_fixture; CREATE TABLE runner_fixture.preserved(id integer PRIMARY KEY, value text NOT NULL); INSERT INTO runner_fixture.preserved VALUES (1, 'preserved')",
      );
    }
    const beforeSchema = schemaDump(database);
    const beforeRows = domainRows(database);
    const original = readFileSync(
      join(source, 'migrations', target, 'migration.sql'),
      'utf8',
    );
    const targetDirectory = join(failureRoot, 'migrations', target);
    mkdirSync(targetDirectory, { recursive: true });
    const targetFile = join(targetDirectory, 'migration.sql');
    const injected = injectMigrationFailure(original);
    writeFileSync(
      targetFile,
      predecessors.length
        ? injected.replace(
            'SELECT 1 / 0;',
            "UPDATE runner_fixture.preserved SET value = 'changed';\nSELECT 1 / 0;",
          )
        : injected,
    );
    let failed = false;
    try {
      run('pnpm', args, { DATABASE_URL: url(database) });
    } catch (error) {
      assert.match(
        error.message,
        /division by zero|current transaction is aborted/,
      );
      failed = true;
    }
    assert(failed, 'Injected migration failure must be observed');
    assert.equal(
      schemaDump(database),
      beforeSchema,
      'Failed migration changed the previous schema',
    );
    assert.deepEqual(
      domainRows(database),
      beforeRows,
      'Failed migration changed previous domain data',
    );
    if (predecessors.length)
      assert.equal(
        sql(database, 'SELECT value FROM runner_fixture.preserved WHERE id=1'),
        'preserved',
      );

    function assertHistory(recovered) {
      for (const migration of history) {
        // Names come only from repository migration directories or the runner-owned probe.
        const escaped = migration.replaceAll("'", "''");
        assert.equal(
          sql(
            database,
            `SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) || ':' || count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) || ':' || count(*) FILTER (WHERE rolled_back_at IS NOT NULL) FROM _prisma_migrations WHERE migration_name='${escaped}'`,
          ),
          migration === target ? (recovered ? '1:0:1' : '0:1:0') : '1:0:0',
          `Unexpected history for ${migration}`,
        );
      }
    }
    assertHistory(false);
    console.log(
      `PASS: ${target} failure preserved predecessor schema/data and recorded failed history.`,
    );
    writeFileSync(targetFile, original);
    run(
      'pnpm',
      [
        'exec',
        'prisma',
        'migrate',
        'resolve',
        '--rolled-back',
        target,
        '--config',
        config,
      ],
      { DATABASE_URL: url(database) },
    );
    run('pnpm', args, { DATABASE_URL: url(database) });
    assertHistory(true);
    assertTables(database, expected);
    if (predecessors.length)
      assert.equal(
        sql(database, 'SELECT value FROM runner_fixture.preserved WHERE id=1'),
        'preserved',
      );
    assert.match(
      run('pnpm', args, { DATABASE_URL: url(database) }),
      /No pending migrations/,
    );
    console.log(
      `PASS: ${target} recovery succeeded; repeat deploy is a no-op.`,
    );
  }

  verifyFailure(
    'prisma',
    migrations.slice(0, 1),
    'gdg_schema_test_initial_failure',
    initialTables,
  );
  if (migrations.length > 1) {
    verifyFailure(
      'prisma',
      migrations,
      'gdg_schema_test_latest_failure',
      expectedTables,
    );
  }
  // Exercise multiple migrations even while the repository has only its initial migration.
  const probeRoot = join(scratch, 'probe');
  copyMigrationHistory('prisma', probeRoot, migrations);
  const probe = '99999999999999_runner_probe';
  assert(
    probe > migrations.at(-1),
    'Probe must sort after committed migrations',
  );
  mkdirSync(join(probeRoot, 'migrations', probe));
  writeFileSync(
    join(probeRoot, 'migrations', probe, 'migration.sql'),
    'BEGIN;\nCREATE TABLE runner_probe(id integer PRIMARY KEY);\nINSERT INTO runner_probe VALUES (1);\nCOMMIT;\n',
  );
  verifyFailure(
    probeRoot,
    [...migrations, probe],
    'gdg_schema_test_probe_failure',
    [...expectedTables, 'runner_probe'],
  );
  assert.equal(
    sql('gdg_schema_test_probe_failure', 'SELECT id FROM runner_probe'),
    '1',
  );
  console.log(run('pnpm', ['test:e2e'], testEnv));
  if (process.argv.includes('--performance')) {
    const database = 'gdg_schema_test_performance';
    run('docker', ['exec', name, 'createdb', '-U', 'postgres', database]);
    run('pnpm', ['prisma:migrate:deploy'], { DATABASE_URL: url(database) });
    sql(database, readFileSync('test/schema-performance.sql', 'utf8'));
    assert.equal(
      sql(database, 'SELECT count(*) FROM event_registrations'),
      '41300',
    );
    const measurements = [];
    for (const [eventId, size] of [
      [101, 100],
      [102, 400],
      [103, 800],
    ]) {
      assert.equal(
        sql(
          database,
          `SELECT count(*) FROM event_registrations WHERE event_id=${eventId}`,
        ),
        String(size),
      );
      const cursor = sql(
        database,
        `SELECT min(registration_id) FROM event_registrations WHERE person_id=1`,
      );
      const queries = {
        'PR status page': `SELECT registration_id,person_id,status FROM event_registrations WHERE event_id=${eventId} AND status='PENDING' ORDER BY registered_at,registration_id LIMIT 50`,
        'My Events cursor page': `SELECT registration_id,event_id,status FROM event_registrations WHERE person_id=1 AND (registered_at,registration_id) > (SELECT registered_at,registration_id FROM event_registrations WHERE registration_id=${cursor}) ORDER BY registered_at,registration_id LIMIT 50`,
        'Reserved seats': `SELECT count(*) FROM event_registrations WHERE event_id=${eventId} AND status IN ('AWAITING_CONFIRMATION','CONFIRMED')`,
        'Next waitlist entry': `SELECT registration_id,person_id FROM event_registrations WHERE event_id=${eventId} AND status='WAITLISTED' ORDER BY waitlist_position LIMIT 1`,
        'Expiry batch': `SELECT registration_id,event_id FROM event_registrations WHERE status='AWAITING_CONFIRMATION' AND confirmation_deadline <= now() ORDER BY confirmation_deadline,registration_id LIMIT 50`,
        'Due events': `SELECT event_id FROM events WHERE status='published' AND ends_at<=now() ORDER BY ends_at,event_id LIMIT 50`,
        'Token lookup': `SELECT registration_id,event_id,status FROM event_registrations WHERE attendance_token_hash=md5('${eventId}:5')`,
        Questions: `SELECT question_id,question_text,question_type FROM event_questions WHERE event_id=${eventId} ORDER BY position`,
        'Warning flags page': `SELECT r.registration_id,r.person_id,COALESCE((SELECT true FROM event_registrations history JOIN registration_blacklist_entries b ON b.registration_id=history.registration_id WHERE history.person_id=r.person_id AND b.resolved_at IS NULL LIMIT 1),false) AS has_notice FROM event_registrations r WHERE r.event_id=${eventId} ORDER BY r.registered_at,r.registration_id LIMIT 50`,
      };
      assert.equal(
        sql(database, queries['Reserved seats']),
        String((size * 2) / 5),
      );
      assert.equal(
        sql(database, `SELECT count(*) FROM (${queries['Due events']}) q`),
        '1',
      );
      assert.equal(
        sql(database, `SELECT count(*) FROM (${queries['Questions']}) q`),
        '5',
      );
      assert.equal(
        sql(database, `SELECT count(*) FROM (${queries['Token lookup']}) q`),
        '1',
      );
      for (const [query, statement] of Object.entries(queries)) {
        const plan = JSON.parse(
          sql(database, `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`),
        )[0];
        const nodes = [];
        const walk = (node) => {
          nodes.push(node);
          for (const child of node.Plans ?? []) walk(child);
        };
        walk(plan.Plan);
        assert(Number.isFinite(plan['Execution Time']));
        measurements.push({
          eventSize: size,
          query,
          milliseconds: plan['Execution Time'],
          estimatedRows: plan.Plan['Plan Rows'],
          actualRows: plan.Plan['Actual Rows'],
          rowsVisited: nodes
            .filter((node) => node['Relation Name'])
            .reduce(
              (sum, node) =>
                sum +
                ((node['Actual Rows'] ?? 0) +
                  (node['Rows Removed by Filter'] ?? 0) +
                  (node['Rows Removed by Index Recheck'] ?? 0)) *
                  (node['Actual Loops'] ?? 1),
              0,
            ),
          sharedHitBlocks: plan.Plan['Shared Hit Blocks'] ?? 0,
          sharedReadBlocks: plan.Plan['Shared Read Blocks'] ?? 0,
          indexes: [
            ...new Set(nodes.map((node) => node['Index Name']).filter(Boolean)),
          ],
          sequentialScans: nodes
            .filter((node) => node['Node Type'] === 'Seq Scan')
            .map((node) => node['Relation Name']),
        });
      }
    }
    console.log(
      'PERFORMANCE_RESULTS ' +
        JSON.stringify({
          postgres: sql(database, 'SELECT version()'),
          docker: run('docker', [
            'info',
            '--format',
            '{{.NCPU}} CPUs / {{.MemTotal}} bytes',
          ]).trim(),
          measurements,
        }),
    );
    console.log(
      'PASS: representative query plans recorded; these are single-query timings, not API throughput or capacity guarantees.',
    );
  }

  if (process.argv.includes('--startup')) {
    const config = JSON.parse(
      run('docker', [
        'compose',
        '-f',
        'docker-compose.yml',
        '-f',
        'compose.platform.yml',
        'config',
        '--no-interpolate',
        '--format',
        'json',
      ]),
    );
    const command = config.services.backend.command;
    assert.deepEqual(command, [
      'sh',
      '-c',
      'pnpm prisma:migrate:deploy && exec pnpm start:dev',
    ]);
    console.log('Building isolated backend image for startup verification.');
    run('docker', ['build', '-t', image, '.']);
    imageBuilt = true;
    const startupDb = 'gdg_schema_test_startup';
    run('docker', ['exec', name, 'createdb', '-U', 'postgres', startupDb]);
    const startBackend = () => {
      run(
        'docker',
        [
          'run',
          '--detach',
          '--network',
          name,
          '--name',
          backendName,
          '-e',
          'DATABASE_URL',
          '-e',
          'PORT=3001',
          '-p',
          '127.0.0.1::3001',
          image,
          ...command,
        ],
        {
          DATABASE_URL: url(startupDb).replace(
            `127.0.0.1:${port}`,
            `${name}:5432`,
          ),
        },
      );
      backendStarted = true;
      return run('docker', ['port', backendName, '3001/tcp'])
        .trim()
        .split(':')
        .at(-1);
    };
    const stopBackend = () => {
      run('docker', ['rm', '--force', backendName]);
      backendStarted = false;
    };
    const waitForHttp = async (backendPort) => {
      for (let attempt = 0; attempt < 120; attempt++) {
        try {
          const response = await fetch(`http://127.0.0.1:${backendPort}`, {
            signal: AbortSignal.timeout(1000),
          });
          if (response.ok && (await response.text()) === 'Hello World!') return;
        } catch {
          /* Server may still be migrating or compiling. */
        }
        await delay(500);
      }
      throw new Error('Isolated backend did not become HTTP ready');
    };
    await waitForHttp(startBackend());
    assertTables(startupDb, expectedTables);
    sql(
      startupDb,
      "INSERT INTO person(full_name,email_personal) VALUES ('Preserved fixture','preserved@example.test')",
    );
    stopBackend();
    await waitForHttp(startBackend());
    assert.equal(
      sql(
        startupDb,
        "SELECT count(*) FROM person WHERE email_personal='preserved@example.test'",
      ),
      '1',
    );
    stopBackend();
    // A separate incompatible database must fail before the application command runs.
    sql('postgres', 'CREATE DATABASE gdg_schema_test_incompatible');
    sql(
      'gdg_schema_test_incompatible',
      'CREATE TABLE incompatible_fixture(id integer)',
    );
    run(
      'docker',
      [
        'run',
        '--detach',
        '--network',
        name,
        '--name',
        backendName,
        '-e',
        'DATABASE_URL',
        '-e',
        'PORT=3001',
        image,
        ...command,
      ],
      {
        DATABASE_URL: url('gdg_schema_test_incompatible').replace(
          `127.0.0.1:${port}`,
          `${name}:5432`,
        ),
      },
    );
    backendStarted = true;
    const exit = run('docker', ['wait', backendName]).trim();
    assert.notEqual(exit, '0');
    const failedLogs = spawnSync('docker', ['logs', backendName], {
      encoding: 'utf8',
    });
    assert.equal(failedLogs.status, 0);
    assert.match(`${failedLogs.stdout}${failedLogs.stderr}`, /P3005|not empty/);
    assert.doesNotMatch(
      `${failedLogs.stdout}${failedLogs.stderr}`,
      /nest start|Nest application successfully started/,
    );
    stopBackend();
    console.log(
      'PASS: Docker startup migrates before HTTP readiness, preserves data on restart, and fails closed on incompatible schema.',
    );
  }
} finally {
  try {
    if (backendStarted) run('docker', ['rm', '--force', backendName]);
    if (started) run('docker', ['rm', '--force', name]);
    if (networkStarted) run('docker', ['network', 'rm', name]);
    if (imageBuilt) run('docker', ['image', 'rm', '--force', image]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
