import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class DispatcherLoginDto {
  @ApiProperty({
    description: 'Username or phone (+998XXXXXXXXX)',
    example: 'dispatcher_007',
  })
  @IsString()
  login: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}
