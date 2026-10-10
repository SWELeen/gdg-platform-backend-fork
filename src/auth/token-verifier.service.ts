import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';

export interface TokenIdentity {
  // supabase user id from the token's sub claim
  authUserId: string;
  email?: string;
}

const INVALID_TOKEN_ERRORS = [
  errors.JWSInvalid,
  errors.JWTInvalid,
  errors.JWTExpired,
  errors.JWTClaimValidationFailed,
  errors.JWSSignatureVerificationFailed,
  errors.JWKSNoMatchingKey,
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
];

@Injectable()
export class TokenVerifierService {
  private supabase?: {
    issuer: string;
    keys: ReturnType<typeof createRemoteJWKSet>;
  };

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  // resolve caller identity null when the token not trusted
  async verify(token: string): Promise<TokenIdentity | null> {
    // Read on first use so the app still starts where Supabase is not configured.
    const { issuer, keys } = (this.supabase ??= this.loadSupabase());

    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer,
        audience: 'authenticated',

        // public-key signatures only; the shared-secret algorithm (HS256) is refused
        algorithms: ['ES256', 'RS256'],
        requiredClaims: ['exp'],
      });

      const { sub, email } = payload;
      if (!sub) return null;

      return {
        authUserId: sub,
        email: typeof email === 'string' && email ? email : undefined,
      };
    } catch (error) {
      if (INVALID_TOKEN_ERRORS.some((type) => error instanceof type)) {
        return null;
      }
      throw error;
    }
  }

  private loadSupabase() {
    const projectUrl = this.config
      .getOrThrow<string>('SUPABASE_URL')
      .replace(/\/+$/, '');
    const issuer = `${projectUrl}/auth/v1`;

    return {
      issuer,
      keys: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)),
    };
  }
}
