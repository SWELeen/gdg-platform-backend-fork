import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import QRCode from 'qrcode';

export interface IssuedAttendanceToken {
  token: string;
  hash: string;
  encrypted: string;
}

const FORMAT_VERSION = 'v1';

// The QR shown after confirmation carries only this opaque random token.
// The database keeps its SHA-256 hash for check-in lookup and an
// AES-256-GCM copy so the same QR can be shown again. Never log tokens.
@Injectable()
export class AttendanceTokenService {
  private key?: Buffer;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  issue(): IssuedAttendanceToken {
    const token = randomBytes(32).toString('base64url');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.secret(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final(),
    ]);
    return {
      token,
      hash: AttendanceTokenService.hash(token),
      encrypted: [FORMAT_VERSION, iv, cipher.getAuthTag(), ciphertext]
        .map((part) =>
          typeof part === 'string' ? part : part.toString('base64url'),
        )
        .join('.'),
    };
  }

  reveal(encrypted: string): string {
    const [version, iv, tag, ciphertext] = encrypted.split('.');
    if (version !== FORMAT_VERSION || !iv || !tag || !ciphertext) {
      throw new Error('Unsupported attendance token format.');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.secret(),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  // The QR image the member shows at the door; it encodes only the token.
  static qrImage(token: string): Promise<string> {
    return QRCode.toDataURL(token, { margin: 1, width: 288 });
  }

  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private secret(): Buffer {
    if (!this.key) {
      const key = Buffer.from(
        this.config.getOrThrow<string>('ATTENDANCE_TOKEN_KEY'),
        'base64',
      );
      if (key.length !== 32) {
        throw new Error('ATTENDANCE_TOKEN_KEY must be 32 bytes in base64.');
      }
      this.key = key;
    }
    return this.key;
  }
}
