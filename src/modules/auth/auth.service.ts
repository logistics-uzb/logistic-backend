import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { SmsService } from '@/external/eskiz/sms.service';
import {
  AuthCodeConfig,
  CONFIG_AUTH_CODE_TOKEN,
} from '@/common/config/app.config';
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
  VerificationPurposeDto,
  VerifyCodeDto,
} from '@/types/auth';
import { Prisma, VerificationPurpose } from '@prisma/client';

const USER_PUBLIC_SELECT: Prisma.UserSelect = {
  id: true,
  fullName: true,
  username: true,
  phone: true,
  role: true,
  isActive: true,
  paymentDate: true,
  createdAt: true,
  updatedAt: true,
};

type SessionPayload = { userId: number; role: 'ADMIN' | 'DISPATCHER' };
type VerificationTokenPayload = {
  purpose: 'verification';
  phone: string;
  scope: VerificationPurpose;
};

const PHONE_REGEX = /^\+998\d{9}$/;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly codeCfg: AuthCodeConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly sms: SmsService,
    configService: ConfigService,
  ) {
    this.codeCfg = configService.get<AuthCodeConfig>(CONFIG_AUTH_CODE_TOKEN);
  }

  // ---------------------------------------------------------------------------
  // ADMIN
  // ---------------------------------------------------------------------------

  async adminLogin(dto: AdminLoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { username: dto.username, role: 'ADMIN' },
    });
    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.isActive) {
      throw new ForbiddenException('User is inactive');
    }

    const match = await bcrypt.compare(dto.password, user.password);
    if (!match) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.signSession({ userId: user.id, role: 'ADMIN' });
  }

  async createAdmin(dto: CreateAdminDto) {
    const exists = await this.prisma.user.findFirst({
      where: { username: dto.username },
    });
    if (exists) {
      throw new ConflictException('Username already exists');
    }

    const hashed = await bcrypt.hash(dto.password, 10);

    return this.prisma.user.create({
      data: {
        fullName: dto.fullName ?? null,
        username: dto.username,
        password: hashed,
        role: 'ADMIN',
        isActive: true,
      },
      select: {
        id: true,
        fullName: true,
        username: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  async getMe(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_PUBLIC_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async listUsers(query: QueryUsersDto) {
    const page = query?.page && query.page > 0 ? query.page : 1;
    const limit =
      query?.limit && query.limit > 0 && query.limit <= 100 ? query.limit : 20;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};
    if (query?.role) where.role = query.role;
    if (query?.isActive) where.isActive = query.isActive === 'TRUE';
    if (query?.search) {
      const s = query.search.trim();
      if (s) {
        where.OR = [
          { username: { contains: s, mode: 'insensitive' } },
          { fullName: { contains: s, mode: 'insensitive' } },
          { phone: { contains: s, mode: 'insensitive' } },
        ];
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: USER_PUBLIC_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      count: data.length,
      data,
    };
  }

  /**
   * Dev / testing path: create a DISPATCHER without the OTP round-trip.
   * Mirrors registerDispatcher's uniqueness checks (username + phone) but
   * skips send-code / verify-code so QA can seed accounts directly.
   */
  async createDispatcherDev(dto: CreateDispatcherDto) {
    const phone = this.assertPhone(dto.phone);

    const [phoneTaken, usernameTaken] = await Promise.all([
      this.prisma.user.findUnique({ where: { phone } }),
      this.prisma.user.findUnique({ where: { username: dto.username } }),
    ]);
    if (phoneTaken) throw new ConflictException('Phone is already registered');
    if (usernameTaken) throw new ConflictException('Username already taken');

    const passwordHash = await bcrypt.hash(dto.password, 10);

    return this.prisma.user.create({
      data: {
        phone,
        username: dto.username,
        password: passwordHash,
        fullName: dto.fullName ?? null,
        role: 'DISPATCHER',
        isActive: dto.isActive ?? true,
      },
      select: USER_PUBLIC_SELECT,
    });
  }

  async updateUser(id: number, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id },
      data: {
        fullName: dto.fullName ?? user.fullName,
        isActive:
          typeof dto.isActive === 'boolean' ? dto.isActive : user.isActive,
      },
      select: {
        id: true,
        fullName: true,
        username: true,
        phone: true,
        role: true,
        isActive: true,
        updatedAt: true,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // DISPATCHER SELF-REGISTRATION  - phone verification
  // ---------------------------------------------------------------------------

  async sendCode(dto: SendCodeDto): Promise<{ sent: true; expiresInSeconds: number }> {
    const phone = this.assertPhone(dto.phone);
    const purpose = this.toPurpose(dto.purpose);

    if (purpose === VerificationPurpose.REGISTER) {
      const taken = await this.prisma.user.findUnique({ where: { phone } });
      if (taken) {
        throw new ConflictException('Phone is already registered');
      }
    } else {
      const user = await this.prisma.user.findUnique({ where: { phone } });
      if (!user || user.role !== 'DISPATCHER') {
        throw new NotFoundException('No dispatcher account for this phone');
      }
    }

    const latest = await this.prisma.verificationCode.findFirst({
      where: { phone, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (latest) {
      const ageSec = (Date.now() - latest.createdAt.getTime()) / 1000;
      if (ageSec < this.codeCfg.resendCooldownSeconds) {
        const wait = Math.ceil(this.codeCfg.resendCooldownSeconds - ageSec);
        throw new BadRequestException(
          `Please wait ${wait}s before requesting another code`,
        );
      }
    }

    const code = this.generateCode();
    const codeHash = await bcrypt.hash(code, 8);
    const expiresAt = new Date(Date.now() + this.codeCfg.ttlSeconds * 1000);

    await this.prisma.$transaction([
      this.prisma.verificationCode.updateMany({
        where: { phone, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.verificationCode.create({
        data: {
          phone,
          codeHash,
          purpose,
          attemptsLeft: this.codeCfg.maxAttempts,
          expiresAt,
        },
      }),
    ]);

    const sent = await this.sms.sendOtp(phone, code);
    if (!sent) {
      throw new BadRequestException(
        'Failed to deliver SMS verification code. Please try again.',
      );
    }
    this.logger.log(`Sent verification code to ${phone} (${purpose})`);

    return { sent: true, expiresInSeconds: this.codeCfg.ttlSeconds };
  }

  async verifyCode(dto: VerifyCodeDto): Promise<{ verificationToken: string }> {
    const phone = this.assertPhone(dto.phone);
    const purpose = this.toPurpose(dto.purpose);

    const record = await this.prisma.verificationCode.findFirst({
      where: { phone, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) {
      throw new BadRequestException('No active verification code; request a new one');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Verification code expired');
    }
    if (record.attemptsLeft <= 0) {
      throw new BadRequestException('Too many attempts; request a new code');
    }

    const match = await bcrypt.compare(dto.code, record.codeHash);
    if (!match) {
      await this.prisma.verificationCode.update({
        where: { id: record.id },
        data: { attemptsLeft: record.attemptsLeft - 1 },
      });
      throw new BadRequestException('Invalid verification code');
    }

    await this.prisma.verificationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    const payload: VerificationTokenPayload = {
      purpose: 'verification',
      phone,
      scope: purpose,
    };
    const verificationToken = this.jwtService.sign(payload, { expiresIn: '10m' });
    return { verificationToken };
  }

  async registerDispatcher(dto: RegisterDispatcherDto) {
    const { phone } = this.consumeVerificationToken(
      dto.verificationToken,
      VerificationPurpose.REGISTER,
    );

    const usernameTaken = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (usernameTaken) {
      throw new ConflictException('Username already taken');
    }
    const phoneTaken = await this.prisma.user.findUnique({ where: { phone } });
    if (phoneTaken) {
      throw new ConflictException('Phone is already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const created = await this.prisma.user.create({
      data: {
        phone,
        username: dto.username,
        password: passwordHash,
        fullName: dto.fullName ?? null,
        role: 'DISPATCHER',
        isActive: true,
      },
      select: {
        id: true,
        fullName: true,
        username: true,
        phone: true,
        role: true,
        isActive: true,
        paymentDate: true,
        createdAt: true,
      },
    });

    const { accessToken } = this.signSession({
      userId: created.id,
      role: 'DISPATCHER',
    });
    return { accessToken, user: created };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const { phone } = this.consumeVerificationToken(
      dto.verificationToken,
      VerificationPurpose.RESET_PASSWORD,
    );

    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user || user.role !== 'DISPATCHER') {
      throw new NotFoundException('Dispatcher not found');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: passwordHash },
    });

    const { accessToken } = this.signSession({
      userId: user.id,
      role: 'DISPATCHER',
    });
    return { accessToken };
  }

  async dispatcherLogin(dto: DispatcherLoginDto) {
    const where: Prisma.UserWhereInput = PHONE_REGEX.test(dto.login)
      ? { phone: dto.login }
      : { username: dto.login };

    const user = await this.prisma.user.findFirst({ where });
    if (!user || !user.password || user.role !== 'DISPATCHER') {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.isActive) {
      throw new ForbiddenException('Account is inactive');
    }

    const ok = await bcrypt.compare(dto.password, user.password);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { accessToken } = this.signSession({
      userId: user.id,
      role: 'DISPATCHER',
    });
    return {
      accessToken,
      user: {
        id: user.id,
        fullName: user.fullName,
        username: user.username,
        phone: user.phone,
        role: user.role,
        paymentDate: user.paymentDate,
        isActive: user.isActive,
        createdAt: user.createdAt,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private signSession(payload: SessionPayload) {
    return { accessToken: this.jwtService.sign(payload) };
  }

  private consumeVerificationToken(
    token: string,
    expected: VerificationPurpose,
  ): { phone: string } {
    let decoded: VerificationTokenPayload;
    try {
      decoded = this.jwtService.verify<VerificationTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired verification token');
    }
    if (decoded.purpose !== 'verification' || decoded.scope !== expected) {
      throw new UnauthorizedException('Verification token scope mismatch');
    }
    if (!PHONE_REGEX.test(decoded.phone)) {
      throw new UnauthorizedException('Verification token is malformed');
    }
    return { phone: decoded.phone };
  }

  private assertPhone(phone: string): string {
    if (!PHONE_REGEX.test(phone)) {
      throw new BadRequestException('Invalid phone format; expected +998XXXXXXXXX');
    }
    return phone;
  }

  private toPurpose(p: VerificationPurposeDto): VerificationPurpose {
    return p === VerificationPurposeDto.REGISTER
      ? VerificationPurpose.REGISTER
      : VerificationPurpose.RESET_PASSWORD;
  }

  private generateCode(): string {
    const n = Math.floor(Math.random() * 1_000_000);
    return n.toString().padStart(6, '0');
  }
}
