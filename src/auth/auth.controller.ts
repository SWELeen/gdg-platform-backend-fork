import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { apiSuccess } from '../common/http/api-response.js';
import type { RequestUser } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CheckEmailDto } from './check-email.dto.js';
import { LoginDto } from './login.dto.js';
import { SignupDto } from './signup.dto.js';

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() body: LoginDto) {
    return apiSuccess(await this.auth.login(body));
  }

  @Post('auth/check-email')
  @HttpCode(200)
  async checkEmail(@Body() body: CheckEmailDto) {
    return apiSuccess(await this.auth.checkEmail(body));
  }

  @Post('auth/signup')
  async signup(@Body() body: SignupDto) {
    return apiSuccess(await this.auth.signup(body));
  }

  @Get('me')
  async me(@Req() request: { user?: RequestUser }) {
    if (!request.user) throw new UnauthorizedException();
    return apiSuccess(await this.auth.me(request.user));
  }
}
