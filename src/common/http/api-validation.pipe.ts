import type { ValidationError } from 'class-validator';
import type { ApiErrorDetail } from './api-response.js';

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
