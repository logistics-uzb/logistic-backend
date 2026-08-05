import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService
  ) {}

  /**
   * Tashqi (bot backend) userlar statistikasi API'ga proxy.
   * `.env` da `USERS_STATS_API_URL` sozlangan bo'lsa chaqiradi. Aks holda
   * bo'sh natija qaytaradi (o'z metrikalari buzilmasin).
   *
   * Tashqi API kutilgan javob shakli:
   *   { data: [{ date: "YYYY-MM-DD" | "YYYY-MM-DDTHH:mm", users: N }], total: N }
   *
   * Bu metod javobni bizning "bucket → count" xarita ko'rinishida qaytaradi
   * (getAllInOne bilan birlashtirish uchun).
   */
  async fetchUsersStats(
    fromMs: number,
    toMs: number,
    bucket: 'hour' | 'day' | 'month'
  ): Promise<{ perBucket: Map<number, number>; total: number; ok: boolean }> {
    const baseUrl = this.configService.get<string>('USERS_STATS_API_URL');
    if (!baseUrl) {
      return { perBucket: new Map(), total: 0, ok: false };
    }

    // Month bucketni tashqi API qo'llab-quvvatlamasa — kunlik so'rab, aggregate qilamiz.
    // Hozircha day/hour ni to'g'ridan-to'g'ri o'tkazamiz.
    const supportedBucket = bucket === 'month' ? 'day' : bucket;
    const url = `${baseUrl.replace(/\/$/, '')}?from=${fromMs}&to=${toMs}&bucket=${supportedBucket}`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.logger.warn(`Users API ${res.status} — ${url}`);
        return { perBucket: new Map(), total: 0, ok: false };
      }
      const json: any = await res.json();
      const rows: Array<{ date: string; users: number }> = json?.data ?? [];

      const perBucket = new Map<number, number>();
      let total = 0;
      for (const row of rows) {
        const bucketDate = this.parseTashkentDateStr(row.date, bucket);
        if (!bucketDate) continue;
        perBucket.set(bucketDate.getTime(), row.users);
        total += row.users;
      }
      return { perBucket, total, ok: true };
    } catch (err: any) {
      this.logger.error(
        `Users API chaqiruv xatosi (${url}): ${err?.message ?? err}`
      );
      return { perBucket: new Map(), total: 0, ok: false };
    }
  }

  /**
   * "2026-08-01" yoki "2026-08-05T14:00" ni Toshkent bucket boshiga aylantiradi.
   * Natija — UTC Date (bu bucket boshiga to'g'ri keladigan UTC moment).
   */
  private parseTashkentDateStr(
    s: string,
    bucket: 'hour' | 'day' | 'month'
  ): Date | null {
    if (!s) return null;
    const isoWithTz =
      s.length <= 10
        ? `${s}T00:00:00+05:00` // day format
        : `${s.length === 16 ? s + ':00' : s}+05:00`; // hour "2026-08-05T14:00" → "2026-08-05T14:00:00+05:00"
    const d = new Date(isoWithTz);
    if (isNaN(d.getTime())) return null;
    return this.floorTo(d, bucket);
  }

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

    // `AT TIME ZONE 'Asia/Tashkent'` — session TZ ga bog'liq bo'lmagan holda
    // Toshkent bucket boshini UTC timestamp sifatida qaytaradi.
    const rows: Array<{ bucket: Date; count: bigint }> =
      await this.prisma.$queryRaw(
        Prisma.sql`
          SELECT
            (date_trunc(${unit}, "createdAt" AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent') AS bucket,
            COUNT(*)::bigint AS count
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
          SELECT
            (date_trunc(${unit}, "createdAt" AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent') AS bucket,
            "type",
            COUNT(*)::bigint AS count
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
   * Birlashgan statistika — barcha metrikani bitta chaqiruv orqali beradi:
   *   view — ButtonClick.type='view' bosishlari (post ko'rilgan)
   *   call — ButtonClick.type='call' bosishlari (qo'ng'iroq tugmasi)
   *   tg   — ButtonClick.type='tg' bosishlari (Telegram tugmasi)
   *   getAll — /v1/post/all endpoint chaqiruvlari (RequestLog dan)
   *
   * Filter (ixtiyoriy): from/to (UNIX ms), bucket (hour/day/month, default: hour).
   * Toshkent timezone (DB session).
   *
   * Response shape:
   *   {
   *     bucket, timezone, from, to,
   *     totals: { view, call, tg, getAll, all },
   *     points: [{ date, view, call, tg, getAll, total }, ...]
   *   }
   */
  async getAllInOne(dto: {
    from?: number;
    to?: number;
    bucket?: 'hour' | 'day' | 'month';
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
    const rangeEnd = this.addOne(toDate, bucket);

    const truncUnit: Record<'hour' | 'day' | 'month', string> = {
      hour: 'hour',
      day: 'day',
      month: 'month',
    };
    const unit = truncUnit[bucket];

    // ── Parallel: 3 ta manba ──
    // NB: `AT TIME ZONE 'Asia/Tashkent'` — session TZ ga bog'liq bo'lmagan holda
    // Toshkent bucketiga aniq yaxlitlash. Sessiya UTC yoki Tashkent bo'lsa ham
    // natija bir xil: Toshkent kun/soat boshi UTC timestamp sifatida.
    const [buttonRows, requestRows, users] = await Promise.all([
      this.prisma.$queryRaw<Array<{ bucket: Date; type: string; count: bigint }>>(
        Prisma.sql`
          SELECT
            (date_trunc(${unit}, "createdAt" AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent') AS bucket,
            "type",
            COUNT(*)::bigint AS count
          FROM "ButtonClick"
          WHERE "createdAt" >= ${fromDate} AND "createdAt" < ${rangeEnd}
            AND "type" IN ('tg', 'call')
          GROUP BY bucket, "type"
          ORDER BY bucket ASC
        `
      ),
      this.prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>(
        Prisma.sql`
          SELECT
            (date_trunc(${unit}, "createdAt" AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent') AS bucket,
            COUNT(*)::bigint AS count
          FROM "RequestLog"
          WHERE "createdAt" >= ${fromDate}
            AND "createdAt" < ${rangeEnd}
            AND "path" LIKE '/v1/post/all%'
            AND "method" = 'GET'
          GROUP BY bucket
          ORDER BY bucket ASC
        `
      ),
      this.fetchUsersStats(fromDate.getTime(), rangeEnd.getTime(), bucket),
    ]);

    // ── Xaritalarga solamiz ──
    // btnMap — tg va call clicks (button-clicks endpoint bilan mos)
    const btnMap = new Map<number, { call: number; tg: number }>();
    for (const r of buttonRows) {
      const key = r.bucket.getTime();
      const cur = btnMap.get(key) ?? { call: 0, tg: 0 };
      if (r.type === 'call') cur.call = Number(r.count);
      else if (r.type === 'tg') cur.tg = Number(r.count);
      btnMap.set(key, cur);
    }
    // viewMap — /v1/post/all chaqiruvlari (by-path endpoint bilan mos)
    const viewMap = new Map<number, number>();
    for (const r of requestRows) {
      viewMap.set(r.bucket.getTime(), Number(r.count));
    }

    // ── Barcha bucketlarni to'ldiramiz (bo'shlariga 0) ──
    const points: Array<{
      date: string;
      view: number;
      call: number;
      tg: number;
      users: number;
      total: number;
    }> = [];
    let tView = 0;
    let tCall = 0;
    let tTg = 0;
    let tUsers = 0;

    for (let d = fromDate; d <= toDate; d = this.addOne(d, bucket)) {
      const key = d.getTime();
      const b = btnMap.get(key) ?? { call: 0, tg: 0 };
      const view = viewMap.get(key) ?? 0;
      const usersCount = users.perBucket.get(key) ?? 0;
      const total = view + b.call + b.tg + usersCount;

      points.push({
        date: this.formatLocalIso(d),
        view,
        call: b.call,
        tg: b.tg,
        users: usersCount,
        total,
      });

      tView += view;
      tCall += b.call;
      tTg += b.tg;
      tUsers += usersCount;
    }

    return {
      bucket,
      timezone: 'Asia/Tashkent',
      from: this.formatLocalIso(fromDate),
      to: this.formatLocalIso(toDate),
      totals: {
        view: tView,
        call: tCall,
        tg: tTg,
        users: tUsers,
        all: tView + tCall + tTg + tUsers,
      },
      sources: {
        view: { source: 'RequestLog', path: '/v1/post/all', method: 'GET' },
        call: { source: 'ButtonClick', type: 'call' },
        tg: { source: 'ButtonClick', type: 'tg' },
        users: {
          source: 'external API',
          ok: users.ok,
          note: users.ok ? undefined : "USERS_STATS_API_URL yo'q yoki tashqi API mavjud emas",
        },
      },
      points,
    };
  }

  /**
   * Faqat foydalanuvchilar statistikasi — tashqi API'ga proxy.
   * `.env` da `USERS_STATS_API_URL` sozlangan bo'lishi shart.
   */
  async getUsersStats(dto: {
    from?: number;
    to?: number;
    bucket?: 'hour' | 'day' | 'month';
  }) {
    const bucket = dto.bucket ?? 'day';
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
    const rangeEnd = this.addOne(toDate, bucket);

    const users = await this.fetchUsersStats(
      fromDate.getTime(),
      rangeEnd.getTime(),
      bucket
    );

    const data: Array<{ date: string; users: number }> = [];
    let total = 0;
    for (let d = fromDate; d <= toDate; d = this.addOne(d, bucket)) {
      const usersCount = users.perBucket.get(d.getTime()) ?? 0;
      data.push({ date: this.formatLocalIso(d), users: usersCount });
      total += usersCount;
    }

    return {
      bucket,
      timezone: 'Asia/Tashkent',
      from: this.formatLocalIso(fromDate),
      to: this.formatLocalIso(toDate),
      total,
      sourceOk: users.ok,
      data,
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
