import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { WalletProjectionService } from './wallet-projection.service.js';

describe('Wallet points for committee memberships', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps leadership points in GDG and syncs the regular seat of a mixed-role member', async () => {
    const leenWeb = '00000000-0000-4000-8000-000000000003';
    const mohamedProjects = '00000000-0000-4000-8000-000000000001';
    const mohamedIot = '00000000-0000-4000-8000-000000000011';
    const globalLeader = '00000000-0000-4000-8000-000000000004';
    const deputy = '00000000-0000-4000-8000-000000000005';
    const seats = [
      { walletPublicId: leenWeb, memberId: 3, committeeId: 7, memberCommittee: { role: 'Leader' } },
      { walletPublicId: mohamedProjects, memberId: 1, committeeId: 3, memberCommittee: { role: 'Leader' } },
      { walletPublicId: mohamedIot, memberId: 1, committeeId: 9, memberCommittee: { role: 'Member' } },
      { walletPublicId: globalLeader, memberId: 4, committeeId: null, memberCommittee: null },
      { walletPublicId: deputy, memberId: 5, committeeId: 7, memberCommittee: { role: 'Co-Leader' } },
    ].map((seat) => ({ ...seat, syncPoints: true, syncNextEvent: false }));
    const committeePoints = vi.fn().mockResolvedValue({ _sum: { pointsDelta: 7 } });
    const globalPoints = vi.fn();
    const prisma = {
      walletMembershipLink: { findMany: vi.fn().mockResolvedValue(seats) },
      committeePointEntry: { aggregate: committeePoints },
      globalPointEntry: { aggregate: globalPoints },
    } as unknown as PrismaService;
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({
        members: seats.map(({ walletPublicId }) => ({ membership_id: walletPublicId, version: 1, pending: false, points: 0 })),
        next_cursor: null,
      }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetch);
    const service = new WalletProjectionService(prisma, new ConfigService({
      WALLET_PROJECTION_URL: 'https://wallet.example.test',
      WALLET_PROJECTION_TOKEN: 'test-token',
    }));

    await service.sync();

    expect(committeePoints).toHaveBeenCalledExactlyOnceWith({
      where: { memberId: 1, committeeId: 9 },
      _sum: { pointsDelta: true },
    });
    expect(globalPoints).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
    const [target, update] = fetch.mock.calls[1];
    expect(target.pathname).toBe(`/integrations/v1/members/${mohamedIot}`);
    expect(update.method).toBe('PATCH');
    expect(JSON.parse(update.body).changes).toEqual({ points: 7 });
  });
});
