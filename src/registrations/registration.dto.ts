import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { RegistrationStatus } from '../generated/prisma/client.js';

// The global pipe validates but does not transform, so query values stay
// strings here and the controller converts them after validation.
export class ListRegistrationsQueryDto {
  @IsOptional()
  @Matches(/^[1-9]\d{0,5}$/, {
    message: 'page must be a positive whole number.',
  })
  page?: string;

  @IsOptional()
  @Matches(/^([1-9]|[1-9]\d|100)$/, {
    message: 'pageSize must be between 1 and 100.',
  })
  pageSize?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'search must be at most 255 characters.' })
  search?: string;

  @IsOptional()
  @IsIn(Object.values(RegistrationStatus), {
    message: 'status must be a registration status.',
  })
  status?: RegistrationStatus;
}

export class ReviewRegistrationDto {
  @IsIn(['ACCEPTED', 'REJECTED'], {
    message: 'status must be ACCEPTED or REJECTED.',
  })
  status: 'ACCEPTED' | 'REJECTED';
}

export class SetWaitlistDto {
  @IsArray({ message: 'registrationIds must be a list.' })
  @ArrayMaxSize(10_000, { message: 'registrationIds is too long.' })
  @ArrayUnique({ message: 'registrationIds must not repeat.' })
  @IsInt({ each: true, message: 'registrationIds must be whole numbers.' })
  @Min(1, { each: true, message: 'registrationIds must be positive.' })
  registrationIds: number[];
}

export class CheckInDto {
  @IsString({ message: 'token must be text.' })
  @MaxLength(200, { message: 'token is too long.' })
  token: string;
}
