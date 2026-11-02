import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';

export const EVENT_DISCOVERY_SOURCES = [
  'WHATSAPP',
  'X',
  'LINKEDIN',
  'ME_QR',
  'LUMA_FEED',
  'GOOGLE',
  'INSTAGRAM',
  'TECH',
] as const;

export type EventDiscoverySource = (typeof EVENT_DISCOVERY_SOURCES)[number];

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
  @IsIn(EVENT_DISCOVERY_SOURCES, {
    message: 'discoverySource must be a supported event discovery source.',
  })
  discoverySource: EventDiscoverySource;

  @IsOptional()
  @IsArray({ message: 'answers must be a list.' })
  @ArrayMaxSize(100, { message: 'answers is too long.' })
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers?: AnswerDto[];
}
