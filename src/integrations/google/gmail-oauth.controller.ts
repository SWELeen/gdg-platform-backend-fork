import { Controller, Get, NotImplementedException } from '@nestjs/common';

@Controller('integrations/google/gmail')
export class GmailOAuthController {
  @Get('callback')
  callback(): never {
    throw new NotImplementedException(
      'Gmail OAuth callback is reserved but the OAuth flow is not configured yet.',
    );
  }
}
