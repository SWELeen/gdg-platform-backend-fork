import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export enum CommitteeTaskPriority {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export enum CommitteeTaskStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

export class CreateCommitteeMemberDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(255)
  @Matches(/^[\p{L}\s.'-]+$/u)
  fullName!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class AddMemberToCommitteeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  committeeCode!: string;
}

export class CreateCommitteeTaskDto {
  @IsString()
  @MaxLength(150)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsInt()
  @Min(1)
  assignedMemberId!: number;

  @IsDateString()
  dueAt!: string;

  @IsEnum(CommitteeTaskPriority)
  priority!: CommitteeTaskPriority;

  @IsOptional()
  @IsEnum(CommitteeTaskStatus)
  status?: CommitteeTaskStatus;
}

export class UpdateCommitteeTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  assignedMemberId?: number;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsEnum(CommitteeTaskPriority)
  priority?: CommitteeTaskPriority;

  @IsOptional()
  @IsEnum(CommitteeTaskStatus)
  status?: CommitteeTaskStatus;
}

export class UpdateCommitteePointsDto {
  @IsInt()
  pointsDelta!: number;

  @IsString()
  @MaxLength(500)
  reason!: string;
}

export const EVENT_TYPES = ['Workshop', 'Conference', 'Talk', 'Panel', 'Hackathon'] as const;
export const REGISTRANT_FIELDS = ['fullName', 'universityId', 'college', 'major', 'phone', 'email', 'membership'] as const;
export const EVENT_QUESTION_TYPES = ['TEXT', 'SELECT', 'RADIO', 'CHECKBOX'] as const;

export class CreateEventQuestionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  text!: string;

  @IsIn(EVENT_QUESTION_TYPES)
  type!: (typeof EVENT_QUESTION_TYPES)[number];

  @IsBoolean()
  required!: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  options?: string[];
}

export class CreateCommitteeEventDto {
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description!: string;

  @IsIn(EVENT_TYPES)
  eventType!: (typeof EVENT_TYPES)[number];

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsDateString()
  registrationDeadline!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  location!: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  mapsLink?: string;

  @IsInt()
  @Min(1)
  @Max(5000)
  capacity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  speakers?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  requirements?: string;

  @IsOptional()
  @IsArray()
  @IsIn(REGISTRANT_FIELDS, { each: true })
  requiredRegistrantFields?: (typeof REGISTRANT_FIELDS)[number][];

  @IsIn(['PUBLISHED', 'DRAFT'])
  status!: 'PUBLISHED' | 'DRAFT';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateEventQuestionDto)
  questions?: CreateEventQuestionDto[];
}
