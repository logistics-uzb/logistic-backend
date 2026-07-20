import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/modules/prisma/prisma.service';

import { GetStatsDto } from './dto/get-stats.dto';

/**
 * Toshkent (Asia/Tashkent) UTC+5, DST yo'q. Barcha bucketlar shu vaqt bo'yicha
 * yaxlitlanadi — foydalanuvchi "00-01" Toshkent soati sifatida ko'radi.
 */
const TZ_OFFSET_HOURS = 5;
const TZ_OFFSET_MS = TZ_OFFSET_HOURS * 60 * 60 * 1000;

/**
 * RequestLog jadvali ustidan agregatsiya. Barcha filterlar ixtiyoriy —
 * berilmasa umumiy statistika qaytadi.
 */
@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Umumiy sonlar: jami, muvaffaqiyatli (2xx), xatolar (>=400),
   * o'rtacha davomiylik, unikal userlar.
   */
  async getSummary(dto: GetStatsDto) {
    const where = this.buildWhere(dto);

    const [total, byStatus, avgDuration, uniqueUsers] = await Promise.all([
      this.prisma.requestLog.count({ where }),
      this.prisma.requestLog.groupBy({
        by: ['statusCode'],
        where,
        _count: { _all: true },
      }),
      this.prisma.requestLog.aggregate({
        where,
        _avg: { durationMs: true },
      }),
      this.prisma.requestLog.findMany({
        where: { ...where, userId: { not: null } },
        distinct: ['userId'],
        select: { userId: true },
      }),
    ]);

    const success = byStatus
      .filter((s) => s.statusCode >= 200 && s.statusCode < 300)
      .reduce((sum, s) => sum + s._count._all, 0);
    const errors = byStatus
      .filter((s) => s.statusCode >= 400)
      .reduce((sum, s) => sum + s._count._all, 0);

    return {
      total,
      success,
      errors,
      avgDurationMs: Math.round(avgDuration._avg.durationMs ?? 0),
      uniqueUsers: uniqueUsers.length,
      byStatus: byStatus.map((s) => ({
        statusCode: s.statusCode,
        count: s._count._all,
      })),
    };
  }

  /**
   * Path bo'yicha guruhlash — qaysi endpoint qancha marta chaqirilgan.
   */
  async getByPath(dto: GetStatsDto) {
    const where = this.buildWhere(dto);
    const rows = await this.prisma.requestLog.groupBy({
      by: ['path', 'method'],
      where,
      _count: { _all: true },
      _avg: { durationMs: true },
      orderBy: { _count: { path: 'desc' } },
    });

    return rows.map((r) => ({
      path: r.path,
      method: r.method,
      count: r._count._all,
      avgDurationMs: Math.round(r._avg.durationMs ?? 0),
    }));
  }

  /**
   * Timeseries — vaqt bo'yicha bucketlangan sonlar.
   * Bo'sh bucketlar (chaqiruv bo'lmagan soat/kun/oy) `count: 0` bilan
   * to'ldirilib qaytariladi — grafik uzluksiz ko'rinishi uchun.
   *
   * Default range (from/to berilmasa):
   *   hour  → oxirgi 24 soat
   *   day   → oxirgi 30 kun
   *   month → oxirgi 12 oy
   *
   * PostgreSQL `date_trunc` orqali agregatsiya (Prisma groupBy custom bucketni
   * qo'llab-quvvatlamaydi, shuning uchun $queryRaw ishlatamiz).
   */
  async getTimeseries(dto: GetStatsDto) {
    const bucket = dto.bucket ?? 'day';
    const now = Date.now();

    // Default oralig'ini o'rnatamiz agar berilmasa
    let fromMs = dto.from;
    let toMs = dto.to ?? now;
    if (fromMs == null) {
      const HOUR = 60 * 60 * 1000;
      const DAY = 24 * HOUR;
      if (bucket === 'hour') fromMs = now - 24 * HOUR;
      else if (bucket === 'day') fromMs = now - 30 * DAY;
      else fromMs = now - 365 * DAY; // month
    }

    const fromDate = this.floorTo(new Date(fromMs), bucket);
    const toDate = this.floorTo(new Date(toMs), bucket);

    // SQL injection'dan himoya: bucket faqat oldindan tanlangan qiymatlardan.
    const truncUnit: Record<'hour' | 'day' | 'month', string> = {
      hour: 'hour',
      day: 'day',
      month: 'month',
    };
    const unit = truncUnit[bucket];

    const conditions: Prisma.Sql[] = [
      Prisma.sql`"createdAt" >= ${fromDate}`,
      Prisma.sql`"createdAt" < ${this.addOne(toDate, bucket)}`,
    ];
    if (dto.path) {
      conditions.push(Prisma.sql`"path" LIKE ${dto.path + '%'}`);
    }
    if (dto.method) {
      conditions.push(Prisma.sql`"method" = ${dto.method}`);
    }
    const whereSql = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    // DB sessiya timezone'i Asia/Tashkent (`ALTER DATABASE ... SET TIMEZONE`)
    // bo'lgani uchun `date_trunc` avtomatik Toshkent bucket boshini qaytaradi.
    const rows: Array<{ bucket: Date; count: bigint }> =
      await this.prisma.$queryRaw(
        Prisma.sql`
          SELECT date_trunc(${unit}, "createdAt") AS bucket, COUNT(*)::bigint AS count
          FROM "RequestLog"
          ${whereSql}
          GROUP BY bucket
          ORDER BY bucket ASC
        `
      );

    // Xaritaga solamiz — tez qidiruv uchun
    const countMap = new Map<number, number>();
    for (const r of rows) {
      countMap.set(r.bucket.getTime(), Number(r.count));
    }

    // Barcha bucketlarni generatsiya qilib bo'sh bo'lganlarga 0 qo'yamiz.
    // `at` — Toshkent local vaqti (+05:00 suffix bilan).
    const points: Array<{ at: string; count: number }> = [];
    let total = 0;
    for (let d = fromDate; d <= toDate; d = this.addOne(d, bucket)) {
      const count = countMap.get(d.getTime()) ?? 0;
      points.push({ at: this.formatLocalIso(d), count });
      total += count;
    }

    return {
      bucket,
      timezone: 'Asia/Tashkent',
      from: this.formatLocalIso(fromDate),
      to: this.formatLocalIso(toDate),
      total,
      points,
    };
  }

  /**
   * Vaqtni bucket boshiga yaxlitlash — Toshkent local vaqtida.
   * Berilgan UTC Date'ni +5h siljitib, UTC yaxlitlab, -5h qaytaramiz.
   */
  private floorTo(d: Date, bucket: 'hour' | 'day' | 'month'): Date {
    const local = new Date(d.getTime() + TZ_OFFSET_MS);
    local.setUTCMilliseconds(0);
    local.setUTCSeconds(0);
    local.setUTCMinutes(0);
    if (bucket !== 'hour') local.setUTCHours(0);
    if (bucket === 'month') local.setUTCDate(1);
    return new Date(local.getTime() - TZ_OFFSET_MS);
  }

  /**
   * Bucket kattaligiga qarab +1 (soat/kun/oy) — Toshkent local vaqtida.
   */
  private addOne(d: Date, bucket: 'hour' | 'day' | 'month'): Date {
    const local = new Date(d.getTime() + TZ_OFFSET_MS);
    if (bucket === 'hour') local.setUTCHours(local.getUTCHours() + 1);
    else if (bucket === 'day') local.setUTCDate(local.getUTCDate() + 1);
    else local.setUTCMonth(local.getUTCMonth() + 1);
    return new Date(local.getTime() - TZ_OFFSET_MS);
  }

  /**
   * UTC Date'ni Toshkent local ISO ko'rinishida formatlaydi:
   *   "2026-07-16T15:00:00+05:00"
   */
  private formatLocalIso(d: Date): string {
    const local = new Date(d.getTime() + TZ_OFFSET_MS);
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
      `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
      `+0${TZ_OFFSET_HOURS}:00`
    );
  }

  private buildWhere(dto: GetStatsDto): Prisma.RequestLogWhereInput {
    const where: Prisma.RequestLogWhereInput = {};
    if (dto.path) where.path = { startsWith: dto.path };
    if (dto.method) where.method = dto.method;
    if (dto.from || dto.to) {
      where.createdAt = {
        ...(dto.from ? { gte: new Date(dto.from) } : {}),
        ...(dto.to ? { lte: new Date(dto.to) } : {}),
      };
    }
    return where;
  }

  /**
   * ButtonClick jadvaliga asoslangan timeseries — soat/kun/oy bo'yicha.
   * Har bucket'da ikkala type sonini alohida va jami bilan qaytaradi:
   *   [{ at, tg, call, total }, ...]
   *
   * Filter (ixtiyoriy): `type` — faqat 'tg' yoki faqat 'call' (undefined bo'lsa ikkalasi).
   * DB sessiya timezone Asia/Tashkent bo'lgani uchun bucketlar Toshkent bo'yicha.
   */
  async getButtonClicksTimeseries(dto: {
    type?: 'tg' | 'call';
    from?: number;
    to?: number;
    bucket?: 'hour' | 'day' | 'month';
    loadId?: number;
  }) {
    const bucket = dto.bucket ?? 'hour';
    const now = Date.now();

    let fromMs = dto.from;
    const toMs = dto.to ?? now;
    if (fromMs == null) {
      const HOUR = 60 * 60 * 1000;
      const DAY = 24 * HOUR;
      if (bucket === 'hour') fromMs = now - 24 * HOUR;
      else if (bucket === 'day') fromMs = now - 30 * DAY;
      else fromMs = now - 365 * DAY;
    }

    const fromDate = this.floorTo(new Date(fromMs), bucket);
    const toDate = this.floorTo(new Date(toMs), bucket);

    const truncUnit: Record<'hour' | 'day' | 'month', string> = {
      hour: 'hour',
      day: 'day',
      month: 'month',
    };
    const unit = truncUnit[bucket];

    const conditions: Prisma.Sql[] = [
      Prisma.sql`"createdAt" >= ${fromDate}`,
      Prisma.sql`"createdAt" < ${this.addOne(toDate, bucket)}`,
    ];
    if (dto.type) conditions.push(Prisma.sql`"type" = ${dto.type}`);
    if (dto.loadId) conditions.push(Prisma.sql`"loadId" = ${dto.loadId}`);
    const whereSql = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const rows: Array<{ bucket: Date; type: string; count: bigint }> =
      await this.prisma.$queryRaw(
        Prisma.sql`
          SELECT date_trunc(${unit}, "createdAt") AS bucket, "type", COUNT(*)::bigint AS count
          FROM "ButtonClick"
          ${whereSql}
          GROUP BY bucket, "type"
          ORDER BY bucket ASC
        `
      );

    // Xarita: bucketMs → { tg, call }
    const perBucket = new Map<number, { tg: number; call: number }>();
    for (const r of rows) {
      const key = r.bucket.getTime();
      const cur = perBucket.get(key) ?? { tg: 0, call: 0 };
      if (r.type === 'tg') cur.tg = Number(r.count);
      else if (r.type === 'call') cur.call = Number(r.count);
      perBucket.set(key, cur);
    }

    const points: Array<{
      at: string;
      tg: number;
      call: number;
      total: number;
    }> = [];
    let totalTg = 0;
    let totalCall = 0;
    for (let d = fromDate; d <= toDate; d = this.addOne(d, bucket)) {
      const b = perBucket.get(d.getTime()) ?? { tg: 0, call: 0 };
      points.push({
        at: this.formatLocalIso(d),
        tg: b.tg,
        call: b.call,
        total: b.tg + b.call,
      });
      totalTg += b.tg;
      totalCall += b.call;
    }

    return {
      bucket,
      timezone: 'Asia/Tashkent',
      from: this.formatLocalIso(fromDate),
      to: this.formatLocalIso(toDate),
      totals: { tg: totalTg, call: totalCall, all: totalTg + totalCall },
      points,
    };
  }

  /**
   * 30 kundan eski RequestLog yozuvlarini o'chirib boradi.
   * Har kunlik ishga tushadi (00:00 UTC).
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async deleteOldRequestLogsCron(): Promise<void> {
    const threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await this.prisma.requestLog.deleteMany({
      where: { createdAt: { lt: threshold } },
    });
    if (result.count > 0) {
      this.logger.log(
        `deleteOldRequestLogsCron: ${result.count} ta eski yozuv o'chirildi`
      );
    }
  }
}
