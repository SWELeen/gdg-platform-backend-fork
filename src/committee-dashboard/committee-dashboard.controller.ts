import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { apiSuccess } from '../common/http/api-response.js';
import type { RequestUser } from '../auth/auth.guard.js';
import {
  CreateCommitteeMemberDto,
  CreateCommitteeTaskDto,
  ReviewCommitteeTaskDto,
  UpdateCommitteePointsDto,
  UpdateCommitteeTaskDto,
} from './committee-dashboard.dto.js';
import { CommitteeDashboardService } from './committee-dashboard.service.js';

@Controller('committees/:committeeCode')
export class CommitteeDashboardController {
  constructor(
    @Inject(CommitteeDashboardService)
    private readonly dashboard: CommitteeDashboardService,
  ) {}

  @Get('dashboard')
  async getDashboard(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
  ) {
    return apiSuccess(await this.dashboard.getDashboard(request.user, committeeCode));
  }

  @Post('members')
  async addMember(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Body() body: CreateCommitteeMemberDto,
  ) {
    return apiSuccess(await this.dashboard.addMember(request.user, committeeCode, body));
  }

  @Post('tasks')
  async createTask(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Body() body: CreateCommitteeTaskDto,
  ) {
    return apiSuccess(await this.dashboard.createTask(request.user, committeeCode, body));
  }

  @Patch('tasks/:taskId')
  async updateTask(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Param('taskId', ParseIntPipe) taskId: number,
    @Body() body: UpdateCommitteeTaskDto,
  ) {
    return apiSuccess(await this.dashboard.updateTask(request.user, committeeCode, taskId, body));
  }

  @Post('tasks/:taskId/review')
  @HttpCode(200)
  async reviewTask(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Param('taskId', ParseIntPipe) taskId: number,
    @Body() body: ReviewCommitteeTaskDto,
  ) {
    return apiSuccess(await this.dashboard.reviewTask(request.user, committeeCode, taskId, body.decision));
  }

  @Delete('tasks/:taskId')
  async deleteTask(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Param('taskId', ParseIntPipe) taskId: number,
  ) {
    return apiSuccess(await this.dashboard.deleteTask(request.user, committeeCode, taskId));
  }

  @Post('members/:memberId/points')
  async updatePoints(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Param('memberId', ParseIntPipe) memberId: number,
    @Body() body: UpdateCommitteePointsDto,
  ) {
    return apiSuccess(await this.dashboard.updatePoints(request.user, committeeCode, memberId, body));
  }
}
