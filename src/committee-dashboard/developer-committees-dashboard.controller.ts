import { Controller, Get, Inject, Req } from '@nestjs/common';
import { apiSuccess } from '../common/http/api-response.js';
import type { RequestUser } from '../auth/auth.guard.js';
import { CommitteeDashboardService } from './committee-dashboard.service.js';

@Controller('developer-committees')
export class DeveloperCommitteesDashboardController {
  constructor(@Inject(CommitteeDashboardService) private readonly dashboard: CommitteeDashboardService) {}

  @Get('dashboard')
  async overview(@Req() request: { user?: RequestUser }) {
    return apiSuccess(await this.dashboard.getDeveloperOverview(request.user));
  }
}
