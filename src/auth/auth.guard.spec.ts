import {
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AuthGuard, type RequestUser } from './auth.guard.js';
import type { TokenVerifierService } from './token-verifier.service.js';

const AUTH_USER_ID = '6f1c2a4e-1b2c-4d5e-8f90-123456789abc';

const verify = vi.fn();
const findUnique = vi.fn();
const guard = new AuthGuard(
  { verify } as unknown as TokenVerifierService,
  { person: { findUnique } } as unknown as PrismaService,
);

// fake request with only the parts the guard looks at
function requestWith(authorization?: string) {
  const request: { headers: { authorization?: string }; user?: RequestUser } = {
    headers: authorization === undefined ? {} : { authorization },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { request, context };
}

beforeEach(() => {
  verify.mockReset().mockResolvedValue({ authUserId: AUTH_USER_ID });
  findUnique.mockReset();
});

describe('AuthGuard', () => {
  it('lets visitors without a token through with no user', async () => {
    const { request, context } = requestWith();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
    expect(verify).not.toHaveBeenCalled();
  });

  it('sets personId, memberId and email for an active member', async () => {
    verify.mockResolvedValue({
      authUserId: AUTH_USER_ID,
      email: 'noura@example.test',
    });
    findUnique.mockResolvedValue({
      personId: 6,
      isActive: true,
      member: { memberId: 10000005, isActive: true },
    });
    const { request, context } = requestWith('Bearer good-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('good-token');
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { authUserId: AUTH_USER_ID } }),
    );
    expect(request.user).toEqual({
      personId: 6,
      memberId: 10000005,
      email: 'noura@example.test',
    });
  });

  it.each([
    ['not a member', null],
    ['an inactive member', { memberId: 10000005, isActive: false }],
  ])('sets memberId to null for %s', async (_, member) => {
    findUnique.mockResolvedValue({ personId: 6, isActive: true, member });
    const { request, context } = requestWith('Bearer good-token');

    await guard.canActivate(context);
    expect(request.user).toEqual({ personId: 6, memberId: null });
  });

  it.each([
    ['is not a bearer token', 'Basic abc123'],
    ['has no token after Bearer', 'Bearer '],
  ])('rejects a header that %s', async (_, header) => {
    const { context } = requestWith(header);

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects a token the verifier does not trust', async () => {
    verify.mockResolvedValue(null);
    const { context } = requestWith('Bearer bad-token');

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects a supabase account not linked to any person', async () => {
    findUnique.mockResolvedValue(null);
    const { context } = requestWith('Bearer good-token');

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('forbids a deactivated person', async () => {
    findUnique.mockResolvedValue({
      personId: 6,
      isActive: false,
      member: null,
    });
    const { request, context } = requestWith('Bearer good-token');

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
    expect(request.user).toBeUndefined();
  });

  it('passes on errors when the signing keys cannot be reached', async () => {
    verify.mockRejectedValue(new Error('keys unreachable'));
    const { context } = requestWith('Bearer good-token');

    await expect(guard.canActivate(context)).rejects.toThrow(
      'keys unreachable',
    );
  });
});
