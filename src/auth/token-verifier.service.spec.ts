import { ConfigService } from '@nestjs/config';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { CryptoKey, JWK, JWTPayload } from 'jose';
import { TokenVerifierService } from './token-verifier.service.js';

const SUPABASE_URL = 'https://test-project.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const USER_ID = '6f1c2a4e-1b2c-4d5e-8f90-123456789abc';

let supabaseKey: CryptoKey;
let attackerKey: CryptoKey;
let publicJwk: JWK;

// makes a token like supabase would, each test changes what it needs
function makeToken(
  options: {
    payload?: JWTPayload;
    issuer?: string;
    audience?: string;
    expiresAt?: string | number;
    key?: CryptoKey;
  } = {},
) {
  return new SignJWT({
    sub: USER_ID,
    email: 'user@example.com',
    ...options.payload,
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? 'authenticated')
    .setExpirationTime(options.expiresAt ?? '1h')
    .sign(options.key ?? supabaseKey);
}

function makeVerifier() {
  return new TokenVerifierService(new ConfigService({ SUPABASE_URL }));
}

beforeAll(async () => {
  const supabasePair = await generateKeyPair('ES256', { extractable: true });
  supabaseKey = supabasePair.privateKey;
  attackerKey = (await generateKeyPair('ES256')).privateKey;
  publicJwk = {
    ...(await exportJWK(supabasePair.publicKey)),
    kid: 'test-key',
    alg: 'ES256',
  };
});

beforeEach(() => {
  // stands in for supabase's public keys endpoint
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ keys: [publicJwk] })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TokenVerifierService', () => {
  it('accepts a valid token', async () => {
    const token = await makeToken();

    await expect(makeVerifier().verify(token)).resolves.toEqual({
      authUserId: USER_ID,
      email: 'user@example.com',
    });
    expect(fetch).toHaveBeenCalledWith(
      `${ISSUER}/.well-known/jwks.json`,
      expect.anything(),
    );
  });

  it('leaves email out when the token has none', async () => {
    const token = await makeToken({ payload: { email: undefined } });

    await expect(makeVerifier().verify(token)).resolves.toEqual({
      authUserId: USER_ID,
      email: undefined,
    });
  });

  it.each([
    [
      'expired',
      () => makeToken({ expiresAt: Math.floor(Date.now() / 1000) - 60 }),
    ],
    ["signed with someone else's key", () => makeToken({ key: attackerKey })],
    [
      'from another issuer',
      () => makeToken({ issuer: 'https://evil.supabase.co/auth/v1' }),
    ],
    ['for another audience', () => makeToken({ audience: 'anon' })],
    ['missing the user id', () => makeToken({ payload: { sub: undefined } })],
    ['not a token at all', async () => 'not-a-jwt'],
  ])('rejects a token that is %s', async (_, buildToken) => {
    await expect(makeVerifier().verify(await buildToken())).resolves.toBeNull();
  });

  it('trusts no token when SUPABASE_URL is not set', async () => {
    const verifier = new TokenVerifierService(new ConfigService({}));

    await expect(verifier.verify(await makeToken())).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws when the signing keys cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 503 })),
    );
    const token = await makeToken();

    await expect(makeVerifier().verify(token)).rejects.toThrow();
  });
});
