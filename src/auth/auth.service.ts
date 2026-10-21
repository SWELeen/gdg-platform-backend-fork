import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createClient,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RequestUser } from './auth.guard.js';
import type { LoginDto } from './login.dto.js';
import type { SignupDto } from './signup.dto.js';

const UNIQUE_VIOLATION = 'P2002';

function emailAlreadyExists() {
  return new ConflictException('An account with this email already exists.', {
    errorCode: 'EMAIL_ALREADY_EXISTS',
  });
}

function tokens(session: Session) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at,
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private supabase?: SupabaseClient;
  private supabaseAdmin?: SupabaseClient;

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

    return tokens(data.session);
  }

  // supabase account + person row, no member row or role
  async signup({ fullName, email, password }: SignupDto) {
    // existing members who haven't activated yet count too
    const existing = await this.prisma.person.findFirst({
      where: {
        OR: [
          { emailPersonal: { equals: email, mode: 'insensitive' } },
          { emailUniversity: { equals: email, mode: 'insensitive' } },
        ],
      },
      select: { personId: true },
    });
    if (existing) throw emailAlreadyExists();

    const { data, error } = await this.client().auth.signUp({
      email,
      password,
    });
    if (
      error?.code === 'user_already_exists' ||
      error?.code === 'email_exists'
    ) {
      throw emailAlreadyExists();
    }
    if (error?.code === 'weak_password') {
      throw new BadRequestException('password is too weak.');
    }
    if (error) throw error;
    // email confirmation is off so supabase logs them in right away
    if (!data.user || !data.session) {
      throw new Error('Supabase signup returned no session');
    }

    try {
      await this.prisma.person.create({
        data: {
          authUserId: data.user.id,
          fullName: fullName.trim(),
          // registration emails go to email_personal
          emailPersonal: email.toLowerCase(),
        },
      });
    } catch (personError) {
      // no person = the account is useless, so undo it
      await this.deleteAccount(data.user.id);
      if (
        personError instanceof Prisma.PrismaClientKnownRequestError &&
        personError.code === UNIQUE_VIOLATION
      ) {
        throw emailAlreadyExists();
      }
      throw personError;
    }

    return tokens(data.session);
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

  private async deleteAccount(authUserId: string) {
    try {
      const { error } = await this.admin().deleteUser(authUserId);
      if (!error) return;
    } catch {
      // logged below
    }
    // can't undo = someone has to delete it in the supabase dashboard
    this.logger.error(`couldn't delete supabase user ${authUserId}`);
  }

  // made on first use so the app still starts without the supabase env vars
  private client() {
    this.supabase ??= this.connect('SUPABASE_PUBLISHABLE_KEY');
    return this.supabase;
  }

  // secret key client, only for deleting/inviting accounts, nobody logs in here
  private admin() {
    this.supabaseAdmin ??= this.connect('SUPABASE_SECRET_KEY');
    return this.supabaseAdmin.auth.admin;
  }

  private connect(keyName: string) {
    return createClient(
      this.config.getOrThrow<string>('SUPABASE_URL'),
      this.config.getOrThrow<string>(keyName),
      // the server keeps no session of its own
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
}
