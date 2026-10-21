import { IsEmail, MaxLength } from 'class-validator';

export class CheckEmailDto {
  @IsEmail({}, { message: 'email must be a valid email address.' })
  @MaxLength(255, { message: 'email must be at most 255 characters.' })
  email: string;
}
