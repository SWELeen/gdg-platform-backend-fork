import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const envFile = fileURLToPath(new URL('../.env.test.local', import.meta.url));
const loaded = config({ path: envFile, override: true, quiet: true });

function fail(message) {
  console.error(`Supabase test target rejected: ${message}`);
  process.exit(1);
}

if (loaded.error) fail('copy .env.test.example to .env.test.local and configure it.');
if (process.env.NODE_ENV === 'production') fail('NODE_ENV must not be production.');

const testRef = process.env.SUPABASE_TEST_PROJECT_REF?.trim();
const forbiddenRefs = (process.env.SUPABASE_FORBIDDEN_PROJECT_REFS ?? '')
  .split(',').map((ref) => ref.trim()).filter(Boolean);
const rawUrl = process.env.SUPABASE_TEST_DATABASE_URL?.trim();
if (!testRef || !/^[a-z0-9]{20}$/.test(testRef)) fail('set the dedicated test project reference.');
if (new Set(forbiddenRefs).size < 2 || forbiddenRefs.some((ref) => !/^[a-z0-9]{20}$/.test(ref))) {
  fail('list the production and shared development project references.');
}
if (forbiddenRefs.includes(testRef)) fail('the test project reference matches a forbidden project.');
if (!rawUrl || /REPLACE|\[.*\]/i.test(rawUrl)) fail('set the PostgreSQL URI for the test project.');

let target;
try {
  target = new URL(rawUrl);
} catch {
  fail('the test database URI is invalid.');
}

const directRef = target.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/)?.[1];
const poolerRef = target.hostname.endsWith('.pooler.supabase.com')
  ? target.username.match(/^postgres\.([a-z0-9]{20})$/)?.[1]
  : undefined;
const connectedRef = directRef ?? poolerRef;
if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
    connectedRef !== testRef || forbiddenRefs.includes(connectedRef) ||
    target.pathname !== '/postgres' || target.port !== '5432' ||
    target.searchParams.get('sslmode') !== 'require' || !target.password) {
  fail('use the dedicated test project Direct or Session pooler URI (SSL required; not transaction mode).');
}

const mode = process.argv[2];
let args;
if (mode === 'migrate') {
  args = ['prisma:migrate:deploy'];
} else if (mode === 'all') {
  args = [];
} else {
  fail('choose the migrate or all command.');
}

const childEnv = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: target.toString(),
  TEST_DATABASE_URL: target.toString(),
  SUPABASE_TEST_PROJECT_REF: testRef,
  SUPABASE_FORBIDDEN_PROJECT_REFS: forbiddenRefs.join(','),
  ATTENDANCE_TOKEN_KEY: process.env.ATTENDANCE_TOKEN_KEY || randomBytes(32).toString('base64'),
};

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: childEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) fail('could not start the requested command.');
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (mode === 'migrate') {
  console.log(`Applying committed migrations to dedicated Supabase test project ${testRef}.`);
  run('pnpm', args);
} else {
  console.log(`Running backend tests against dedicated Supabase test project ${testRef}.`);
  run('pnpm', ['test']);
  run('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.config.supabase.ts']);
}
