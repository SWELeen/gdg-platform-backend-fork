// first step of the auth work this only checks Supabase tokens nothing uses it yet

// I'll continue the guard & loading user next but I might make a fake supabase project myself first

import { Inject, Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(TokenVerifierService.name);
  // null = SUPABASE_URL isn't set
  private supabase?: {
    issuer: string;
    keys: ReturnType<typeof createRemoteJWKSet>;
  } | null;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  // returns who the token belongs to or null if it can't be trusted
  async verify(token: string): Promise<TokenIdentity | null> {
    if (this.supabase === undefined) this.supabase = this.loadSupabase();
    if (!this.supabase) return null;
    const { issuer, keys } = this.supabase;

    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer,
        audience: 'authenticated',
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
      .get<string>('SUPABASE_URL')
      ?.trim()
      .replace(/\/+$/, '');
    if (!projectUrl) {
      this.logger.warn('SUPABASE_URL is not set, nobody can log in');
      return null;
    }

    const issuer = `${projectUrl}/auth/v1`;

    return {
      issuer,
      keys: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)),
    };
  }
}
