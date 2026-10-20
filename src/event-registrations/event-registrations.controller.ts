import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  AuthRequiredGuard,
  type AuthenticatedUser,
  CurrentUser,
  OptionalUser,
} from '../auth/current-user.js';
import { apiSuccess } from '../common/http/api-response.js';
import { RegisterForEventDto } from './event-registration.dto.js';
import { EventRegistrationService } from './event-registration.service.js';

@Controller()
export class EventRegistrationsController {
  constructor(
    @Inject(EventRegistrationService)
    private readonly service: EventRegistrationService,
  ) {}

  @Get('events')
  async listEvents() {
    return apiSuccess(await this.service.listPublishedEvents());
  }

  @Get('events/:eventId')
  async getEvent(
    @Param('eventId', ParseIntPipe) eventId: number,
    @OptionalUser() user: AuthenticatedUser | null,
  ) {
    return apiSuccess(
      await this.service.getPublishedEvent(eventId, user?.personId ?? null),
    );
  }

  @Post('events/:eventId/registrations')
  @UseGuards(AuthRequiredGuard)
  async register(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() body: RegisterForEventDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return apiSuccess(
      await this.service.register(eventId, user.personId, body.answers ?? []),
      'Registered.',
    );
  }

  @Get('my/registrations')
  @UseGuards(AuthRequiredGuard)
  async myRegistrations(@CurrentUser() user: AuthenticatedUser) {
    return apiSuccess(await this.service.myRegistrations(user.personId));
  }

  @Post('registrations/:registrationId/confirm')
  @HttpCode(200)
  @UseGuards(AuthRequiredGuard)
  async confirm(
    @Param('registrationId', ParseIntPipe) registrationId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return apiSuccess(
      await this.service.confirm(registrationId, user.personId),
    );
  }

  @Post('registrations/:registrationId/decline')
  @HttpCode(200)
  @UseGuards(AuthRequiredGuard)
  async decline(
    @Param('registrationId', ParseIntPipe) registrationId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return apiSuccess(
      await this.service.decline(registrationId, user.personId),
    );
  }
}
