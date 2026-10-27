import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AuthApiError } from '@supabase/supabase-js';
import { ApiValidationPipe } from '../common/http/api-validation.pipe.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AuthController } from './auth.controller.js';
import type { RequestUser } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CheckEmailDto } from './check-email.dto.js';
import { LoginDto } from './login.dto.js';
import { SetupPasswordDto } from './setup-password.dto.js';
import { SignupDto } from './signup.dto.js';

const {
  signInWithPassword,
  signUp,
  resend,
  resetPasswordForEmail,
  deleteUser,
  inviteUserByEmail,
  updateUserById,
  verifyOtp,
  setSession,
  updateUser,
  refreshSession,
  getUser,
  signOut,
} = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resend: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  deleteUser: vi.fn(),
  inviteUserByEmail: vi.fn(),
  updateUserById: vi.fn(),
  verifyOtp: vi.fn(),
  setSession: vi.fn(),
  updateUser: vi.fn(),
  refreshSession: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@supabase/supabase-js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@supabase/supabase-js')>()),
  createClient: () => ({
    auth: {
      signInWithPassword,
      signUp,
      resend,
      verifyOtp,
      setSession,
      updateUser,
      refreshSession,
      getUser,
      resetPasswordForEmail,
      admin: { deleteUser, inviteUserByEmail, updateUserById, signOut },
    },
  }),
}));

const findUniqueOrThrow = vi.fn();
const findFirst = vi.fn();
const findUnique = vi.fn();
const create = vi.fn();
const signupFindFirst = vi.fn();
const signupFindUnique = vi.fn();
const signupCreate = vi.fn();
const signupUpdateMany = vi.fn();
const signupDelete = vi.fn();
const signupDeleteMany = vi.fn();
const updateMany = vi.fn();
const update = vi.fn();
const deletePerson = vi.fn();
const transaction = vi.fn();
const cookie = vi.fn();
const response = { cookie, clearCookie: vi.fn() };
const controller = new AuthController(
  new AuthService(
    {
      person: { findUniqueOrThrow, findFirst, findUnique, create, updateMany, update, delete: deletePerson },
      signupVerification: {
        findFirst: signupFindFirst,
        findUnique: signupFindUnique,
        create: signupCreate,
        updateMany: signupUpdateMany,
        delete: signupDelete,
        deleteMany: signupDeleteMany,
      },
      $transaction: transaction,
    } as unknown as PrismaService,
    { getOrThrow: () => 'http://localhost:3000/en/reset-password' } as unknown as ConfigService,
  ),
);

