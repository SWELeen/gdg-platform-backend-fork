import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RegistrationsModule } from '../registrations/registrations.module.js';
import { CommitteeDashboardController } from './committee-dashboard.controller.js';
import { DeveloperCommitteesDashboardController } from './developer-committees-dashboard.controller.js';
import { ClubLeadershipDashboardController } from './club-leadership-dashboard.controller.js';
import { CommitteeDashboardService } from './committee-dashboard.service.js';
import { CommitteeEventImageStorageService } from './committee-event-image-storage.service.js';
import { MyTasksController } from './my-tasks.controller.js';

@Module({
  imports: [PrismaModule, RegistrationsModule],
  controllers: [CommitteeDashboardController, DeveloperCommitteesDashboardController, ClubLeadershipDashboardController, MyTasksController],
  providers: [CommitteeDashboardService, CommitteeEventImageStorageService],
})
export class CommitteeDashboardModule {}
