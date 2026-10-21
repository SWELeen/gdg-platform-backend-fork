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
