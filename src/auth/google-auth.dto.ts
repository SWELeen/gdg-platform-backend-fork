import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GoogleSessionDto {
  @IsString() @MaxLength(8192) accessToken: string;
  @IsString() @MaxLength(8192) refreshToken: string;
}

class GoogleSignupApplicationDataDto {
  @IsString() @Matches(/^\+9665\d{8}$/) phoneNumber: string;
  @IsOptional() @IsEmail() @MaxLength(255) universityEmail?: string;
  @IsString() @MaxLength(255) university: string;
  @IsOptional() @IsString() @MaxLength(100)
  @Matches(/^[^\u0000-\u001F\u007F-\u009F]*\S[^\u0000-\u001F\u007F-\u009F]*$/)
  branch?: string;
  @IsString() @MaxLength(255) college: string;
  @IsString() @MaxLength(255) major: string;
  @IsString() @MaxLength(30) level: string;
  @IsIn(['female', 'male']) gender: string;
  @IsOptional() @IsObject() skillsByCommittee?: Record<string, string[]>;
}

class GoogleSignupCommitteeDto {
  @Matches(/^[A-Z0-9_]{1,20}$/) committeeCode: string;
  @IsIn(['Leader', 'Co-Leader', 'Advisor', 'Member']) requestedRole: string;
}

export class GoogleSignupCompletionDto {
  @IsString() @Matches(/\S/) @MaxLength(255) fullName: string;
  @IsIn(['MEMBER', 'NON_MEMBER']) registrationType: 'MEMBER' | 'NON_MEMBER';
  @ValidateNested() @Type(() => GoogleSignupApplicationDataDto)
  applicationData: GoogleSignupApplicationDataDto;
  @IsOptional() @IsArray() @ArrayUnique((committee: GoogleSignupCommitteeDto) => committee.committeeCode)
  @ValidateNested({ each: true }) @Type(() => GoogleSignupCommitteeDto)
  committees?: GoogleSignupCommitteeDto[];
  @IsOptional() @IsArray() @ArrayUnique()
  @IsIn(['ADVISOR', 'DEVELOPER_COMMITTEES_LEADER'], { each: true })
  requestedGlobalRoles?: string[];
}
