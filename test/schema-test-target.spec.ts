import { schemaTestTarget } from './schema-test-target.js';

const safe =
  'postgresql://tester:example@127.0.0.1:5432/gdg_schema_test_a?schema=public';

describe('isolated schema database guard', () => {
  it('accepts an explicitly named local disposable database', () => {
    expect(schemaTestTarget(safe)).toBe(safe);
  });

  it.each([
    undefined,
    '',
    'not-a-url',
    'mysql://tester:example@localhost:5432/gdg_schema_test_a',
    'postgresql://tester:example@remote.example:5432/gdg_schema_test_a',
    'postgresql://tester:example@127.0.0.1:5432/gdg_platform',
    'postgresql://tester:example@127.0.0.1:5432/gdg_schema_test_',
    'postgresql://tester:example@127.0.0.1:5432/gdg_schema_test_a?schema=private',
    'postgresql://tester:example@127.0.0.1:5432/gdg_schema_test_a?options=anything',
  ])(
    'rejects unsafe or missing targets without echoing credentials',
    (value) => {
      expect(() => schemaTestTarget(value)).toThrow(
        'Use a separate local gdg_schema_test_ database',
      );
    },
  );

  it('rejects the application database even with a different host alias', () => {
    expect(() =>
      schemaTestTarget(
        safe,
        'postgresql://user:secret@localhost:1234/gdg_schema_test_a',
      ),
    ).toThrow('separate');
  });

  it('allows only the explicitly configured, non-shared Supabase test project', () => {
    const originalTestRef = process.env.SUPABASE_TEST_PROJECT_REF;
    const originalForbiddenRefs = process.env.SUPABASE_FORBIDDEN_PROJECT_REFS;
    const testRef = 'abcdefghijklmnopqrst';
    process.env.SUPABASE_TEST_PROJECT_REF = testRef;
    process.env.SUPABASE_FORBIDDEN_PROJECT_REFS = 'uvwxyzabcdefghijklmn,12345678901234567890';
    const remote = `postgresql://postgres:redacted@db.${testRef}.supabase.co:5432/postgres?sslmode=require`;
    try {
      expect(schemaTestTarget(remote, remote, { allowSupabaseTestProject: true })).toBe(remote);
      expect(() => schemaTestTarget(remote, remote)).toThrow('allow-listed');
      process.env.SUPABASE_FORBIDDEN_PROJECT_REFS = `${testRef},12345678901234567890`;
      expect(() => schemaTestTarget(remote, remote, { allowSupabaseTestProject: true })).toThrow('allow-listed');
    } finally {
      if (originalTestRef === undefined) delete process.env.SUPABASE_TEST_PROJECT_REF;
      else process.env.SUPABASE_TEST_PROJECT_REF = originalTestRef;
      if (originalForbiddenRefs === undefined) delete process.env.SUPABASE_FORBIDDEN_PROJECT_REFS;
      else process.env.SUPABASE_FORBIDDEN_PROJECT_REFS = originalForbiddenRefs;
    }
  });
});
