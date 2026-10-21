import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AuthApiError } from '@supabase/supabase-js';
import { ApiValidationPipe } from '../common/http/api-validation.pipe.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AuthController } from './auth.controller.js';
import type { RequestUser } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './login.dto.js';

const { signInWithPassword } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
}));

vi.mock('@supabase/supabase-js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@supabase/supabase-js')>()),
  createClient: () => ({ auth: { signInWithPassword } }),
}));

const findUniqueOrThrow = vi.fn();
const controller = new AuthController(
  new AuthService(
    { person: { findUniqueOrThrow } } as unknown as PrismaService,
    { getOrThrow: () => 'test-value' } as unknown as ConfigService,
  ),
);

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
