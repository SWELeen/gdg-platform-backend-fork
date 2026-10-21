import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SignupDto {
  @IsString({ message: 'fullName must be text.' })
  @Matches(/\S/, { message: 'fullName is required.' })
  @MaxLength(255, { message: 'fullName must be at most 255 characters.' })
  fullName: string;

  @IsEmail({}, { message: 'email must be a valid email address.' })
  @MaxLength(255, { message: 'email must be at most 255 characters.' })
  email: string;

  @IsString({ message: 'password must be text.' })
  @MinLength(8, { message: 'password must be at least 8 characters.' })
  @MaxLength(72, { message: 'password must be at most 72 characters.' })
  password: string;
}
