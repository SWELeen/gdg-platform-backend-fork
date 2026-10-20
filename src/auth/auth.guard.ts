import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TokenVerifierService } from './token-verifier.service.js';

export interface RequestUser {
  personId: number;
  // null if they aren't an active member
  memberId: number | null;
  email?: string;
}

interface AuthRequest {
  headers: { authorization?: string };
  user?: RequestUser;
}

// runs before every route. no token = visitor, routes that need a login reject them
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(TokenVerifierService)
    private readonly verifier: TokenVerifierService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const header = request.headers.authorization;
    if (header === undefined) return true;

    const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    if (!token) throw new UnauthorizedException();
    const identity = await this.verifier.verify(token);
    if (!identity) throw new UnauthorizedException();

    const person = await this.prisma.person.findUnique({
      where: { authUserId: identity.authUserId },
      select: {
        personId: true,
        isActive: true,
        member: { select: { memberId: true, isActive: true } },
      },
    });
    // valid token but no person is linked to this supabase account
    if (!person) throw new UnauthorizedException();
    if (!person.isActive) throw new ForbiddenException();

    request.user = {
      personId: person.personId,
      memberId: person.member?.isActive ? person.member.memberId : null,
      email: identity.email,
    };
    return true;
  }
}
