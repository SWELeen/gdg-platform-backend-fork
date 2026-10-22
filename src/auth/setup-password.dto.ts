import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RequestSetupLinkDto {
  @IsEmail({}, { message: 'email must be a valid email address.' })
  @MaxLength(255, { message: 'email must be at most 255 characters.' })
  email: string;
}

export class SetupPasswordDto {
  @IsString({ message: 'password must be text.' })
  @MinLength(8, { message: 'password must be at least 8 characters.' })
  @MaxLength(72, { message: 'password must be at most 72 characters.' })
  password: string;
}
