import { ConfigService } from '@nestjs/config';
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SmtpEmailService } from '../common/email/smtp-email.service.js';

export type RegistrationEmailKind =
  'ACCEPTED' | 'REJECTED' | 'WAITLISTED' | 'PROMOTED' | 'CONFIRMED';

export interface RegistrationEmail {
  kind: RegistrationEmailKind;
  registrationId: number;
  to: string | null;
  recipientName: string;
  eventName: string;
  // Set for ACCEPTED and PROMOTED: the member must confirm before this time.
  confirmationDeadline?: Date;
  // Set for CONFIRMED: inline QR and a PNG attachment are sent to the member.
  attendanceQrCodeDataUrl?: string;
  eventStartsAt?: Date;
  eventType?: string | null;
  eventLocation?: string | null;
  eventMapsLink?: string | null;
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

function formatDate(date: Date, locale: 'en' | 'ar'): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Asia/Riyadh',
  }).format(date);
}

const EVENT_TYPE_LABELS: Record<string, { ar: string; en: string }> = {
  Workshop: { ar: 'ورشة عمل', en: 'Workshop' },
  Conference: { ar: 'مؤتمر', en: 'Conference' },
  Talk: { ar: 'محاضرة', en: 'Talk' },
  Panel: { ar: 'جلسة حوارية', en: 'Panel' },
  Hackathon: { ar: 'هاكاثون', en: 'Hackathon' },
  Trip: { ar: 'رحلة', en: 'Trip' },
};

function eventTypeLabel(
  type: string | null | undefined,
  locale: 'ar' | 'en',
): string | null {
  return type ? EVENT_TYPE_LABELS[type]?.[locale] ?? type : null;
}

function eventDisplayName(
  name: string,
  type: string | null | undefined,
  locale: 'ar' | 'en',
): string {
  const label = eventTypeLabel(type, locale);
  return label ? `${label} «${name}»` : name;
}

