import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthGuard } from './auth.guard.js';
import { TokenVerifierService } from './token-verifier.service.js';

@Module({
  imports: [PrismaModule],
  providers: [
    TokenVerifierService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
