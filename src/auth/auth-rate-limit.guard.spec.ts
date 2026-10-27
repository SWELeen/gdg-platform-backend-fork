import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AuthRateLimitGuard, type AuthRateLimitRule } from './auth-rate-limit.guard.js';

const queryRaw = vi.fn();
const getRules = vi.fn();
const guard = new AuthRateLimitGuard(
  { $queryRaw: queryRaw } as unknown as PrismaService,
  { getOrThrow: () => 'test-secret' } as unknown as ConfigService,
  { get: getRules } as never,
);

const rule: AuthRateLimitRule = {
  scope: 'login',
  dimension: 'email',
  limit: 2,
  windowSeconds: 60,
};

function contextFor(request: Record<string, unknown>) {
  return {
    getHandler: () => 'handler',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

beforeEach(() => {
  queryRaw.mockReset().mockResolvedValue([{ request_count: 1 }]);
  getRules.mockReset().mockReturnValue([rule]);
});

describe('AuthRateLimitGuard', () => {
  it('allows requests below a policy limit', async () => {
    await expect(guard.canActivate(contextFor({
      ip: '127.0.0.1',
      body: { email: 'User@Example.test' },
      headers: {},
    }))).resolves.toBe(true);
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it('returns 429 when the atomic database counter exceeds the policy limit', async () => {
    queryRaw.mockResolvedValue([{ request_count: 3 }]);

    const error = await guard.canActivate(contextFor({
      ip: '127.0.0.1',
      body: { email: 'User@Example.test' },
      headers: {},
    })).catch((caught) => caught as HttpException);

    if (!(error instanceof HttpException)) throw new Error('Expected a rate-limit exception.');
    expect(error.getStatus()).toBe(429);
  });

  it('fails closed with 503 when persistent limiter storage is unavailable', async () => {
    queryRaw.mockRejectedValue(new Error('database unavailable'));

    const error = await guard.canActivate(contextFor({
      ip: '127.0.0.1',
      body: { email: 'user@example.test' },
      headers: {},
    })).catch((caught) => caught as HttpException);

    if (!(error instanceof HttpException)) throw new Error('Expected a storage exception.');
    expect(error.getStatus()).toBe(503);
  });

  it('does not create an email bucket when the request has no email value', async () => {
    await expect(guard.canActivate(contextFor({ ip: '127.0.0.1', headers: {}, body: {} })))
      .resolves.toBe(true);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
