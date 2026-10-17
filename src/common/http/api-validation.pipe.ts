import { Injectable, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { type ApiErrorDetail, apiValidationError } from './api-response.js';

@Injectable()
export class ApiValidationPipe extends ValidationPipe {
  constructor() {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: false,
      validationError: { target: false, value: false },
      exceptionFactory: (errors) =>
        apiValidationError(toValidationDetails(errors)),
    });
  }
}

export function toValidationDetails(
  errors: readonly ValidationError[],
): ApiErrorDetail[] {
  const details: (ApiErrorDetail & { constraint: string })[] = [];

  function visit(nodes: readonly ValidationError[], parent: string): void {
    for (const error of nodes) {
      const pointer =
        typeof error.property === 'string'
          ? `${parent}/${error.property.replaceAll('~', '~0').replaceAll('/', '~1')}`
          : parent;
      for (const [constraint, message] of Object.entries(
        error.constraints ?? {},
      )) {
        details.push({ pointer, message, constraint });
      }
      visit(error.children ?? [], pointer);
    }
  }

  visit(errors, '');
  details.sort((left, right) => {
    if (left.pointer !== right.pointer) {
      return left.pointer < right.pointer ? -1 : 1;
    }
    return left.constraint < right.constraint
      ? -1
      : left.constraint > right.constraint
        ? 1
        : 0;
  });
  return details.map(({ pointer, message }) => ({ pointer, message }));
}
