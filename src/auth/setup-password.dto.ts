import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RequestSetupLinkDto {
  @IsEmail({}, { message: 'email must be a valid email address.' })
  @MaxLength(255, { message: 'email must be at most 255 characters.' })
  email: string;

  @IsOptional()
  @IsIn(['en', 'ar'], { message: 'locale must be en or ar.' })
  locale?: 'en' | 'ar';
}

export class SetupPasswordDto {
  @IsString({ message: 'password must be text.' })
  @MinLength(8, { message: 'password must be at least 8 characters.' })
  @MaxLength(72, { message: 'password must be at most 72 characters.' })
  password: string;
}

export class CompleteSetupPasswordDto extends SetupPasswordDto {
  @IsString({ message: 'tokenHash must be text.' })
  @MinLength(1, { message: 'tokenHash is required.' })
  @MaxLength(512, { message: 'tokenHash must be at most 512 characters.' })
  tokenHash: string;

  @IsIn(['recovery', 'invite'], { message: 'type must be recovery or invite.' })
  type: 'recovery' | 'invite';
}
