import { IsOptional, IsString, IsUrl, Matches, MaxLength } from 'class-validator';

const URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: true };

export class UpdateSocialLinksDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl(URL_OPTIONS, { message: 'Enter a valid URL.' })
  @Matches(/^https?:\/\/(?:www\.)?github\.com(?:[/:?#]|$)/i, {
    message: 'GitHub links must use github.com.',
  })
  githubUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl(URL_OPTIONS, { message: 'Enter a valid URL.' })
  portfolioUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl(URL_OPTIONS, { message: 'Enter a valid URL.' })
  @Matches(/^https?:\/\/(?:www\.)?x\.com(?:[/:?#]|$)/i, {
    message: 'X links must use x.com.',
  })
  xUrl?: string | null;
}
