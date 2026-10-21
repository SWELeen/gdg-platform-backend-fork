import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RequestUser } from './auth.guard.js';
import type { LoginDto } from './login.dto.js';

@Injectable()
export class AuthService {
  private supabase?: SupabaseClient;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  // supabase checks the password, we just hand back the session
  async login({ email, password }: LoginDto) {
    const { data, error } = await this.client().auth.signInWithPassword({
      email,
      password,
    });

    // same answer for wrong email + wrong password
    if (error?.code === 'invalid_credentials') {
      throw new UnauthorizedException();
    }
    if (error) throw error;

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
    };
  }

  // who's logged in + what the frontend needs to pick their pages
  async me(user: RequestUser) {
    // role dates are saudi calendar days
    const today = new Date(
      new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }),
    );

    const person = await this.prisma.person.findUniqueOrThrow({
      where: { personId: user.personId },
      select: {
        fullName: true,
        member: {
          select: {
            committees: {
              select: {
                role: true,
                committee: {
                  select: { committeeCode: true, committeeName: true },
                },
              },
              orderBy: { committeeId: 'asc' },
            },
            roleAssignments: {
              where: {
                AND: [
                  { OR: [{ startsOn: null }, { startsOn: { lte: today } }] },
                  { OR: [{ endsOn: null }, { endsOn: { gte: today } }] },
                ],
              },
              select: { roleCode: true },
            },
          },
        },
      },
    });

    // an inactive member sees the same as a non-member
    const member = user.memberId ? person.member : null;

    return {
      personId: user.personId,
      memberId: user.memberId,
      fullName: person.fullName,
      email: user.email ?? null,
      committees:
        member?.committees.map(({ role, committee }) => ({
          code: committee.committeeCode,
          name: committee.committeeName,
          position: role,
        })) ?? [],
      roles: [...new Set(member?.roleAssignments.map((r) => r.roleCode))],
    };
  }

  // made on first use so the app still starts without the supabase env vars
  private client() {
    this.supabase ??= createClient(
      this.config.getOrThrow<string>('SUPABASE_URL'),
      this.config.getOrThrow<string>('SUPABASE_PUBLISHABLE_KEY'),
      // the server keeps no session of its own
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    return this.supabase;
  }
}
