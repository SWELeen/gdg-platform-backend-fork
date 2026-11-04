import { Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import { apiSuccess } from '../common/http/api-response.js';
import type { RequestUser } from '../auth/auth.guard.js';
import { AssignDeveloperCommitteeMemberDto } from './committee-dashboard.dto.js';
import { CommitteeDashboardService } from './committee-dashboard.service.js';

@Controller('developer-committees')
export class DeveloperCommitteesDashboardController {
  constructor(@Inject(CommitteeDashboardService) private readonly dashboard: CommitteeDashboardService) {}

  @Get('dashboard')
  async overview(@Req() request: { user?: RequestUser }) {
    return apiSuccess(await this.dashboard.getDeveloperOverview(request.user));
  }

  @Post('members')
  async assignMember(
    @Req() request: { user?: RequestUser },
    @Body() body: AssignDeveloperCommitteeMemberDto,
  ) {
    return apiSuccess(await this.dashboard.assignDeveloperCommitteeMember(request.user, body));
  }
}
