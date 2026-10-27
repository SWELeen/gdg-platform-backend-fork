import { IsString, MaxLength } from 'class-validator';

export class UpdateBioDto {
  @IsString({ message: 'Bio must be text.' })
  @MaxLength(500, { message: 'Bio must be 500 characters or fewer.' })
  bio!: string;
}
