import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

// Integration point with the authentication task: once a request's token is
// verified, the auth layer sets request.user. Every account has a person;
// only group members also have a memberId. Until auth exists, protected
// routes answer 401.
export interface AuthenticatedUser {
  personId: number;
  memberId?: number | null;
}

interface RequestWithUser {
  user?: AuthenticatedUser;
}

const isId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

function userOf(context: ExecutionContext): AuthenticatedUser | undefined {
  const user = context.switchToHttp().getRequest<RequestWithUser>().user;
  if (!user || !isId(user.personId)) return undefined;
  return {
    personId: user.personId,
    memberId: isId(user.memberId) ? user.memberId : null,
  };
}

@Injectable()
export class AuthRequiredGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!userOf(context)) throw new UnauthorizedException();
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const user = userOf(context);
    if (!user) throw new UnauthorizedException();
    return user;
  },
);

// For public routes that add details when someone is signed in.
export const OptionalUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | null =>
    userOf(context) ?? null,
);
