import { Body, Controller, Get, Inject, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { AuthRequiredGuard, type AuthenticatedUser, CurrentUser } from '../auth/current-user.js';
import { apiSuccess } from '../common/http/api-response.js';
import { UpdateMyTaskDto } from './committee-dashboard.dto.js';
import { CommitteeDashboardService } from './committee-dashboard.service.js';

@Controller('my')
@UseGuards(AuthRequiredGuard)
export class MyTasksController {
  constructor(@Inject(CommitteeDashboardService) private readonly dashboard: CommitteeDashboardService) {}

  @Get('tasks')
  async myTasks(@CurrentUser() user: AuthenticatedUser) {
    return apiSuccess(await this.dashboard.getMyTasks(user.memberId));
  }

  // Only the task's own assignee; COMPLETED is set by a leader's review, never here.
  @Patch('tasks/:taskId')
  async updateMyTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId', ParseIntPipe) taskId: number,
    @Body() body: UpdateMyTaskDto,
  ) {
    return apiSuccess(await this.dashboard.updateMyTaskStatus(user.memberId, taskId, body.status));
  }
}
