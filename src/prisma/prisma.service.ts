import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

function safeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error))
    return undefined;
  const code = error.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code)
    ? code
    : undefined;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(@Inject(ConfigService) config: ConfigService) {
    const logger = new Logger(PrismaService.name);
    super({
      adapter: new PrismaPg(
        {
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
          connectionTimeoutMillis: 10_000,
          idleTimeoutMillis: 30_000,
          keepAlive: true,
          keepAliveInitialDelayMillis: 10_000,
          max: 5,
        },
        {
          onPoolError: (error) => {
            logger.error({
              event: 'postgres_pool_error',
              errorName: error.name,
              errorCode: safeErrorCode(error),
            });
          },
        },
      ),
    });
  }

  async onModuleInit() {
    await this.$connect();
    await this.checkDatabaseConnection();
  }

  async checkDatabaseConnection(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
