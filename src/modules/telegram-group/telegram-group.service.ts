import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/modules/prisma/prisma.service';
import {
  BulkCreateTelegramGroupDto,
  CreateTelegramGroupDto,
  QueryTelegramGroupDto,
  UpdateTelegramGroupDto,
} from '@/types/telegram-group';

/**
 * BigInt JSON'da qo'llab-quvvatlanmaydi — response'da string ga o'giramiz.
 * Prisma qatoridagi barcha BigInt maydonlarini shu funksiya orqali normalize
 * qiling (bu yerda faqat `chatId` bor).
 */
function serialize<T extends { chatId?: bigint | null }>(row: T) {
  return { ...row, chatId: row.chatId != null ? row.chatId.toString() : null };
}

@Injectable()
export class TelegramGroupService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bitta TelegramGroup yaratish. `username` yoki `chatId` — kamida biri
   * majburiy. Har ikkalasi ham unique — mavjud bo'lsa 409 qaytadi.
   */
  async create(dto: CreateTelegramGroupDto) {
    const username = normalizeUsername(dto.username);
    const chatId = normalizeChatId(dto.chatId);

    if (!username && chatId == null) {
      throw new BadRequestException(
        'Kamida `username` yoki `chatId` berilishi kerak',
      );
    }

    // Duplikat tekshiruvi (ikkala unique ustun uchun ham)
    const dup = await this.findDuplicate(username, chatId);
    if (dup) {
      throw new ConflictException(
        `TelegramGroup allaqachon mavjud (id=${dup.id}, username=${dup.username ?? '-'}, chatId=${dup.chatId ?? '-'})`,
      );
    }

    const row = await this.prisma.telegramGroup.create({
      data: {
        username,
        chatId,
        title: dto.title ?? null,
        type: dto.type ?? null,
        members: dto.members ?? null,
        isActive: dto.isActive ?? true,
      },
    });
    return serialize(row);
  }

  /**
   * Bulk yaratish. `createMany({ skipDuplicates: true })` orqali —
   * (username, chatId) bo'yicha duplikatlar jimjit tashlab yuboriladi.
   * `skipDuplicates` faqat BAZAgacha unique constraint bo'yicha ishlaydi.
   */
  async createMany(dto: BulkCreateTelegramGroupDto) {
    const rows: Array<{
      username: string | null;
      chatId: bigint | null;
      title: string | null;
      type: string | null;
      members: number | null;
      isActive: boolean;
    }> = [];
    const invalid: Array<{ index: number; reason: string }> = [];

    for (let i = 0; i < dto.items.length; i++) {
      const it = dto.items[i];
      const username = normalizeUsername(it.username);
      const chatId = normalizeChatId(it.chatId);
      if (!username && chatId == null) {
        invalid.push({
          index: i,
          reason: 'username yoki chatId kerak',
        });
        continue;
      }
      rows.push({
        username,
        chatId,
        title: it.title ?? null,
        type: it.type ?? null,
        members: it.members ?? null,
        isActive: it.isActive ?? true,
      });
    }

    // Bazadan oldingi ro'yxatni oldindan yig'ib olamiz — skipDuplicates
    // yaratmagan qatorlarni aniqlash uchun.
    const beforeCount = await this.prisma.telegramGroup.count();

    // Prisma `createMany` — bitta INSERT ... ON CONFLICT DO NOTHING (skipDuplicates)
    const result = await this.prisma.telegramGroup.createMany({
      data: rows,
      skipDuplicates: true,
    });

    const afterCount = await this.prisma.telegramGroup.count();
    const created = result.count;
    // Duplikat sabab tushmagan qatorlar soni
    const skippedDup = rows.length - (afterCount - beforeCount);

    return {
      received: dto.items.length,
      valid: rows.length,
      created,
      skipped_duplicates: skippedDup,
      invalid, // [{ index, reason }]
    };
  }

  async findAll(query: QueryTelegramGroupDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 10;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.isActive) {
      where.isActive = query.isActive === 'TRUE';
    }
    if (query.username && query.username.trim()) {
      where.username = { contains: query.username.trim(), mode: 'insensitive' };
    }
    if (query.title && query.title.trim()) {
      where.title = {
        contains: query.title.trim(),
        mode: 'insensitive',
      } as any;
    }

    const [data, total] = await Promise.all([
      this.prisma.telegramGroup.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.telegramGroup.count({ where }),
    ]);

    return {
      data: data.map(serialize),
      meta: { page, limit, total },
    };
  }

  async findById(id: number) {
    const group = await this.prisma.telegramGroup.findUnique({ where: { id } });
    if (!group) {
      throw new NotFoundException('Telegram group not found');
    }
    return serialize(group);
  }

  async update(id: number, dto: UpdateTelegramGroupDto) {
    const group = await this.prisma.telegramGroup.findUnique({ where: { id } });
    if (!group) {
      throw new NotFoundException('Telegram group not found');
    }

    const updated = await this.prisma.telegramGroup.update({
      where: { id },
      data: {
        title: dto.title ?? group.title,
        isActive: dto.isActive ?? group.isActive,
      },
    });
    return serialize(updated);
  }

  async deactivate(id: number) {
    const group = await this.prisma.telegramGroup.findUnique({ where: { id } });
    if (!group) {
      throw new NotFoundException('Telegram group not found');
    }
    if (group.isActive === false) return serialize(group);

    const updated = await this.prisma.telegramGroup.update({
      where: { id },
      data: { isActive: false },
    });
    return serialize(updated);
  }

  // ── private ────────────────────────────────────────────────────────────
  private async findDuplicate(
    username: string | null,
    chatId: bigint | null,
  ) {
    const or: any[] = [];
    if (username) or.push({ username });
    if (chatId != null) or.push({ chatId });
    if (or.length === 0) return null;
    return this.prisma.telegramGroup.findFirst({ where: { OR: or } });
  }
}

// ── helpers ───────────────────────────────────────────────────────────────
function normalizeUsername(v: string | null | undefined): string | null {
  if (v == null) return null;
  const cleaned = String(v).replace(/^@/, '').trim();
  return cleaned || null;
}

function normalizeChatId(v: string | null | undefined): bigint | null {
  if (v == null || v === '') return null;
  try {
    return BigInt(v);
  } catch {
    return null;
  }
}
