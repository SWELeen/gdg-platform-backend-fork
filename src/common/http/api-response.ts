import { BadRequestException } from '@nestjs/common';

export interface ApiErrorDetail {
  pointer: string;
  message: string;
}

export interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T | null;
  error: null;
}

export interface ApiFailure {
  success: false;
  message: string;
  data: null;
  error: { code: string; details: readonly ApiErrorDetail[] };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function apiSuccess<T>(
  data: T | null | undefined,
  message = 'OK',
): ApiSuccess<T> {
  return { success: true, message, data: data ?? null, error: null };
}

const validationDetails = Symbol('validationDetails');
type OwnedValidationException = BadRequestException & {
  [validationDetails]: readonly ApiErrorDetail[];
};

export function apiValidationError(
  details: readonly ApiErrorDetail[],
): BadRequestException {
  const exception = new BadRequestException('Some fields are invalid.', {
    errorCode: 'VALIDATION_ERROR',
  });
  // Keep owned field details separate from arbitrary exception response bodies.
  Object.defineProperty(exception, validationDetails, { value: details });
  return exception;
}

export function apiValidationDetails(
  exception: unknown,
): readonly ApiErrorDetail[] | undefined {
  if (
    !(exception instanceof BadRequestException) ||
    !Object.hasOwn(exception, validationDetails)
  ) {
    return undefined;
  }
  return (exception as OwnedValidationException)[validationDetails];
}
