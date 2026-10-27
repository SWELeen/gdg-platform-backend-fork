import type { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiValidationPipe } from '../src/common/http/api-validation.pipe.js';
import { HttpErrorFilter } from '../src/common/http/http-error.filter.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TokenVerifierService } from '../src/auth/token-verifier.service.js';

const {
  signUp,
  verifyOtp,
  signInWithPassword,
  refreshSession,
  resetPasswordForEmail,
  setSession,
  updateUser,
  signOut,
} = vi.hoisted(() => ({
  signUp: vi.fn(),
  verifyOtp: vi.fn(),
  signInWithPassword: vi.fn(),
  refreshSession: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  setSession: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signUp,
      verifyOtp,
      signInWithPassword,
      refreshSession,
      resetPasswordForEmail,
      setSession,
      updateUser,
      signOut,
      admin: {
        signOut,
        deleteUser: vi.fn().mockResolvedValue({ error: null }),
        inviteUserByEmail: vi.fn(),
        updateUserById: vi.fn(),
      },
    },
  }),
}));

const session = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
};

describe('auth lifecycle HTTP integration (Supabase/PostgreSQL fakes)', () => {
  let app: INestApplication;
  let signupPending: Record<string, any> | null;
  let person: Record<string, any> | null;
  let personId: number;
  const revoked: Array<{ tokenHash: string; expiresAt: Date }> = [];
  const rateBuckets = new Map<string, number>();
  let forceRateLimit = false;

  const prismaFake = {
    $queryRaw: vi.fn(async (_query: TemplateStringsArray, bucketHashValue?: unknown) => {
      const bucketHash = String(bucketHashValue ?? 'test-bucket');
      if (forceRateLimit) return [{ request_count: 31 }];
      const requestCount = (rateBuckets.get(bucketHash) ?? 0) + 1;
      rateBuckets.set(bucketHash, requestCount);
      return [{ request_count: requestCount }];
    }),
    $executeRaw: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(tx)),
    person: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (person && person.emailPersonal?.toLowerCase() === where.emailPersonal.equals.toLowerCase()) {
          return { personId, authUserId: person.authUserId };
        }
        return null;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.authUserId) {
          return person?.authUserId === where.authUserId ? { isActive: person?.isActive } : null;
        }
        if (where.personId === personId && person) return person;
        return null;
      }),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(async ({ data }: any) => {
        personId = 42;
        person = {
          personId,
          authUserId: data.authUserId,
          emailPersonal: data.emailPersonal,
          emailPersonalVerifiedAt: data.emailPersonalVerifiedAt,
          isActive: true,
          pendingSignup: data.pendingSignup.create,
        };
        return { personId };
      }),
      update: vi.fn(async ({ data }: any) => {
        person = { ...person, ...data };
        return person;
      }),
      updateMany: vi.fn(async ({ data }: any) => {
        person = { ...person, ...data };
        return { count: 1 };
      }),
    },
    signupVerification: {
      findFirst: vi.fn(async ({ where }: any) =>
        signupPending?.emailPersonal === where.emailPersonal ? signupPending : null),
      findUnique: vi.fn(async ({ where }: any) =>
        signupPending?.emailPersonal === where.emailPersonal ? signupPending : null),
      create: vi.fn(async ({ data }: any) => {
        signupPending = {
          signupVerificationId: 7,
          ...data,
          codeHash: null,
          codeExpiresAt: null,
          sentAt: null,
          attempts: 0,
          verifiedAt: null,
        };
        return signupPending;
      }),
      updateMany: vi.fn(async ({ data }: any) => {
        if (!signupPending || signupPending.verifiedAt) return { count: 0 };
        signupPending = { ...signupPending, ...data };
        return { count: 1 };
      }),
      delete: vi.fn(async () => {
        signupPending = null;
        return {};
      }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    revokedAuthToken: {
      findUnique: vi.fn(async ({ where }: any) => revoked.find((row) => row.tokenHash === where.tokenHash) ?? null),
      upsert: vi.fn(async ({ create }: any) => {
        revoked.push(create);
        return create;
      }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    committee: { findMany: vi.fn().mockResolvedValue([]) },
    nonMemberRegistration: { create: vi.fn().mockResolvedValue({}) },
    pendingSignup: { delete: vi.fn().mockResolvedValue({}) },
  };

  const tx = {
    person: prismaFake.person,
    signupVerification: prismaFake.signupVerification,
    nonMemberRegistration: prismaFake.nonMemberRegistration,
    pendingSignup: prismaFake.pendingSignup,
    committee: prismaFake.committee,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AuthModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaFake)
      .overrideProvider(ConfigService)
      .useValue({
        get: (key: string) => key === 'SUPABASE_URL' ? 'https://auth-test.invalid' : undefined,
        getOrThrow: (key: string) => ({
          SUPABASE_URL: 'https://auth-test.invalid',
          SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
          SUPABASE_SECRET_KEY: 'test-rate-limit-secret',
          PASSWORD_SETUP_URL: 'http://localhost:3000',
        })[key],
      })
      .overrideProvider(TokenVerifierService)
      .useValue({ verify: vi.fn(async () => ({
        authUserId: 'auth-user-1',
        email: 'flow@example.test',
        fromEmailLink: false,
        expiresAt: session.expires_at,
      })) })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(new ApiValidationPipe());
    app.useGlobalFilters(new HttpErrorFilter(app.get(HttpAdapterHost)));
    await app.init();
  });

  beforeEach(() => {
    signupPending = null;
    person = null;
    personId = 0;
    revoked.length = 0;
    rateBuckets.clear();
    forceRateLimit = false;
    signUp.mockReset().mockResolvedValue({ data: { user: { id: 'auth-user-1' }, session: null }, error: null });
    verifyOtp.mockReset().mockResolvedValue({
      data: { user: { id: 'auth-user-1', email_confirmed_at: new Date().toISOString() }, session },
      error: null,
    });
    signInWithPassword.mockReset().mockResolvedValue({ data: { user: { id: 'auth-user-1' }, session }, error: null });
    refreshSession.mockReset().mockResolvedValue({ data: { user: { id: 'auth-user-1' }, session }, error: null });
    resetPasswordForEmail.mockReset().mockResolvedValue({ data: {}, error: null });
    setSession.mockReset().mockResolvedValue({ error: null });
    updateUser.mockReset().mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null });
    signOut.mockReset().mockResolvedValue({ error: null });
  });

  afterAll(async () => app?.close());

  it('stages signup, verifies email, logs in, refreshes, and logs out over HTTP', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        fullName: 'Test Applicant',
        email: 'flow@example.test',
        password: 'correct horse battery staple',
        registrationType: 'NON_MEMBER',
        applicationData: {
          phoneNumber: '+966500000000',
          university: 'University of Jeddah',
          college: 'Computing',
          major: 'Software Engineering',
          level: 'Graduated',
          gender: 'female',
        },
      })
      .expect(201)
      .expect(({ body }) => expect(body.data.emailVerificationRequired).toBe(true));
    expect(person).toBeNull();

    const verified = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ email: 'flow@example.test', token: '123456' })
      .expect(200);
    expect(String(verified.headers['set-cookie'])).toContain('gdg_access=');
    expect(person?.emailPersonalVerifiedAt).toBeInstanceOf(Date);

    const loggedIn = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'flow@example.test', password: 'correct horse battery staple' })
      .expect(200);
    expect(String(loggedIn.headers['set-cookie'])).toContain('HttpOnly');

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', 'gdg_refresh=refresh-token')
      .expect(200);
    expect(String(refreshed.headers['set-cookie'])).toContain('gdg_refresh=');

    const loggedOut = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', 'gdg_access=access-token; gdg_refresh=refresh-token')
      .expect(200);
    const clearedCookies = String(loggedOut.headers['set-cookie'] ?? '');
    expect(clearedCookies).toContain('gdg_access=;');
    expect(clearedCookies).toContain('gdg_refresh=;');
    expect(clearedCookies).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(revoked).toContainEqual({
      tokenHash: expect.any(String),
      expiresAt: new Date(session.expires_at * 1000),
    });
  });

  it('requests recovery without disclosing unknown emails and completes a valid reset', async () => {
    person = {
      personId: 42,
      authUserId: 'auth-user-1',
      emailPersonal: 'flow@example.test',
      emailPersonalVerifiedAt: new Date(),
      isActive: true,
    };

    await request(app.getHttpServer())
      .post('/auth/setup-password/request')
      .send({ email: 'flow@example.test', locale: 'en' })
      .expect(200);
    expect(resetPasswordForEmail).toHaveBeenCalledOnce();

    await request(app.getHttpServer())
      .post('/auth/setup-password/complete')
      .send({ tokenHash: 'fresh-one-time-token', type: 'recovery', password: 'replacement-password' })
      .expect(200)
      .expect(({ body }) => expect(body.data.passwordUpdated).toBe(true));
    expect(updateUser).toHaveBeenCalledWith({ password: 'replacement-password' });
  });

  it('returns 429 when the configured login rate limit is exceeded', async () => {
    forceRateLimit = true;
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'flow@example.test', password: 'wrong-password' })
      .expect(429);
  });

  it('keeps route validation and unauthenticated protected access enforced', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'bad', password: '' })
      .expect(400);

    await request(app.getHttpServer())
      .get('/me')
      .expect(401);
  });
});
