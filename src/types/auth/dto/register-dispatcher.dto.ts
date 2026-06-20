import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDispatcherDto {
  @ApiProperty({
    description: 'Short-lived verification token returned by /auth/verify-code',
  })
  @IsString()
  verificationToken: string;

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
}
