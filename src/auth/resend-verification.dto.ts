import { IsEmail, MaxLength } from 'class-validator';

export class ResendPersonalVerificationDto {
  @IsEmail()
  @MaxLength(255)
  email: string;
}
