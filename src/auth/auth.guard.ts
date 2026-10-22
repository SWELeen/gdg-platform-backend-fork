import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TokenVerifierService } from './token-verifier.service.js';

export interface RequestUser {
  personId: number;
  // null if they aren't an active member
  memberId: number | null;
  email?: string;
  fromEmailLink?: boolean;
}

interface AuthRequest {
  headers: { authorization?: string };
  user?: RequestUser;
}

// runs before every route, only works out who's calling. never blocks, routes that need a login check request.user
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
    const token = header && /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    if (!token) return true;

    const identity = await this.verifier.verify(token);
    if (!identity) return true;

    const person = await this.prisma.person.findUnique({
      where: { authUserId: identity.authUserId },
      select: {
        personId: true,
        isActive: true,
        member: { select: { memberId: true, isActive: true } },
      },
    });
    // no linked person or deactivated = visitor
    if (!person?.isActive) return true;

    request.user = {
      personId: person.personId,
      memberId: person.member?.isActive ? person.member.memberId : null,
      email: identity.email,
      fromEmailLink: identity.fromEmailLink,
    };
    return true;
  }
}
