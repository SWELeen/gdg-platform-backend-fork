export function schemaTestTarget(
  value?: string,
  applicationUrl?: string,
  options: { allowSupabaseTestProject?: boolean } = {},
): string {
  const message = 'Use a separate local gdg_schema_test_ database or the explicitly allow-listed Supabase test project';
  try {
    const target = new URL(value ?? '');
    const isPostgres = ['postgresql:', 'postgres:'].includes(target.protocol);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
    const allowedParams = [...target.searchParams.keys()].every((key) => ['schema', 'sslmode'].includes(key)) &&
      target.searchParams.getAll('schema').length <= 1 &&
      (!target.searchParams.has('schema') || target.searchParams.get('schema') === 'public') &&
      (!target.searchParams.has('sslmode') || target.searchParams.get('sslmode') === 'require');
    const localTarget = local && /^\/gdg_schema_test_[a-z0-9_]+$/.test(target.pathname);

    const directRef = target.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/)?.[1];
    const poolerRef = target.hostname.endsWith('.pooler.supabase.com')
      ? target.username.match(/^postgres\.([a-z0-9]{20})$/)?.[1]
      : undefined;
    const remoteRef = directRef ?? poolerRef;
    const testRef = process.env.SUPABASE_TEST_PROJECT_REF;
    const forbiddenRefs = (process.env.SUPABASE_FORBIDDEN_PROJECT_REFS ?? '')
      .split(',').map((ref) => ref.trim()).filter(Boolean);
    const remoteTestTarget = options.allowSupabaseTestProject === true &&
      Boolean(remoteRef) &&
      remoteRef === testRef &&
      Boolean(testRef) &&
      new Set(forbiddenRefs).size >= 2 &&
      forbiddenRefs.every((ref) => /^[a-z0-9]{20}$/.test(ref)) &&
      !forbiddenRefs.includes(testRef!) &&
      target.pathname === '/postgres' &&
      target.port === '5432' &&
      target.searchParams.get('sslmode') === 'require';

    const sameDatabase = applicationUrl && target.pathname === new URL(applicationUrl).pathname;
    if (!isPostgres || !allowedParams || target.hash ||
      !(localTarget || remoteTestTarget) ||
      (sameDatabase && !remoteTestTarget)) {
      throw new Error(message);
    }
    return target.toString();
  } catch {
    throw new Error(message);
  }
}
