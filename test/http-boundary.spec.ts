import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  type INestApplication,
  Logger,
  Param,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsEmail,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import type { Response } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { apiSuccess } from '../src/common/http/api-response.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const secret = 'never-echo';

class AnswerInputDto {
  @IsDefined({ message: 'Value is required.' })
  @IsString({ message: 'Value must be text.' })
  value: string;
}

class ValidationInputDto {
  @IsDefined({ message: 'Email is required.' })
  @IsEmail({}, { message: 'Email must be valid.' })
  email: string;

  @IsOptional()
  @IsArray({ message: 'Answers must be an array.' })
  @ValidateNested({ each: true, message: 'Each answer must be an object.' })
  @Type(() => AnswerInputDto)
  answers?: AnswerInputDto[];
}

@Controller('__test/http')
class HttpBoundaryFixtures {
  @Post('validate')
  validate(@Body() body: ValidationInputDto) {
    return apiSuccess(body);
  }

  @Get('status/:status')
  status(@Param('status') status: string): never {
    throw new HttpException(
      { message: secret, token: secret, stack: secret },
      Number(status),
    );
  }

  @Get('unowned-validation')
  unownedValidation(): never {
    throw new BadRequestException(
      { details: [{ pointer: secret, message: secret }] },
      { errorCode: 'VALIDATION_ERROR' },
    );
  }

  @Get('mismatched-code')
  mismatchedCode(): never {
    throw new BadRequestException(secret, { errorCode: 'FORBIDDEN' });
  }

  @Get('unexpected')
  unexpected(): never {
    throw new Error(secret, { cause: new Error(secret) });
  }

  @Get('headers')
  headers(@Res({ passthrough: true }) response: Response): never {
    response.setHeader('WWW-Authenticate', 'Bearer');
    response.setHeader('Retry-After', '60');
    response.setHeader('X-Existing', 'keep');
    response.setHeader('Content-Type', 'text/plain');
    throw new UnauthorizedException(secret);
  }
}

