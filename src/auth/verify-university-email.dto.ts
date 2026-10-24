import { IsString, Matches } from 'class-validator';

export class VerifyUniversityEmailDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}
