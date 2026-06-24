import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
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
  ApiQuery,
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
  CreateDispatcherDto,
  DispatcherLoginDto,
  QueryUsersDto,
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

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('admin/users')
  @ApiOperation({
    summary: 'List users with filters (ADMIN) — role / isActive / search, paginated',
  })
  @ApiQuery({ name: 'role', required: false, enum: ['ADMIN', 'DISPATCHER'] })
  @ApiQuery({ name: 'isActive', required: false, enum: ['TRUE', 'FALSE'] })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Contains match against username, phone, or fullName',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiForbiddenResponse({ description: 'Access denied' })
  listUsers(@Query() query: QueryUsersDto) {
    return this.authService.listUsers(query);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'DISPATCHER')
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({
    summary:
      'Get the currently authenticated user (resolved from the JWT). Works for both ADMIN and DISPATCHER.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  getMe(@Req() req: { user: { userId: number; role: 'ADMIN' | 'DISPATCHER' } }) {
    return this.authService.getMe(req.user.userId);
  }

  @Post('admin/create-dispatcher')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'DEV / TESTING: create a DISPATCHER directly, bypassing the SMS OTP flow. Open during initial setup like /admin/create-admin.',
  })
  @ApiBody({ type: CreateDispatcherDto })
  @ApiConflictResponse({ description: 'Phone or username already taken' })
  createDispatcherDev(@Body() dto: CreateDispatcherDto) {
    return this.authService.createDispatcherDev(dto);
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