@Injectable()
export class RegistrationEmailService {
  private readonly logger = new Logger(RegistrationEmailService.name);

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(SmtpEmailService) private readonly smtp: SmtpEmailService,
  ) {}

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

    const from = this.config.get<string>('AUTH_EMAIL_FROM');
    if (!this.smtp.isConfigured() || !from) {
      throw new ServiceUnavailableException(
        'Event email delivery is not configured.',
      );
    }

    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    const eventUrl = new URL('/en/registrations', frontendUrl).toString();
    const eventNameAr = eventDisplayName(email.eventName, email.eventType, 'ar');
    const eventNameEn = eventDisplayName(email.eventName, email.eventType, 'en');
    const detailLines = (locale: 'ar' | 'en') => [
      email.confirmationDeadline
        ? locale === 'ar'
          ? `آخر موعد لتأكيد الحضور: ${formatDate(email.confirmationDeadline, locale)}`
          : `Attendance confirmation deadline: ${formatDate(email.confirmationDeadline, locale)}`
        : '',
      email.eventStartsAt
          ? locale === 'ar'
          ? `${email.eventType ? `موعد ${eventTypeLabel(email.eventType, locale)}` : 'الموعد'}: ${formatDate(email.eventStartsAt, locale)}`
          : `${eventTypeLabel(email.eventType, locale) ? `${eventTypeLabel(email.eventType, locale)} date` : 'Date'}: ${formatDate(email.eventStartsAt, locale)}`
        : '',
      email.eventLocation
        ? locale === 'ar'
          ? `الموقع: ${email.eventLocation}`
          : `Location: ${email.eventLocation}`
        : '',
      email.eventMapsLink
        ? locale === 'ar'
          ? `رابط الموقع: ${email.eventMapsLink}`
          : `Location link: ${email.eventMapsLink}`
        : '',
    ].filter(Boolean);
    const detailsAr = detailLines('ar');
    const detailsEn = detailLines('en');
    const attachments: {
      filename: string;
      content: Buffer;
      contentType: string;
      cid?: string;
    }[] = [];
    let qrHtml = '';
    if (email.kind === 'CONFIRMED') {
      const match = email.attendanceQrCodeDataUrl?.match(
        /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/,
      );
      if (!match) throw new Error('Attendance QR image is missing or invalid.');
      attachments.push({
        filename: 'event-attendance-qr.png',
        content: Buffer.from(match[1], 'base64'),
        contentType: 'image/png',
        cid: 'event-attendance-qr',
      });
      qrHtml =
        '<p style="text-align:center"><img src="cid:event-attendance-qr" alt="Event attendance QR code / رمز QR للحضور" width="240" height="240"></p>';
    }

    const requiresResponse =
      (email.kind === 'ACCEPTED' || email.kind === 'PROMOTED') && !!email.confirmationDeadline;
    const hasRegistrationLink = requiresResponse || email.kind === 'WAITLISTED';
    const subjectAr =
      email.kind === 'REJECTED'
        ? `بخصوص طلب تسجيلك في ${eventNameAr}`
        : email.kind === 'WAITLISTED'
          ? `تمت إضافتك إلى قائمة الانتظار لـ${eventNameAr}`
        : email.kind === 'PROMOTED'
          ? `هناك مقعد متاح لك في ${eventNameAr}، أكّد حضورك`
        : requiresResponse
          ? `مُبارك قبولك في ${eventNameAr}، أكّد حضورك`
          : `تم تأكيد حضورك في ${eventNameAr}! ✨`;
    const subjectEn = email.kind === 'REJECTED'
      ? `Regarding Your Registration for ${eventNameEn}`
      : email.kind === 'WAITLISTED'
        ? `You’re on the Waitlist for ${eventNameEn}`
      : email.kind === 'PROMOTED'
        ? `A Place Is Available for ${eventNameEn} – Confirm Your Attendance`
      : requiresResponse
        ? `Congratulations on Your Acceptance to ${eventNameEn} — Confirm Your Attendance`
        : `Your Attendance Is Confirmed: ${eventNameEn} ✨`;
    const subject = `${subjectAr} | ${subjectEn}`;
    const messageAr =
      email.kind === 'REJECTED'
        ? `نؤمن بأن لكل موهبة فرصة تستحقها، ونقدّر شغفك وحرصك على تطوير مهاراتك. نعتذر عن عدم قبول تسجيلك في ${eventNameAr} نظرًا لمحدودية المقاعد المتاحة. نتطلع إلى لقائك في محطات آفاق القادمة، فطموحك يفتح آفاقًا جديدة! ✨`
        : email.kind === 'WAITLISTED'
          ? `تمت إضافتك إلى قائمة الانتظار لـ${eventNameAr} ضمن محطات آفاق مجموعة مطوّري جوجل بجامعة جدة. سنرسل إليك رسالة إذا توفر مقعد، ونرجو متابعة بريدك الإلكتروني لمعرفة أي تحديثات.`
        : email.kind === 'CONFIRMED'
          ? `يُسعدنا تأكيد حجز مقعدك في ${eventNameAr}، ضمن محطات آفاق مجموعة مطوّري جوجل بجامعة جدة! ✨ أصبح مقعدك مؤكدًا، ونترقّب مشاركتك معنا في هذه التجربة 🎈`
          : email.kind === 'PROMOTED'
            ? `أصبح هناك مقعد متاح لك في ${eventNameAr} ضمن محطات آفاق مجموعة مطوّري جوجل بجامعة جدة! ✨ نرجو تأكيد حضورك قبل انتهاء المهلة المحددة لضمان مقعدك.`
            : `يُسعدنا إبلاغك بقبولك في ${eventNameAr}، ضمن محطات آفاق مجموعة مطوّري جوجل بجامعة جدة! ✨ نترقّب مشاركتك معنا، ونرجو تأكيد حضورك قبل انتهاء المهلة المحددة لضمان مقعدك!`;
    const messageEn = email.kind === 'REJECTED'
      ? `We believe every talent deserves an opportunity, and we truly appreciate your enthusiasm and dedication to developing your skills. Unfortunately, your registration for ${eventNameEn} was not accepted due to limited seat availability. We look forward to seeing you at upcoming Afaq events. Your ambition opens new horizons! ✨`
      : email.kind === 'WAITLISTED'
        ? `You have been added to the waitlist for ${eventNameEn}, part of the Afaq series by Google Developer Group on Campus, University of Jeddah. We’ll email you if a place becomes available. Please keep an eye on your inbox for updates.`
      : email.kind === 'CONFIRMED'
        ? `We’re pleased to confirm your place at ${eventNameEn}, part of the Afaq series by Google Developer Group on Campus, University of Jeddah! ✨ Your seat is secured, and we look forward to having you with us. 🎈`
        : email.kind === 'PROMOTED'
          ? `A place has become available for you at ${eventNameEn}, part of the Afaq series by Google Developer Group on Campus, University of Jeddah! ✨ Please confirm your attendance before the deadline to secure your place.`
          : `We’re pleased to inform you that your application to attend ${eventNameEn}, part of the Afaq series by Google Developer Group on Campus, University of Jeddah, has been accepted! ✨ Please confirm your attendance before the deadline to secure your place.`;
    const signoffAr = 'مع خالص التمنيات بالتوفيق،\nمجموعة مطوّري جوجل بجامعة جدة';
    const signoffEn = 'Best regards,\nGoogle Developer Group on Campus, University of Jeddah';
    const text = [
      subjectAr, '', messageAr, ...detailsAr,
      ...(hasRegistrationLink ? [`${email.kind === 'WAITLISTED' ? 'متابعة حالة التسجيل' : 'تأكيد الحضور'}: ${eventUrl}`] : []),
      ...(email.kind === 'CONFIRMED' ? ['يرجى إبراز الباركود الخاص بك عند الوصول لتسجيل حضورك.'] : []),
      '', signoffAr, '', '---', '', subjectEn, '', messageEn, ...detailsEn,
      ...(hasRegistrationLink ? [`${email.kind === 'WAITLISTED' ? 'View registration status' : 'Confirm attendance'}: ${eventUrl}`] : []),
      ...(email.kind === 'CONFIRMED' ? ['Please present your QR code on arrival to check in.'] : []),
      '', signoffEn,
    ].join('\n');
    const registrationLink = (label: string) => `<p><a href="${escapeHtml(eventUrl)}">${label}</a></p>`;
    const section = (locale: 'ar' | 'en', title: string, message: string, details: string[], signoff: string) => `<section dir="${locale === 'ar' ? 'rtl' : 'ltr'}" style="text-align:${locale === 'ar' ? 'right' : 'left'}"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p>${details.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}${locale === 'ar' && email.kind === 'CONFIRMED' ? '<p>يرجى إبراز الباركود الخاص بك عند الوصول لتسجيل حضورك.</p>' : ''}${locale === 'en' && email.kind === 'CONFIRMED' ? '<p>Please present your QR code on arrival to check in.</p>' : ''}${hasRegistrationLink && locale === 'ar' ? registrationLink(email.kind === 'WAITLISTED' ? 'متابعة حالة التسجيل' : 'تأكيد الحضور') : ''}${hasRegistrationLink && locale === 'en' ? registrationLink(email.kind === 'WAITLISTED' ? 'View registration status' : 'Confirm attendance') : ''}<p>${escapeHtml(signoff).replace(/\n/g, '<br>')}</p></section>`;
    const html = `<!doctype html><html lang="ar" dir="rtl"><body style="font-family:Arial,Tahoma,sans-serif;color:#202124;line-height:1.8"><main style="max-width:600px;margin:auto;padding:24px">${section('ar', subjectAr, messageAr, detailsAr, signoffAr)}<hr style="border:0;border-top:1px solid #dadce0;margin:28px 0">${section('en', subjectEn, messageEn, detailsEn, signoffEn)}${qrHtml}</main></body></html>`;
    await this.smtp.sendMail({
      from,
      to: email.to,
      subject,
      text,
      html,
      attachments,
    }, { unavailableMessage: 'Event email delivery is not configured.' });
    this.logger.log({
      event: 'registration_email_sent',
      kind: email.kind,
      registrationId: email.registrationId,
    });
  }

}
