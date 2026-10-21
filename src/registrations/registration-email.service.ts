import { Injectable, Logger } from '@nestjs/common';

export type RegistrationEmailKind = 'ACCEPTED' | 'REJECTED' | 'PROMOTED';

export interface RegistrationEmail {
  kind: RegistrationEmailKind;
  registrationId: number;
  to: string | null;
  recipientName: string;
  eventName: string;
  // Set for ACCEPTED and PROMOTED: the member must confirm before this time.
  confirmationDeadline?: Date;
}

// Placeholder transport until the team picks an email provider. Callers send
// only after the database change commits; a failed send never undoes it.
@Injectable()
export class RegistrationEmailService {
  private readonly logger = new Logger(RegistrationEmailService.name);

  async send(email: RegistrationEmail): Promise<void> {
    if (!email.to) {
      this.logger.warn({
        event: 'registration_email_skipped',
        reason: 'NO_EMAIL_ADDRESS',
        kind: email.kind,
        registrationId: email.registrationId,
      });
      return;
    }
    this.logger.log({
      event: 'registration_email_sent',
      kind: email.kind,
      registrationId: email.registrationId,
    });
  }

  // Sends without throwing so the caller's committed update stands.
  async sendSafely(email: RegistrationEmail): Promise<void> {
    try {
      await this.send(email);
    } catch (error) {
      this.logger.error({
        event: 'registration_email_failed',
        kind: email.kind,
        registrationId: email.registrationId,
        error: error instanceof Error ? error.name : 'UNKNOWN',
      });
    }
  }
}
