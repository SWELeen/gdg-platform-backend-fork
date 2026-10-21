import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';

export class AnswerDto {
  @IsInt({ message: 'questionId must be a whole number.' })
  @Min(1, { message: 'questionId must be positive.' })
  questionId: number;

  // A string for text, select and radio questions; a list of the chosen
  // options for checkbox questions. The service checks it per question type.
  @IsDefined({ message: 'answer is required.' })
  answer: string | string[];
}

export class RegisterForEventDto {
  @IsOptional()
  @IsArray({ message: 'answers must be a list.' })
  @ArrayMaxSize(100, { message: 'answers is too long.' })
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers?: AnswerDto[];
}
