import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  type INestApplication,
  Logger,
  Param,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const secret = 'never-echo';

@Controller('__test/http')
class HttpBoundaryFixtures {
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
});
