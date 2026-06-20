import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import {
  AdminLoginDto,
  CreateAdminDto,
  DispatcherLoginDto,
  RegisterDispatcherDto,
  ResetPasswordDto,
  SendCodeDto,
  UpdateUserDto,
  VerifyCodeDto,
} from '@/types/auth';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ---------- ADMIN ----------

  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin login (username + password)' })
  @ApiBody({ type: AdminLoginDto })
  @ApiOkResponse({ description: 'JWT access token' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  adminLogin(@Body() dto: AdminLoginDto) {
    return this.authService.adminLogin(dto);
  }

  @Post('admin/create-admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new ADMIN account (open during initial setup)' })
  @ApiBody({ type: CreateAdminDto })
  @ApiConflictResponse({ description: 'Username already exists' })
  createAdmin(@Body() dto: CreateAdminDto) {
    return this.authService.createAdmin(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Patch('admin/update-user/:id')
  @ApiOperation({ summary: 'Update user (ADMIN) — toggle isActive / change fullName' })
  @ApiParam({ name: 'id', type: Number })
  @ApiBody({ type: UpdateUserDto })
  @ApiForbiddenResponse({ description: 'Access denied' })
  updateUser(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
  ) {
    return this.authService.updateUser(id, dto);
  }

  // ---------- DISPATCHER  - phone verification ----------

  @Post('send-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Send a 6-digit verification code via Telegram Gateway. Use for REGISTER or RESET_PASSWORD.',
  })
  @ApiBody({ type: SendCodeDto })
  sendCode(@Body() dto: SendCodeDto) {
    return this.authService.sendCode(dto);
  }

  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Verify the 6-digit code and receive a short-lived verification token (10 min).',
  })
  @ApiBody({ type: VerifyCodeDto })
  verifyCode(@Body() dto: VerifyCodeDto) {
    return this.authService.verifyCode(dto);
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a DISPATCHER account using the verification token from /verify-code (REGISTER scope).',
  })
  @ApiBody({ type: RegisterDispatcherDto })
  register(@Body() dto: RegisterDispatcherDto) {
    return this.authService.registerDispatcher(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Set a new password using the verification token from /verify-code (RESET_PASSWORD scope).',
  })
  @ApiBody({ type: ResetPasswordDto })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dispatcher login by username OR phone (+998XXXXXXXXX) + password' })
  @ApiBody({ type: DispatcherLoginDto })
  dispatcherLogin(@Body() dto: DispatcherLoginDto) {
    return this.authService.dispatcherLogin(dto);
  }
}