const SESSION = {
  access_token: 'access',
  refresh_token: 'refresh',
  expires_at: 1790000000,
};
describe('POST /auth/login', () => {
  const body = { email: 'noura@example.test', password: 'correct-horse' };

  beforeEach(() => {
    signInWithPassword.mockReset().mockResolvedValue({
      data: {
        session: {
          access_token: 'access',
          refresh_token: 'refresh',
          expires_at: 1790000000,
        },
        user: { id: 'linked-auth-user' },
      },
      error: null,
    });
    findUnique.mockReset().mockResolvedValue({ isActive: true });
    signOut.mockReset().mockResolvedValue({ error: null });
    cookie.mockReset();
  });

  it('sets httpOnly session cookies instead of returning provider tokens', async () => {
    const result = await controller.login(body, response as never);

    expect(signInWithPassword).toHaveBeenCalledWith(body);
    expect(result).toEqual({
      success: true,
      message: 'OK',
      error: null,
      data: { authenticated: true },
    });
    expect(cookie).toHaveBeenCalledWith('gdg_access', 'access', expect.objectContaining({ httpOnly: true, sameSite: 'strict' }));
    expect(cookie).toHaveBeenCalledWith('gdg_refresh', 'refresh', expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/auth' }));
  });

  it('rejects a wrong email or password with 401', async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError(
        'Invalid login credentials',
        400,
        'invalid_credentials',
      ),
    });

    await expect(controller.login(body, response as never)).rejects.toThrow(UnauthorizedException);
  });

  it('resends personal verification and returns the code-entry flow for an unconfirmed account', async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthApiError('Email not confirmed', 400, 'email_not_confirmed'),
    });
    signupFindUnique.mockReset().mockResolvedValue({
      emailPersonal: body.email,
      verifiedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      codeHash: null,
    });
    resend.mockReset().mockResolvedValue({ error: null });

    await expect(controller.login(body, response as never)).rejects.toMatchObject({ errorCode: 'EMAIL_NOT_VERIFIED' });
    expect(resend).toHaveBeenCalledWith({ type: 'signup', email: body.email });
  });

  it('does not issue a session to an unlinked or inactive local account', async () => {
    findUnique.mockResolvedValue({ isActive: false });
    await expect(controller.login(body, response as never)).rejects.toThrow(UnauthorizedException);
    expect(signOut).toHaveBeenCalledWith('access', 'local');
    expect(cookie).not.toHaveBeenCalledWith('gdg_access', expect.anything(), expect.anything());
  });

  it('passes other supabase failures on instead of hiding them as 401', async () => {
    const rateLimited = new AuthApiError(
      'Request rate limit reached',
      429,
      'over_request_rate_limit',
    );
    signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: rateLimited,
    });

    await expect(controller.login(body, response as never)).rejects.toThrow(HttpException);
  });

  it.each([
    { name: 'missing password', input: { email: body.email } },
    { name: 'empty password', input: { ...body, password: '' } },
    { name: 'invalid email', input: { ...body, email: 'not-an-email' } },
    { name: 'extra fields', input: { ...body, role: 'GROUP_LEADER' } },
  ])('rejects a body with $name', async ({ input }) => {
    await expect(
      new ApiValidationPipe().transform(input, {
        type: 'body',
        metatype: LoginDto,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a valid body', async () => {
    await expect(
      new ApiValidationPipe().transform(body, {
        type: 'body',
        metatype: LoginDto,
      }),
    ).resolves.toEqual(body);
  });
});

describe('POST /auth/check-email', () => {
  const body = { email: 'Noura@Example.test' };

  it.each([
    { found: null, nextStep: 'SIGNUP_REQUIRED' },
    {
      found: { personId: 6, authUserId: null },
      nextStep: 'PASSWORD_SETUP_REQUIRED',
    },
    {
      found: { personId: 6, authUserId: 'linked-auth-user' },
      nextStep: 'PASSWORD_REQUIRED',
    },
  ])('answers $nextStep', async ({ found, nextStep }) => {
    findFirst.mockReset().mockResolvedValue(found);

    const response = await controller.checkEmail(body);

    expect(response.data).toEqual({ nextStep });
  });

  it('looks up accounts by personal email only, ignoring letter case', async () => {
    findFirst.mockReset().mockResolvedValue(null);

    await controller.checkEmail(body);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          emailPersonal: { equals: body.email, mode: 'insensitive' },
        },
      }),
    );
  });

  it.each([
    { name: 'missing email', input: {} },
    { name: 'invalid email', input: { email: 'nope' } },
  ])('rejects a body with $name', async ({ input }) => {
    await expect(
      new ApiValidationPipe().transform(input, {
        type: 'body',
        metatype: CheckEmailDto,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('POST /auth/signup', () => {
  const body = {
    fullName: '  Sara Visitor ',
    email: 'Sara@Example.test',
    password: 'correct-horse',
    registrationType: 'NON_MEMBER' as const,
    applicationData: {
      phoneNumber: '+966500000000', university: 'University of Jeddah', college: 'Computer Science',
      major: 'Computer Science', level: 'Level 4', gender: 'female',
    },
  };

  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue(null);
    create.mockReset().mockResolvedValue({ personId: 11 });
    signupFindFirst.mockReset().mockResolvedValue(null);
    signupCreate.mockReset().mockResolvedValue({ signupVerificationId: 12 });
    signupDeleteMany.mockReset().mockResolvedValue({ count: 0 });
    signUp.mockReset().mockResolvedValue({
      data: { user: { id: 'new-auth-user' }, session: null },
      error: null,
    });
    deleteUser.mockReset().mockResolvedValue({ data: {}, error: null });
  });

  it('stages signup data and waits for personal-email verification', async () => {
    const response = await controller.signup(body);

    expect(signUp).toHaveBeenCalledWith({
      email: body.email,
      password: body.password,
    });
    expect(signupCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        authUserId: 'new-auth-user',
        fullName: 'Sara Visitor',
        emailPersonal: 'sara@example.test',
        emailUniversity: null,
        registrationType: 'NON_MEMBER',
        committees: [],
        globalRoles: [],
      }),
    }));
    expect(response.data).toMatchObject({ emailVerificationRequired: true });
  });

  it('rejects an email a person already has, without touching supabase', async () => {
    findFirst.mockResolvedValue({ personId: 6 });

    await expect(controller.signup(body)).rejects.toThrow(ConflictException);
    expect(signUp).not.toHaveBeenCalled();
  });

  it('rejects matching personal and optional university emails', async () => {
    await expect(controller.signup({
      ...body,
      universityEmail: ' sara@EXAMPLE.test ',
    })).rejects.toMatchObject({ errorCode: 'EMAILS_MUST_DIFFER' });
    expect(signUp).not.toHaveBeenCalled();
  });

  it('rejects an email supabase already has', async () => {
    signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError(
        'User already registered',
        422,
        'user_already_exists',
      ),
    });

    await expect(controller.signup(body)).rejects.toThrow(ConflictException);
    expect(signupCreate).not.toHaveBeenCalled();
  });

  it('deletes the new account when the person row fails', async () => {
    const dbDown = new Error('database down');
    signupCreate.mockRejectedValue(dbDown);

    await expect(controller.signup(body)).rejects.toBe(dbDown);
    expect(deleteUser).toHaveBeenCalledWith('new-auth-user');
  });

  it('treats a duplicate email from a parallel signup as already existing', async () => {
    signupCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(controller.signup(body)).rejects.toThrow(ConflictException);
    expect(deleteUser).toHaveBeenCalledWith('new-auth-user');
  });

  it('rejects configuration that auto-confirms new accounts without sending a verification code', async () => {
    signUp.mockResolvedValue({
      data: { user: { id: 'new-auth-user' }, session: SESSION },
      error: null,
    });

    await expect(controller.signup(body)).rejects.toThrow();
    expect(deleteUser).toHaveBeenCalledWith('new-auth-user');
    expect(signupCreate).not.toHaveBeenCalled();
  });

  it('rejects Supabase’s obfuscated duplicate user instead of creating a ghost person', async () => {
    signUp.mockResolvedValue({
      data: { user: { id: 'existing-auth-user', identities: [] }, session: null },
      error: null,
    });

    await expect(controller.signup(body)).rejects.toThrow(ConflictException);
    expect(signupCreate).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'blank fullName', input: { ...body, fullName: '   ' } },
    { name: 'short password', input: { ...body, password: 'short' } },
    { name: 'invalid email', input: { ...body, email: 'nope' } },
    { name: 'extra fields', input: { ...body, memberId: 1 } },
  ])('rejects a body with $name', async ({ input }) => {
    await expect(
      new ApiValidationPipe().transform(input, {
        type: 'body',
        metatype: SignupDto,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('POST /auth/verify-email', () => {
  const body = { email: 'noura@example.test', token: '123456' };

  beforeEach(() => {
    verifyOtp.mockReset().mockResolvedValue({ data: { session: SESSION, user: { id: 'auth-user' } }, error: null });
    signupFindUnique.mockReset().mockResolvedValue({
      signupVerificationId: 10,
      authUserId: 'auth-user',
      emailPersonal: body.email,
      emailUniversity: 'student@university.test',
      fullName: 'Applicant',
      registrationType: 'NON_MEMBER',
      applicationData: { phoneNumber: '+966500000000', university: 'University', major: 'CS', gender: 'female' },
      committees: [],
      globalRoles: [],
      expiresAt: new Date(Date.now() + 60_000),
      verifiedAt: null,
      codeHash: null,
    });
    signupUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    signupDelete.mockReset().mockResolvedValue({});
    transaction.mockReset().mockImplementation(async (operation) => operation({
      signupVerification: { updateMany: signupUpdateMany, delete: signupDelete },
      person: {
        create: vi.fn().mockResolvedValue({ personId: 11 }),
        findUnique: vi.fn().mockResolvedValue({
          personId: 11,
          emailPersonalVerifiedAt: new Date(),
          pendingSignup: {
            expiresAt: new Date(Date.now() + 60_000),
            registrationType: 'NON_MEMBER',
            applicationData: { phoneNumber: '+966500000000', university: 'University', major: 'CS', gender: 'female' },
            committees: [],
            globalRoles: [],
          },
        }),
        update: vi.fn(),
      },
      nonMemberRegistration: { create: vi.fn() },
      pendingSignup: { delete: vi.fn() },
    }));
    update.mockReset().mockResolvedValue({ personId: 11 });
  });

  it('verifies the personal email even when an optional university email was supplied', async () => {
    await expect(controller.verifySignupEmail(body, response as never)).resolves.toMatchObject({ data: { authenticated: true } });
    expect(verifyOtp).toHaveBeenCalledWith({ ...body, type: 'email' });
  });

  it('rejects invalid verification codes', async () => {
    verifyOtp.mockResolvedValue({ data: { session: null }, error: new Error('invalid') });
    await expect(controller.verifySignupEmail(body, response as never)).rejects.toThrow(UnauthorizedException);
  });
});

describe('POST /auth/refresh', () => {
  beforeEach(() => {
    refreshSession.mockReset().mockResolvedValue({ data: { session: SESSION }, error: null });
  });

  it('returns a refreshed Supabase session', async () => {
    await expect(controller.refresh({ headers: { cookie: 'gdg_refresh=refresh' } } as never, response as never)).resolves.toMatchObject({ data: { authenticated: true } });
    expect(refreshSession).toHaveBeenCalledWith({ refresh_token: 'refresh' });
  });
});

describe('Supabase email confirmation check', () => {
  const auth = new AuthService(
    {} as PrismaService,
    { getOrThrow: () => 'test-value' } as unknown as ConfigService,
  );

  beforeEach(() => getUser.mockReset());

  it('requires Supabase to confirm the account email', async () => {
    getUser.mockResolvedValue({ data: { user: { email_confirmed_at: '2026-10-24T00:00:00Z' } }, error: null });
    await expect(auth.isEmailVerified('verified-token')).resolves.toBe(true);
    expect(getUser).toHaveBeenCalledWith('verified-token');
  });

  it('does not treat an unconfirmed account as verified', async () => {
    getUser.mockResolvedValue({ data: { user: { email_confirmed_at: null } }, error: null });
    await expect(auth.isEmailVerified('unverified-token')).resolves.toBe(false);
  });
});

describe('POST /auth/setup-password/request', () => {
  const body = { email: 'data.member@example.test' };

  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue({ personId: 8, authUserId: null });
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    inviteUserByEmail.mockReset().mockResolvedValue({
      data: { user: { id: 'invited-auth-user' } },
      error: null,
    });
    resetPasswordForEmail
      .mockReset()
      .mockResolvedValue({ data: {}, error: null });
    deleteUser.mockReset().mockResolvedValue({ data: {}, error: null });
  });

  it('invites a member who has no account and links it right away', async () => {
    const response = await controller.requestSetupLink(body);

    expect(inviteUserByEmail).toHaveBeenCalledWith(body.email, {
      redirectTo: 'http://localhost:3000/en/reset-password',
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { personId: 8, authUserId: null },
      data: { authUserId: 'invited-auth-user' },
    });
    expect(response).toMatchObject({ success: true, data: null });
  });

  it('sends a reset email to someone already linked', async () => {
    findFirst.mockResolvedValue({ personId: 8, authUserId: 'linked' });

    await controller.requestSetupLink(body);

    expect(resetPasswordForEmail).toHaveBeenCalledWith(body.email, {
      redirectTo: 'http://localhost:3000/en/reset-password',
    });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('answers 404 for an email nobody has', async () => {
    findFirst.mockResolvedValue(null);

    await expect(controller.requestSetupLink(body)).rejects.toThrow(
      NotFoundException,
    );
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('never links an existing supabase account by matching emails', async () => {
    inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('already registered', 422, 'email_exists'),
    });

    await expect(controller.requestSetupLink(body)).rejects.toThrow(
      ConflictException,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('answers 429 when supabase hits its email limit', async () => {
    inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('rate limit', 429, 'over_email_send_rate_limit'),
    });

    const failure = await controller.requestSetupLink(body).catch((e) => e);
    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(429);
  });

  it('deletes the invited account when linking fails', async () => {
    const dbDown = new Error('database down');
    updateMany.mockRejectedValue(dbDown);

    await expect(controller.requestSetupLink(body)).rejects.toBe(dbDown);
    expect(deleteUser).toHaveBeenCalledWith('invited-auth-user');
  });
});

describe('POST /auth/setup-password', () => {
  const body = { password: 'new-password-1' };
  const fromLink: RequestUser = {
    personId: 8,
    memberId: 10000007,
    fromEmailLink: true,
  };

  function setupAs(user?: RequestUser) {
    return controller.setupPassword({ user }, body, response as never);
  }

  beforeEach(() => {
    findUniqueOrThrow
      .mockReset()
      .mockResolvedValue({ authUserId: 'hala-auth' });
    updateUserById.mockReset().mockResolvedValue({
      data: { user: { email: 'data.member@example.test' } },
      error: null,
    });
    signInWithPassword.mockReset().mockResolvedValue({
      data: { session: SESSION, user: { id: 'linked-auth-user' } },
      error: null,
    });
    findUnique.mockReset().mockResolvedValue({ isActive: true });
  });

  it('sets the password and logs them in', async () => {
    const response = await setupAs(fromLink);

    expect(updateUserById).toHaveBeenCalledWith('hala-auth', {
      password: body.password,
    });
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'data.member@example.test',
      password: body.password,
    });
    expect(response.data).toEqual({ authenticated: true });
  });

  it('rejects visitors who are not logged in', async () => {
    await expect(setupAs()).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a normal login token, it must come from the email link', async () => {
    await expect(
      setupAs({ ...fromLink, fromEmailLink: false }),
    ).rejects.toThrow(ForbiddenException);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('rejects a password supabase finds too weak', async () => {
    updateUserById.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('weak', 422, 'weak_password'),
    });

    await expect(setupAs(fromLink)).rejects.toThrow(BadRequestException);
  });

  it('rejects a short password', async () => {
    await expect(
      new ApiValidationPipe().transform(
        { password: 'short' },
        { type: 'body', metatype: SetupPasswordDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

const NOURA = {
  fullName: 'Noura Demo',
  member: {
    committees: [
      {
        role: 'Leader',
        committee: { committeeCode: 'DATA', committeeName: 'Data' },
      },
    ],
    roleAssignments: [{ roleCode: 'ADVISOR' }],
  },
};

function meAs(user?: RequestUser) {
  return controller.me({ user });
}

beforeEach(() => {
  findUniqueOrThrow.mockReset().mockResolvedValue(NOURA);
});

describe('GET /me', () => {
  it('rejects visitors who are not logged in', async () => {
    await expect(meAs()).rejects.toThrow(UnauthorizedException);
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('returns a member with their committees and current roles', async () => {
    const response = await meAs({
      personId: 6,
      memberId: 10000005,
      email: 'noura@example.test',
    });

    expect(findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { personId: 6 } }),
    );
    expect(response).toEqual({
      success: true,
      message: 'OK',
      error: null,
      data: {
        personId: 6,
        memberId: 10000005,
        fullName: 'Noura Demo',
        email: 'noura@example.test',
        committees: [{ code: 'DATA', name: 'Data', position: 'Leader' }],
        roles: ['ADVISOR'],
        membershipRequestPending: false,
      },
    });
  });

  it('returns no committees or roles for someone who is not a member', async () => {
    findUniqueOrThrow.mockResolvedValue({ fullName: 'Visitor', member: null });

    const response = await meAs({ personId: 11, memberId: null });

    expect(response.data).toEqual({
      personId: 11,
      memberId: null,
      fullName: 'Visitor',
      email: null,
      committees: [],
      roles: [],
      membershipRequestPending: false,
    });
  });

  it('tells an applicant apart from a non-member while their membership request waits', async () => {
    findUniqueOrThrow.mockResolvedValue({ fullName: 'Applicant', member: null, membershipRequest: { status: 'PENDING' } });

    const response = await meAs({ personId: 12, memberId: null });

    expect(response.data).toMatchObject({ memberId: null, membershipRequestPending: true });
  });

  it('hides committees and roles of an inactive member', async () => {
    const response = await meAs({ personId: 6, memberId: null });

    expect(response.data).toMatchObject({ committees: [], roles: [] });
  });
});
