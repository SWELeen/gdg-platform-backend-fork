import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RegistrationsModule } from '../registrations/registrations.module.js';
import { CommitteeDashboardController } from './committee-dashboard.controller.js';
import { CommitteeDashboardService } from './committee-dashboard.service.js';

@Module({
  imports: [PrismaModule, RegistrationsModule],
  controllers: [CommitteeDashboardController],
  providers: [CommitteeDashboardService],
})
export class CommitteeDashboardModule {}
