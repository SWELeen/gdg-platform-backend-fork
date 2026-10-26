import {
  IsEmail,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export enum CommitteeTaskPriority {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export enum CommitteeTaskStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  // Done by the member, waiting for a committee leader to confirm.
  PENDING_REVIEW = 'PENDING_REVIEW',
  COMPLETED = 'COMPLETED',
}

/** Statuses a member may set on their own task; only a leader can make it COMPLETED. */
export const MEMBER_TASK_STATUSES = [CommitteeTaskStatus.TODO, CommitteeTaskStatus.IN_PROGRESS, CommitteeTaskStatus.PENDING_REVIEW] as const;

export class UpdateMyTaskDto {
  @IsIn(MEMBER_TASK_STATUSES)
  status!: (typeof MEMBER_TASK_STATUSES)[number];
}

export class ReviewCommitteeTaskDto {
  @IsIn(['APPROVE', 'RETURN'])
  decision!: 'APPROVE' | 'RETURN';
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
