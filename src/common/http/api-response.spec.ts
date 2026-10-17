import { BadRequestException } from '@nestjs/common';
import {
  apiSuccess,
  apiValidationDetails,
  apiValidationError,
} from './api-response.js';

describe('apiSuccess', () => {
  it('wraps success', () => {
    expect(apiSuccess({ id: 1 })).toEqual({
      success: true,
      message: 'OK',
      data: { id: 1 },
      error: null,
    });
  });

  it.each([0, false, ''])('preserves falsy data: %j', (data) => {
    expect(apiSuccess(data).data).toBe(data);
  });

  it.each([null, undefined])('normalizes absent data: %j', (data) => {
    expect(apiSuccess(data)).toEqual({
      success: true,
      message: 'OK',
      data: null,
      error: null,
    });
  });

  it('uses the supplied public message', () => {
    expect(apiSuccess(null, 'Completed.').message).toBe('Completed.');
  });
});

describe('validation details ownership', () => {
  const details = [{ pointer: '/email', message: 'Email must be valid.' }];

  it('recognizes only owned validation details', () => {
    const exception = apiValidationError(details);

    expect(exception).toBeInstanceOf(BadRequestException);
    expect(exception.getStatus()).toBe(400);
    expect(exception.errorCode).toBe('VALIDATION_ERROR');
    expect(apiValidationDetails(exception)).toEqual([
      { pointer: '/email', message: 'Email must be valid.' },
    ]);
  });

  it('keeps owned details out of enumerable exception data', () => {
    const exception = apiValidationError(details);

    expect(apiValidationDetails(exception)).toEqual(details);
    expect(JSON.stringify(exception)).not.toContain('/email');
    expect(JSON.stringify(exception.getResponse())).not.toContain('/email');
    expect(apiValidationDetails({ ...exception })).toBeUndefined();
  });

  it.each([
    new BadRequestException({ details }, { errorCode: 'VALIDATION_ERROR' }),
    { statusCode: 400, errorCode: 'VALIDATION_ERROR', details },
    new Error('not a validation error'),
    null,
    undefined,
    'VALIDATION_ERROR',
  ])('rejects unowned validation details: %j', (exception) => {
    expect(apiValidationDetails(exception)).toBeUndefined();
  });
});
