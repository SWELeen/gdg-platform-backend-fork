import {
  IsEmail,
  IsDateString,
  IsEnum,
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
