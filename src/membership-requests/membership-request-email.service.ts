import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

export type MembershipDecisionEmailKind = 'APPROVED' | 'REJECTED';

export interface MembershipDecisionEmail {
  to: string | null;
  recipientName: string;
  decision: MembershipDecisionEmailKind;
  committeeName?: string;
  globalRoleName?: string;
  roleName?: string;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
}

@Injectable()
export class MembershipRequestEmailService {
  private readonly logger = new Logger(MembershipRequestEmailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendDecisionEmail(email: MembershipDecisionEmail): Promise<void> {
    if (!email.to) {
      this.logger.warn({
        event: 'membership_decision_email_skipped',
        reason: 'NO_EMAIL_ADDRESS',
        decision: email.decision,
        recipientName: email.recipientName,
      });
      return;
    }

    const host = this.config.get<string>('SMTP_HOST');
    const port = Number(this.config.get<string>('SMTP_PORT') ?? 465);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS')?.replace(/\s+/g, '');
    const from = this.config.get<string>('AUTH_EMAIL_FROM');

    if (!host || !Number.isInteger(port) || !user || !pass || !from) {
      this.logger.warn({
        event: 'membership_decision_email_skipped',
        reason: 'SMTP_NOT_CONFIGURED',
        decision: email.decision,
        recipientName: email.recipientName,
      });
      return;
    }

    const targetName = email.committeeName ?? email.globalRoleName ?? 'إحدى لجان GDG';
    const roleName = email.roleName === 'Member'
      ? 'عضو'
      : email.roleName === 'Leader'
        ? 'قائد'
        : email.roleName === 'Co-Leader'
          ? 'قائد مشارك'
          : email.roleName;
    const roleDescriptor = roleName ? ` ${roleName}` : '';
    const subject = email.decision === 'APPROVED'
      ? `🎉 مبروك! تم قبولك في ${targetName}`
      : `تحديث بخصوص طلبك للانضمام إلى ${targetName}`;
    const greeting = `مرحبًا ${email.recipientName}،`;
    const body = email.decision === 'APPROVED'
      ? `يسعدنا إبلاغك بأنه تم قبولك في لجنة ${targetName}${roleDescriptor ? ` كـ${roleDescriptor.trim()}` : ''}! 🎉\n\nنحن متحمسون لانضمامك إلى فريقنا، وواثقون أن شغفك وأفكارك ومهاراتك ستضيف الكثير للجنة. أهلًا بك بيننا، ونتطلع إلى إنجاز أشياء مميزة معًا! 🚀`
      : `نشكر لك اهتمامك بالتقديم إلى لجنة ${targetName}${roleDescriptor ? ` كـ${roleDescriptor.trim()}` : ''}، ونقدّر الوقت والجهد اللذين بذلتهما في طلبك.\n\nنأسف لإبلاغك بأنه لم يقع عليك الاختيار هذه المرة. نعرف أن هذا الخبر قد يكون محبطًا، لكن قرار اللجنة لا يقلل من إمكاناتك أو من قيمة ما قدمته. نتمنى لك التوفيق، ويسعدنا أن نراك تتقدم مرة أخرى في فرص قادمة. 💛`;

    const text = [
      greeting,
      '',
      body,
      '',
      'بكل التقدير،',
      'فريق google developer group on Campus – جامعة جدة',
    ].join('\n');

    const htmlBody = escapeHtml(body).replace(/\n/g, '<br>');
    const html = `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#f8f9fa;font-family:Arial,Tahoma,sans-serif;color:#202124;line-height:1.9;direction:rtl;text-align:right"><div style="max-width:600px;margin:32px auto;padding:32px;background:#fff;border:1px solid #e8eaed;border-radius:16px"><h2 style="margin-top:0;color:#1a73e8">${escapeHtml(subject)}</h2><p>${escapeHtml(greeting)}</p><p>${htmlBody}</p><p style="margin-top:28px">بكل التقدير،<br><strong>فريق google developer group on Campus – جامعة جدة</strong></p></div></body></html>`;

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    try {
      await transporter.sendMail({
        from,
        to: email.to,
        subject,
        text,
        html,
      });
      this.logger.log({
        event: 'membership_decision_email_sent',
        decision: email.decision,
        recipientName: email.recipientName,
        targetName,
      });
    } finally {
      transporter.close();
    }
  }
}
