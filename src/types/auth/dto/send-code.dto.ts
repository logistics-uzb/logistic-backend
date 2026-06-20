import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Matches } from 'class-validator';

export enum VerificationPurposeDto {
  REGISTER = 'REGISTER',
  RESET_PASSWORD = 'RESET_PASSWORD',
}

export class SendCodeDto {
  @ApiProperty({
    description: 'Uzbek phone number in E.164 format (+998XXXXXXXXX)',
    example: '+998901234567',
  })
  @IsString()
  @Matches(/^\+998\d{9}$/, {
    message: 'phone must match the format +998XXXXXXXXX (9 digits after +998)',
  })
  phone: string;

  @ApiProperty({ enum: VerificationPurposeDto, example: VerificationPurposeDto.REGISTER })
  @IsEnum(VerificationPurposeDto)
  purpose: VerificationPurposeDto;
}
