import {
  BadRequestException,
  ConflictException,
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
import { SignupDto } from './signup.dto.js';

const { signInWithPassword, signUp, deleteUser } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock('@supabase/supabase-js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@supabase/supabase-js')>()),
  createClient: () => ({
    auth: { signInWithPassword, signUp, admin: { deleteUser } },
  }),
}));

const findUniqueOrThrow = vi.fn();
const findFirst = vi.fn();
const create = vi.fn();
const controller = new AuthController(
  new AuthService(
    {
      person: { findUniqueOrThrow, findFirst, create },
    } as unknown as PrismaService,
    { getOrThrow: () => 'test-value' } as unknown as ConfigService,
  ),
);

const SESSION = {
  access_token: 'access',
  refresh_token: 'refresh',
  expires_at: 1790000000,
};
const TOKENS = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: 1790000000,
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
      },
      error: null,
    });
  });

  it('returns the session tokens from supabase', async () => {
    const response = await controller.login(body);

    expect(signInWithPassword).toHaveBeenCalledWith(body);
    expect(response).toEqual({
      success: true,
      message: 'OK',
      error: null,
      data: {
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: 1790000000,
      },
    });
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

    await expect(controller.login(body)).rejects.toThrow(UnauthorizedException);
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

    await expect(controller.login(body)).rejects.toBe(rateLimited);
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

  it('looks in both email columns, ignoring letter case', async () => {
    findFirst.mockReset().mockResolvedValue(null);

    await controller.checkEmail(body);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { emailPersonal: { equals: body.email, mode: 'insensitive' } },
            { emailUniversity: { equals: body.email, mode: 'insensitive' } },
          ],
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
  };

  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue(null);
    create.mockReset().mockResolvedValue({ personId: 11 });
    signUp.mockReset().mockResolvedValue({
      data: { user: { id: 'new-auth-user' }, session: SESSION },
      error: null,
    });
    deleteUser.mockReset().mockResolvedValue({ data: {}, error: null });
  });

  it('creates the account + a person linked to it and logs them in', async () => {
    const response = await controller.signup(body);

    expect(signUp).toHaveBeenCalledWith({
      email: body.email,
      password: body.password,
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        authUserId: 'new-auth-user',
        fullName: 'Sara Visitor',
        emailPersonal: 'sara@example.test',
      },
    });
    expect(response.data).toEqual(TOKENS);
  });

  it('rejects an email a person already has, without touching supabase', async () => {
    findFirst.mockResolvedValue({ personId: 6 });

    await expect(controller.signup(body)).rejects.toThrow(ConflictException);
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
    expect(create).not.toHaveBeenCalled();
  });

  it('deletes the new account when the person row fails', async () => {
    const dbDown = new Error('database down');
    create.mockRejectedValue(dbDown);

    await expect(controller.signup(body)).rejects.toBe(dbDown);
    expect(deleteUser).toHaveBeenCalledWith('new-auth-user');
  });

  it('treats a duplicate email from a parallel signup as already existing', async () => {
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(controller.signup(body)).rejects.toThrow(ConflictException);
    expect(deleteUser).toHaveBeenCalledWith('new-auth-user');
  });

  it('never creates a person when supabase gives no session', async () => {
    signUp.mockResolvedValue({
      data: { user: { id: 'new-auth-user' }, session: null },
      error: null,
    });

    await expect(controller.signup(body)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
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
    });
  });

  it('hides committees and roles of an inactive member', async () => {
    const response = await meAs({ personId: 6, memberId: null });

    expect(response.data).toMatchObject({ committees: [], roles: [] });
  });
});
