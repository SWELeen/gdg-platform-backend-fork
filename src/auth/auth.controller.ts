import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { apiSuccess } from '../common/http/api-response.js';
import type { RequestUser } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CheckEmailDto } from './check-email.dto.js';
import { LoginDto } from './login.dto.js';
import { CompleteSetupPasswordDto, RequestSetupLinkDto, SetupPasswordDto } from './setup-password.dto.js';
import { SignupDto } from './signup.dto.js';
import { VerifySignupEmailDto } from './verify-signup-email.dto.js';
import { ResendPersonalVerificationDto } from './resend-verification.dto.js';

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) response?: Response) {
    this.setSessionCookies(response, await this.auth.login(body));
    return apiSuccess({ authenticated: true });
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

  @Post('auth/resend-personal-verification')
  @HttpCode(200)
  async resendPersonalVerification(@Body() body: ResendPersonalVerificationDto) {
    await this.auth.resendPersonalVerification(body.email);
    return apiSuccess({ sent: true });
  }

  @Post('auth/verify-email')
  @HttpCode(200)
  async verifySignupEmail(@Body() body: VerifySignupEmailDto, @Res({ passthrough: true }) response?: Response) {
    const result = await this.auth.verifySignupEmail(body.email, body.token);
    if ('accessToken' in result) {
      this.setSessionCookies(response, result);
      return apiSuccess({ authenticated: true, registrationPendingApproval: result.registrationPendingApproval });
    }
    return apiSuccess(result);
  }

  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response?: Response) {
    const refreshToken = this.cookieValue(request, 'gdg_refresh');
    if (!refreshToken) throw new UnauthorizedException();
    this.setSessionCookies(response, await this.auth.refreshSession(refreshToken));
    return apiSuccess({ authenticated: true });
  }

  @Post('auth/logout')
  @HttpCode(200)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response?: Response) {
    const refreshToken = this.cookieValue(request, 'gdg_refresh');
    const accessToken = this.cookieValue(request, 'gdg_access')
      ?? (/^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1]);
    try {
      if (refreshToken || accessToken) await this.auth.logout(refreshToken, accessToken);
    } finally {
      response?.clearCookie('gdg_access', { path: '/', sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
      response?.clearCookie('gdg_refresh', { path: '/auth', sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
    }
    return apiSuccess({ authenticated: false });
  }

  @Post('auth/setup-password/request')
  @HttpCode(200)
  async requestSetupLink(@Body() body: RequestSetupLinkDto) {
    await this.auth.requestSetupLink(body);
    return apiSuccess(null, 'A link to set your password was sent by email.');
  }

  @Post('auth/setup-password')
  @HttpCode(200)
  async setupPassword(
    @Req() request: { user?: RequestUser },
    @Body() body: SetupPasswordDto,
    @Res({ passthrough: true }) response?: Response,
  ) {
    if (!request.user) throw new UnauthorizedException();
    this.setSessionCookies(response, await this.auth.setupPassword(request.user, body));
    return apiSuccess({ authenticated: true });
  }

  @Post('auth/setup-password/complete')
  @HttpCode(200)
  async completeSetupPassword(
    @Body() body: CompleteSetupPasswordDto,
  ) {
    await this.auth.completeSetupPassword(body);
    return apiSuccess({ passwordUpdated: true });
  }

  @Get('me')
  async me(@Req() request: { user?: RequestUser }) {
    if (!request.user) throw new UnauthorizedException();
    return apiSuccess(await this.auth.me(request.user));
  }

  private setSessionCookies(response: Response | undefined, session: { accessToken: string; refreshToken: string; expiresAt?: number }) {
    if (!response) return;
    const secure = process.env.NODE_ENV === 'production';
    const accessMaxAge = Math.max(1, (session.expiresAt ?? Math.floor(Date.now() / 1000) + 3600) * 1000 - Date.now());
    response.cookie('gdg_access', session.accessToken, { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: accessMaxAge });
    response.cookie('gdg_refresh', session.refreshToken, { httpOnly: true, secure, sameSite: 'strict', path: '/auth', maxAge: 30 * 24 * 60 * 60 * 1000 });
  }

  private cookieValue(request: Request, name: string) {
    const pair = request.headers.cookie?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
    return pair ? decodeURIComponent(pair.slice(name.length + 1)) : undefined;
  }
}
