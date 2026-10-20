import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { RegistrationStatus } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RegistrationReviewService } from '../src/registrations/registration-review.service.js';
import { schemaTestTarget } from './schema-test-target.js';

// Runs against a separate local database, never the development one:
// TEST_DATABASE_URL=postgresql://.../gdg_schema_test_registrations?schema=public
process.env.DATABASE_URL = schemaTestTarget(
  process.env.TEST_DATABASE_URL,
  process.env.DATABASE_URL,
);
process.env.ATTENDANCE_TOKEN_KEY ??= randomBytes(32).toString('base64');

const HOUR = 3_600_000;
let app: INestApplication;
let prisma: PrismaService;
let review: RegistrationReviewService;
let prMemberId: number;
let creatorMemberId: number;
let committeeId: number;
// Stand-in for the auth layer: the person each HTTP request acts as.
let actingPersonId: number | undefined;
let actingMemberId: number | undefined;
let prPersonId: number;

async function createPerson() {
  const person = await prisma.person.create({
    data: { fullName: 'Guest', emailPersonal: `${randomUUID()}@test.local` },
  });
  return person.personId;
}

async function createEvent(
  options: {
    capacity?: number;
    status?: 'PUBLISHED' | 'DRAFT';
    deadlineInHours?: number;
    questions?: {
      questionText: string;
      questionType: 'TEXT' | 'SELECT' | 'RADIO' | 'CHECKBOX';
      isRequired?: boolean;
      options?: string[];
    }[];
  } = {},
) {
  const startsAt = new Date(Date.now() + 7 * 24 * HOUR);
  return prisma.event.create({
    data: {
      name: `Event ${randomUUID().slice(0, 8)}`,
      capacity: options.capacity ?? 30,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * HOUR),
      registrationDeadline: new Date(
        Date.now() + (options.deadlineInHours ?? 24) * HOUR,
      ),
      status: options.status ?? 'PUBLISHED',
      createdByMemberId: creatorMemberId,
      committeeId,
      questions: {
        create: (options.questions ?? []).map((question, position) => ({
          ...question,
          position,
        })),
      },
    },
    include: { questions: { orderBy: { position: 'asc' } } },
  });
}

function as(personId: number | undefined) {
  actingPersonId = personId;
  actingMemberId = undefined;
  return request(app.getHttpServer());
}

async function registerVia(eventId: number, personId: number, answers = []) {
  const response = await as(personId)
    .post(`/events/${eventId}/registrations`)
    .send({ answers })
    .expect(201);
  return response.body.data.registrationId as number;
}

const statusOf = (registrationId: number) =>
  prisma.eventRegistration.findUniqueOrThrow({ where: { registrationId } });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.use(
    (
      req: { user?: { personId: number; memberId?: number } },
      _res: unknown,
      next: () => void,
    ) => {
      if (actingPersonId) {
        req.user = { personId: actingPersonId, memberId: actingMemberId };
      }
      next();
    },
  );
  await app.init();
  app
    .get(SchedulerRegistry)
    .getCronJob('registration-confirmation-expiry')
    .stop();

  prisma = app.get(PrismaService);
  review = app.get(RegistrationReviewService);
  committeeId = (
    await prisma.committee.findUniqueOrThrow({ where: { committeeCode: 'PR' } })
  ).committeeId;
  const staff = await prisma.member.create({
    data: { personId: await createPerson() },
  });
  await prisma.memberCommittee.create({
    data: { memberId: staff.memberId, committeeId, role: 'Member' },
  });
  prMemberId = staff.memberId;
  prPersonId = staff.personId;
  creatorMemberId = staff.memberId;
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  actingPersonId = undefined;
  actingMemberId = undefined;
});

