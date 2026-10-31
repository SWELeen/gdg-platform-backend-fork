import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

function safeErrorMetadata(error: unknown) {
  const value =
    typeof error === 'object' && error !== null
      ? (error as { name?: unknown; code?: unknown; cause?: unknown })
      : undefined;
  const cause =
    typeof value?.cause === 'object' && value.cause !== null
      ? (value.cause as { code?: unknown })
      : undefined;
  const code = [value?.code, cause?.code].find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && /^[A-Z0-9_]{1,32}$/.test(candidate),
  );

  return {
    errorName:
      error instanceof Error && /^[A-Za-z0-9_.$]{1,80}$/.test(error.name)
        ? error.name
        : 'unknown',
    errorCode: code,
  };
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.checkDatabaseConnection();
      return { status: 'ready' };
    } catch (error) {
      this.logger.warn({
        event: 'readiness_check_failed',
        dependency: 'postgres',
        ...safeErrorMetadata(error),
      });
      throw new ServiceUnavailableException();
    }
  }
}