describe('HTTP error boundary', () => {
  let app: INestApplication;
  let logs: unknown[][];

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [HttpBoundaryFixtures],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/unavailable',
        }),
      )
      .compile();

    app = fixture.createNestApplication({ logger: false });
    await app.init();
  });

  beforeEach(() => {
    logs = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation(
      (...args: unknown[]) => {
        logs.push(args);
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    { status: 400, code: 'BAD_REQUEST', message: 'The request is invalid.' },
    {
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication is required.',
    },
    {
      status: 403,
      code: 'FORBIDDEN',
      message: 'You do not have permission to perform this action.',
    },
    {
      status: 404,
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
    },
    {
      status: 409,
      code: 'CONFLICT',
      message: 'The request conflicts with the current state.',
    },
    {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    },
    ...[413, 429, 503].map((status) => ({
      status,
      code: 'HTTP_ERROR',
      message: 'The request could not be completed.',
    })),
  ])(
    'formats HTTP $status through AppModule registration',
    async ({ status, code, message }) => {
      const response = await request(app.getHttpServer())
        .get(`/__test/http/status/${status}`)
        .expect(status)
        .expect('Content-Type', /^application\/json/);

      expect(response.body).toEqual({
        success: false,
        message,
        data: null,
        error: { code, details: [] },
      });
      expect(response.text).not.toContain(secret);
      if (status >= 500) {
        expect(logs).toEqual([
          [
            {
              event: 'http_request_failed',
              category: 'HTTP_SERVER_ERROR',
              method: 'GET',
              status,
              code,
            },
          ],
        ]);
      } else {
        expect(logs).toEqual([]);
      }
    },
  );

  it('formats a real unknown route without reflecting its path or query', async () => {
    const response = await request(app.getHttpServer())
      .get(`/missing-resource?token=${secret}`)
      .expect(404)
      .expect('Content-Type', /^application\/json/);

    expect(response.body).toEqual({
      success: false,
      message: 'The requested resource was not found.',
      data: null,
      error: { code: 'NOT_FOUND', details: [] },
    });
    expect(response.text).not.toContain('/missing-resource');
    expect(response.text).not.toContain(secret);
    expect(logs).toEqual([]);
  });

  it.each(['unowned-validation', 'mismatched-code'])(
    'rejects %s metadata',
    async (path) => {
      const response = await request(app.getHttpServer())
        .get(`/__test/http/${path}`)
        .expect(400)
        .expect('Content-Type', /^application\/json/);

      expect(response.body).toEqual({
        success: false,
        message: 'The request is invalid.',
        data: null,
        error: { code: 'BAD_REQUEST', details: [] },
      });
      expect(response.text).not.toContain(secret);
      expect(logs).toEqual([]);
    },
  );

  it('hides unexpected exception, cause and request secrets in body and diagnostics', async () => {
    const response = await request(app.getHttpServer())
      .get(`/__test/http/unexpected?token=${secret}`)
      .set('Authorization', `Bearer ${secret}`)
      .expect(500)
      .expect('Content-Type', /^application\/json/);

    expect(response.body).toEqual({
      success: false,
      message: 'An unexpected error occurred.',
      data: null,
      error: { code: 'INTERNAL_ERROR', details: [] },
    });
    expect(response.text).not.toContain(secret);
    expect(logs).toEqual([
      [
        {
          event: 'http_request_failed',
          category: 'UNEXPECTED_EXCEPTION',
          method: 'GET',
          status: 500,
          code: 'INTERNAL_ERROR',
        },
      ],
    ]);
  });

  it('preserves existing headers and replaces a stale non-JSON content type', async () => {
    const response = await request(app.getHttpServer())
      .get('/__test/http/headers')
      .expect(401)
      .expect('Content-Type', /^application\/json/)
      .expect('WWW-Authenticate', 'Bearer')
      .expect('Retry-After', '60')
      .expect('X-Existing', 'keep');

    expect(response.body).toEqual({
      success: false,
      message: 'Authentication is required.',
      data: null,
      error: { code: 'UNAUTHORIZED', details: [] },
    });
    expect(response.text).not.toContain(secret);
    expect(logs).toEqual([]);
  });

  it('preserves the existing successful root text', async () => {
    const response = await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Content-Type', /^text\//);

    expect(response.text).toBe('Hello World!');
    expect(logs).toEqual([]);
  });

  it('accepts a valid DTO through the actual AppModule pipe registration', async () => {
    const body = {
      email: 'member@example.com',
      answers: [{ value: 'Public test answer.' }],
    };
    const response = await request(app.getHttpServer())
      .post('/__test/http/validate')
      .send(body)
      .expect(201)
      .expect('Content-Type', /^application\/json/);

    expect(response.body).toEqual({
      success: true,
      message: 'OK',
      data: body,
      error: null,
    });
    expect(logs).toEqual([]);
  });

  it.each([
    {
      name: 'missing required email',
      body: {},
      details: [
        { pointer: '/email', message: 'Email is required.' },
        { pointer: '/email', message: 'Email must be valid.' },
      ],
    },
    {
      name: 'invalid email',
      body: { email: secret },
      details: [{ pointer: '/email', message: 'Email must be valid.' }],
    },
    {
      name: 'extra property',
      body: { email: 'member@example.com', extra: secret },
      details: [
        { pointer: '/extra', message: 'property extra should not exist' },
      ],
    },
    {
      name: 'invalid nested value',
      body: { email: 'member@example.com', answers: [{ value: 42 }] },
      details: [
        { pointer: '/answers/0/value', message: 'Value must be text.' },
      ],
    },
    {
      name: 'missing nested value',
      body: { email: 'member@example.com', answers: [{}] },
      details: [
        { pointer: '/answers/0/value', message: 'Value is required.' },
        { pointer: '/answers/0/value', message: 'Value must be text.' },
      ],
    },
    {
      name: 'wrong answers shape',
      body: { email: 'member@example.com', answers: secret },
      details: [
        { pointer: '/answers', message: 'Answers must be an array.' },
        { pointer: '/answers', message: 'Each answer must be an object.' },
      ],
    },
  ])(
    'rejects $name with HTTP validation details',
    async ({ body, details }) => {
      const response = await request(app.getHttpServer())
        .post('/__test/http/validate')
        .send(body)
        .expect(400)
        .expect('Content-Type', /^application\/json/);

      expect(response.body).toEqual({
        success: false,
        message: 'Some fields are invalid.',
        data: null,
        error: { code: 'VALIDATION_ERROR', details },
      });
      expect(response.text).not.toContain(secret);
      expect(logs).toEqual([]);
    },
  );

  it('keeps all field failures in stable order without disclosing submitted values', async () => {
    const bodies = [
      { extra: secret, email: secret, answers: [{ value: 42 }, {}] },
      { answers: [{ value: 42 }, {}], email: secret, extra: secret },
    ];
    for (const body of bodies) {
      const response = await request(app.getHttpServer())
        .post(`/__test/http/validate?token=${secret}`)
        .set('Authorization', `Bearer ${secret}`)
        .send(body)
        .expect(400)
        .expect('Content-Type', /^application\/json/);

      expect(response.body).toEqual({
        success: false,
        message: 'Some fields are invalid.',
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          details: [
            { pointer: '/answers/0/value', message: 'Value must be text.' },
            { pointer: '/answers/1/value', message: 'Value is required.' },
            { pointer: '/answers/1/value', message: 'Value must be text.' },
            { pointer: '/email', message: 'Email must be valid.' },
            { pointer: '/extra', message: 'property extra should not exist' },
          ],
        },
      });
      expect(response.text).not.toContain(secret);
      expect(logs).toEqual([]);
    }
  });

  it('rejects an array at the DTO root safely', async () => {
    const response = await request(app.getHttpServer())
      .post('/__test/http/validate')
      .send([secret])
      .expect(400)
      .expect('Content-Type', /^application\/json/);

    expect(response.body).toEqual({
      success: false,
      message: 'Some fields are invalid.',
      data: null,
      error: { code: 'VALIDATION_ERROR', details: expect.any(Array) },
    });
    expect(response.body.error.details.length).toBeGreaterThan(0);
    expect(response.text).not.toContain(secret);
    expect(logs).toEqual([]);
  });

  it.each([
    { name: 'malformed JSON', body: `{"email":"${secret}"` },
    { name: 'JSON null root', body: 'null' },
    { name: 'JSON string root', body: JSON.stringify(secret) },
  ])(
    'classifies $name as BAD_REQUEST rather than DTO validation',
    async ({ body }) => {
      const response = await request(app.getHttpServer())
        .post('/__test/http/validate')
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(400)
        .expect('Content-Type', /^application\/json/);

      expect(response.body).toEqual({
        success: false,
        message: 'The request is invalid.',
        data: null,
        error: { code: 'BAD_REQUEST', details: [] },
      });
      expect(response.text).not.toContain(secret);
      expect(logs).toEqual([]);
    },
  );

  it('classifies invalid URI encoding as BAD_REQUEST', async () => {
    const response = await request(app.getHttpServer())
      .get('/__test/http/status/%E0%A4%A')
      .expect(400)
      .expect('Content-Type', /^application\/json/);

    expect(response.body).toEqual({
      success: false,
      message: 'The request is invalid.',
      data: null,
      error: { code: 'BAD_REQUEST', details: [] },
    });
    expect(logs).toEqual([]);
  });

  it('preserves HTTP 413 for JSON exceeding the existing body limit', async () => {
    const response = await request(app.getHttpServer())
      .post('/__test/http/validate')
      .send({ email: secret, padding: 'x'.repeat(200_000) })
      .expect(413)
      .expect('Content-Type', /^application\/json/);

    expect(response.body).toEqual({
      success: false,
      message: 'The request could not be completed.',
      data: null,
      error: { code: 'HTTP_ERROR', details: [] },
    });
    expect(response.text).not.toContain(secret);
    expect(logs).toEqual([]);
  });
});
