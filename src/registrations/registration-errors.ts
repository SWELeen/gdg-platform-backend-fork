import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

// Too many changes to one event queued at once; nothing was changed.
export function registrationBusy(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    'Too many changes are in progress for this event. Please try again.',
    { errorCode: 'REGISTRATION_BUSY' },
  );
}

// Domain codes the frontend can branch on. The HTTP status stays authoritative.
export function capacityReached(): ConflictException {
  return new ConflictException('The event has no remaining capacity.', {
    errorCode: 'CAPACITY_REACHED',
  });
}

export function invalidStatusTransition(): ConflictException {
  return new ConflictException(
    'The registration cannot move to that status from its current status.',
    { errorCode: 'INVALID_STATUS_TRANSITION' },
  );
}

export function registrationNotFound(): NotFoundException {
  return new NotFoundException('The registration was not found.', {
    errorCode: 'REGISTRATION_NOT_FOUND',
  });
}

export function registrationForbidden(): ForbiddenException {
  return new ForbiddenException(
    'You do not have permission to manage registrations.',
  );
}

export function registrationClosed(): ConflictException {
  return new ConflictException('Registration for this event is closed.', {
    errorCode: 'REGISTRATION_CLOSED',
  });
}

export function alreadyRegistered(): ConflictException {
  return new ConflictException('You are already registered for this event.', {
    errorCode: 'ALREADY_REGISTERED',
  });
}

export function confirmationExpired(): ConflictException {
  return new ConflictException('The confirmation deadline has passed.', {
    errorCode: 'CONFIRMATION_EXPIRED',
  });
}

export function notYourRegistration(): ForbiddenException {
  return new ForbiddenException('This registration belongs to someone else.');
}
