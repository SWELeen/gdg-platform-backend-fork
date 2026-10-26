import { Body, Controller, Get, Inject, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import { apiSuccess } from '../common/http/api-response.js';
import type { RequestUser } from '../auth/auth.guard.js';
import { AddMemberToCommitteeDto } from './committee-dashboard.dto.js';
import { CommitteeDashboardService } from './committee-dashboard.service.js';

@Controller('club-leadership')
export class ClubLeadershipDashboardController {
  constructor(@Inject(CommitteeDashboardService) private readonly dashboard: CommitteeDashboardService) {}

  @Get('dashboard')
  async overview(@Req() request: { user?: RequestUser }) {
    return apiSuccess(await this.dashboard.getClubLeadershipOverview(request.user));
  }

  @Post('members/:memberId/committees')
  async addMemberToCommittee(
    @Req() request: { user?: RequestUser },
    @Param('memberId', ParseIntPipe) memberId: number,
    @Body() body: AddMemberToCommitteeDto,
  ) {
    return apiSuccess(await this.dashboard.addMemberToCommittee(request.user, memberId, body));
  }
}
