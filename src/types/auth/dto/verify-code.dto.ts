import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Length, Matches } from 'class-validator';
import { VerificationPurposeDto } from './send-code.dto';

export class VerifyCodeDto {
  @ApiProperty({ example: '+998901234567' })
  @IsString()
  @Matches(/^\+998\d{9}$/)
  phone: string;

  @ApiProperty({ example: '123456', description: '6-digit numeric code' })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code: string;

  @ApiProperty({ enum: VerificationPurposeDto })
  @IsEnum(VerificationPurposeDto)
  purpose: VerificationPurposeDto;
}
