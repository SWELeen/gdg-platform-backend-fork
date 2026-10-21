import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'email must be a valid email address.' })
  @MaxLength(255, { message: 'email must be at most 255 characters.' })
  email: string;

  @IsString({ message: 'password must be text.' })
  @IsNotEmpty({ message: 'password is required.' })
  @MaxLength(72, { message: 'password must be at most 72 characters.' })
  password: string;
}
