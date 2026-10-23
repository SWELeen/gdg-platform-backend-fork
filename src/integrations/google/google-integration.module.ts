import { Module } from '@nestjs/common';
import { GmailOAuthController } from './gmail-oauth.controller.js';

@Module({
  controllers: [GmailOAuthController],
})
export class GoogleIntegrationModule {}
