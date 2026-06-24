import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Dev / testing only. Creates a DISPATCHER directly, bypassing the
 * send-code → verify-code OTP flow used by /auth/register.
 */
export class CreateDispatcherDto {
  @ApiProperty({ example: '+998901234567', description: '+998XXXXXXXXX' })
  @IsString()
  @Matches(/^\+998\d{9}$/, {
    message: 'phone must match +998XXXXXXXXX',
  })
  phone: string;

  @ApiProperty({ example: 'dispatcher_007', minLength: 3, maxLength: 32 })
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[a-zA-Z0-9_.-]+$/, {
    message: 'username may only contain letters, digits, _, . and -',
  })
  username: string;

  @ApiProperty({ example: 'Str0ngP@ssw0rd', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ example: 'Aliyev Ali' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