describe('browsing events', () => {
  it('lists published events only, and shows my registration in details', async () => {
    const published = await createEvent({
      questions: [{ questionText: 'Why?', questionType: 'TEXT' }],
    });
    const draft = await createEvent({ status: 'DRAFT' });

    const list = await as(undefined).get('/events').expect(200);
    const ids = list.body.data.map((e: { eventId: number }) => e.eventId);
    expect(ids).toContain(published.eventId);
    expect(ids).not.toContain(draft.eventId);
    await as(undefined).get(`/events/${draft.eventId}`).expect(404);

    const person = await createPerson();
    const registrationId = await registerVia(published.eventId, person);
    const details = await as(person)
      .get(`/events/${published.eventId}`)
      .expect(200);
    expect(details.body.data).toMatchObject({
      registrationOpen: true,
      questions: [{ questionText: 'Why?', questionType: 'TEXT' }],
      myRegistration: { registrationId, status: 'PENDING' },
    });
  });
});

describe('POST /events/:eventId/registrations', () => {
  it('accepts more registrations than the capacity, all as PENDING', async () => {
    const event = await createEvent({ capacity: 2 });
    for (let i = 0; i < 5; i += 1) {
      await registerVia(event.eventId, await createPerson());
    }
    expect(
      await prisma.eventRegistration.count({
        where: { eventId: event.eventId, status: RegistrationStatus.PENDING },
      }),
    ).toBe(5);
  });

  it('rejects a duplicate registration, even when sent twice at once', async () => {
    const event = await createEvent();
    const person = await createPerson();

    const [first, second] = await Promise.all([
      as(person).post(`/events/${event.eventId}/registrations`).send({}),
      as(person).post(`/events/${event.eventId}/registrations`).send({}),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const again = await as(person)
      .post(`/events/${event.eventId}/registrations`)
      .send({})
      .expect(409);
    expect(again.body.error.code).toBe('ALREADY_REGISTERED');
  });

  it('checks answers and stores checkbox choices as a JSON list', async () => {
    const event = await createEvent({
      questions: [
        { questionText: 'Why?', questionType: 'TEXT', isRequired: true },
        {
          questionText: 'Topics',
          questionType: 'CHECKBOX',
          options: ['AI', 'Web', 'Cloud'],
        },
      ],
    });
    const [why, topics] = event.questions;
    const person = await createPerson();

    const missing = await as(person)
      .post(`/events/${event.eventId}/registrations`)
      .send({ answers: [{ questionId: topics.questionId, answer: ['AI'] }] })
      .expect(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    await as(person)
      .post(`/events/${event.eventId}/registrations`)
      .send({
        answers: [
          { questionId: why.questionId, answer: 'Learning' },
          { questionId: topics.questionId, answer: ['Mobile'] },
        ],
      })
      .expect(400);

    const response = await as(person)
      .post(`/events/${event.eventId}/registrations`)
      .send({
        answers: [
          { questionId: why.questionId, answer: 'Learning' },
          { questionId: topics.questionId, answer: ['AI', 'Cloud'] },
        ],
      })
      .expect(201);
    const answers = await prisma.registrationAnswer.findMany({
      where: { registrationId: response.body.data.registrationId },
      orderBy: { questionId: 'asc' },
    });
    expect(answers.map((a) => a.answerText)).toEqual([
      'Learning',
      '["AI","Cloud"]',
    ]);
  });

  it('refuses after the registration deadline and without sign-in', async () => {
    const closed = await createEvent({ deadlineInHours: -1 });
    const response = await as(await createPerson())
      .post(`/events/${closed.eventId}/registrations`)
      .send({})
      .expect(409);
    expect(response.body.error.code).toBe('REGISTRATION_CLOSED');

    const open = await createEvent();
    await as(undefined)
      .post(`/events/${open.eventId}/registrations`)
      .send({})
      .expect(401);
  });
});

describe('confirming and declining a seat', () => {
  async function offeredSeat(capacity = 30) {
    const event = await createEvent({ capacity });
    const person = await createPerson();
    const registrationId = await registerVia(event.eventId, person);
    await review.review(registrationId, 'ACCEPT', prMemberId);
    return { event, person, registrationId };
  }

  it('confirms within the deadline and issues the same QR token in my registrations', async () => {
    const { person, registrationId } = await offeredSeat();

    const confirmed = await as(person)
      .post(`/registrations/${registrationId}/confirm`)
      .expect(200);
    const token = confirmed.body.data.attendanceToken;
    expect(token).toEqual(expect.any(String));
    expect(confirmed.body.data.attendanceQrCodeDataUrl).toMatch(
      /^data:image\/png;base64,/,
    );
    expect((await statusOf(registrationId)).status).toBe(
      RegistrationStatus.CONFIRMED,
    );

    const mine = await as(person).get('/my/registrations').expect(200);
    expect(mine.body.data[0]).toMatchObject({
      registrationId,
      status: 'CONFIRMED',
      attendanceQrCodeDataUrl: confirmed.body.data.attendanceQrCodeDataUrl,
      canConfirm: false,
    });
  });

  it('refuses to confirm after the 24 hours have passed', async () => {
    const { person, registrationId } = await offeredSeat();
    await prisma.eventRegistration.update({
      where: { registrationId },
      data: {
        approvedAt: new Date(Date.now() - 25 * HOUR),
        confirmationDeadline: new Date(Date.now() - HOUR),
      },
    });

    const response = await as(person)
      .post(`/registrations/${registrationId}/confirm`)
      .expect(409);
    expect(response.body.error.code).toBe('CONFIRMATION_EXPIRED');
    expect((await statusOf(registrationId)).status).toBe(
      RegistrationStatus.AWAITING_CONFIRMATION,
    );
  });

  it("answers 403 when someone confirms or declines another person's registration", async () => {
    const { registrationId } = await offeredSeat();
    const stranger = await createPerson();

    await as(stranger)
      .post(`/registrations/${registrationId}/confirm`)
      .expect(403);
    await as(stranger)
      .post(`/registrations/${registrationId}/decline`)
      .expect(403);
    expect((await statusOf(registrationId)).status).toBe(
      RegistrationStatus.AWAITING_CONFIRMATION,
    );
  });

  it('declining an offered seat promotes waitlist #1', async () => {
    const { event, person, registrationId } = await offeredSeat(1);
    const w1 = await registerVia(event.eventId, await createPerson());
    const w2 = await registerVia(event.eventId, await createPerson());
    await review.setWaitlist(event.eventId, [w1, w2], prMemberId);

    await as(person)
      .post(`/registrations/${registrationId}/decline`)
      .expect(200);

    expect((await statusOf(registrationId)).status).toBe(
      RegistrationStatus.DECLINED,
    );
    expect((await statusOf(w1)).status).toBe(
      RegistrationStatus.AWAITING_CONFIRMATION,
    );
    expect(await statusOf(w2)).toMatchObject({
      status: RegistrationStatus.WAITLISTED,
      waitlistPosition: 1,
    });
  });

  it('cancelling a confirmed seat frees it for waitlist #1', async () => {
    const { event, person, registrationId } = await offeredSeat(1);
    const w1 = await registerVia(event.eventId, await createPerson());
    await review.setWaitlist(event.eventId, [w1], prMemberId);
    await as(person)
      .post(`/registrations/${registrationId}/confirm`)
      .expect(200);

    const response = await as(person)
      .post(`/registrations/${registrationId}/decline`)
      .expect(200);

    expect(response.body.data.status).toBe('CANCELLED');
    expect((await statusOf(w1)).status).toBe(
      RegistrationStatus.AWAITING_CONFIRMATION,
    );
  });

  it('cancelling within two hours of the start is late and leaves a notice', async () => {
    const { event, person, registrationId } = await offeredSeat();
    await as(person)
      .post(`/registrations/${registrationId}/confirm`)
      .expect(200);
    const startsAt = new Date(Date.now() + HOUR);
    await prisma.event.update({
      where: { eventId: event.eventId },
      data: { registrationDeadline: startsAt, startsAt },
    });

    const response = await as(person)
      .post(`/registrations/${registrationId}/decline`)
      .expect(200);

    expect(response.body.data.status).toBe('LATE_CANCELLATION');
    expect(
      await prisma.registrationBlacklistEntry.count({
        where: { registrationId, reason: 'LATE_CANCELLATION' },
      }),
    ).toBe(1);
  });

  it('leaving the waitlist renumbers it without giving away a seat', async () => {
    const { event } = await offeredSeat(1);
    const leaver = await createPerson();
    const w1 = await registerVia(event.eventId, leaver);
    const w2 = await registerVia(event.eventId, await createPerson());
    await review.setWaitlist(event.eventId, [w1, w2], prMemberId);

    await as(leaver).post(`/registrations/${w1}/decline`).expect(200);

    expect(await statusOf(w1)).toMatchObject({
      status: RegistrationStatus.DECLINED,
      waitlistPosition: null,
    });
    expect(await statusOf(w2)).toMatchObject({
      status: RegistrationStatus.WAITLISTED,
      waitlistPosition: 1,
    });
  });
});

describe('POST /events/:eventId/check-in', () => {
  // PR staff scanning at the door.
  function asPrStaff() {
    const agent = as(prPersonId);
    actingMemberId = prMemberId;
    return agent;
  }

  // A confirmed guest of an event that starts in 30 minutes (scanning open).
  async function confirmedGuest() {
    const event = await createEvent();
    const person = await createPerson();
    const registrationId = await registerVia(event.eventId, person);
    await review.review(registrationId, 'ACCEPT', prMemberId);
    const confirmed = await as(person)
      .post(`/registrations/${registrationId}/confirm`)
      .expect(200);
    const startsAt = new Date(Date.now() + 30 * 60_000);
    await prisma.event.update({
      where: { eventId: event.eventId },
      data: { registrationDeadline: startsAt, startsAt },
    });
    return {
      event,
      registrationId,
      token: confirmed.body.data.attendanceToken as string,
    };
  }

  it('checks in once, then answers Already Checked In', async () => {
    const { event, registrationId, token } = await confirmedGuest();

    const first = await asPrStaff()
      .post(`/events/${event.eventId}/check-in`)
      .send({ token })
      .expect(200);
    expect(first.body.data).toMatchObject({ registrationId, name: 'Guest' });
    expect((await statusOf(registrationId)).checkedInAt).not.toBeNull();

    const again = await asPrStaff()
      .post(`/events/${event.eventId}/check-in`)
      .send({ token })
      .expect(409);
    expect(again.body.error.code).toBe('ALREADY_CHECKED_IN');

    const list = await asPrStaff()
      .get(`/events/${event.eventId}/registrations`)
      .expect(200);
    expect(list.body.data.summary).toMatchObject({
      confirmed: 1,
      checkedIn: 1,
      notCheckedIn: 0,
    });
  });

  it('answers Invalid QR Code for an unknown token or another event', async () => {
    const { token } = await confirmedGuest();
    const other = await createEvent();

    for (const [eventId, sent] of [
      [other.eventId, token],
      [other.eventId, 'not-a-real-token'],
    ] as const) {
      const response = await asPrStaff()
        .post(`/events/${eventId}/check-in`)
        .send({ token: sent })
        .expect(400);
      expect(response.body.error.code).toBe('INVALID_QR_CODE');
    }
  });

  it('refuses outside the check-in window and for non-PR accounts', async () => {
    const { event, token } = await confirmedGuest();
    await as(await createPerson())
      .post(`/events/${event.eventId}/check-in`)
      .send({ token })
      .expect(403);

    const later = new Date(Date.now() + 5 * HOUR);
    await prisma.event.update({
      where: { eventId: event.eventId },
      data: { startsAt: later, endsAt: new Date(later.getTime() + HOUR) },
    });
    const closed = await asPrStaff()
      .post(`/events/${event.eventId}/check-in`)
      .send({ token })
      .expect(409);
    expect(closed.body.error.code).toBe('CHECK_IN_CLOSED');
  });
});
