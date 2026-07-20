import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';

import {
  CreateLogisticMessageDto,
  GetLogisticsMessagesDto,
  UpdateLogisticMessageDto,
} from '@/types/application';

import { RequestWithUser } from '@/types/global';
import { application } from 'express';
import { TelegramService } from '@/external/telegram/telegram.service';
import { OpenaiService } from '../openai/openai.service';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import {
  CallCountDto,
  IncrementCountsDto,
  SendTelegramRawDto,
  SendTelegramStructuredDto,
} from '@/types/logistics-message';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LogisticsGateway } from '../notification-gateway/notification-gateway.gateway';
import { classifyByRegex } from '@/common/utils/regex-classifier';
import { Prisma } from '@prisma/client';
import { routeData } from '@/common/helpers/route-data';
import {
  formatMinutes,
  getPricePerKm,
  getRouteDistance,
} from '@/common/utils/distance';

// Fields of the dispatcher who created a post that are safe to expose in API
// responses (password and other sensitive columns are deliberately omitted).
const CREATED_BY_SELECT: Prisma.UserSelect = {
  id: true,
  fullName: true,
  username: true,
  phone: true,
  role: true,
};

@Injectable()
export class PostsService {
  private logger = new Logger(PostsService.name);

  constructor(
    @Inject(forwardRef(() => LogisticsGateway))
    private readonly gateway: LogisticsGateway,
    private readonly telegramService: TelegramService,
    private readonly openaiService: OpenaiService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService
  ) { }

  async create(data: CreateLogisticMessageDto): Promise<any> {
    const { tgMessageId, channelName, text, date, views } = data;
    const tag = `[create tg=${tgMessageId}@${channelName}]`;
    const startedAt = Date.now();
    const elapsed = () => `${Date.now() - startedAt}ms`;

    this.logger.log(
      `${tag} STEP 1 incoming text_len=${text?.length ?? 0} date=${date ?? '-'} views=${views ?? '-'}`
    );

    try {
      // -------------------------------------------------------------------
      // STEP 2 — duplicate check by (tgMessageId, channelName)
      // -------------------------------------------------------------------
      // Multi-load tarmog'ida bitta tgMessageId ostida N ta row saqlanadi
      // (har yuk uchun bittadan, blockIndex bilan farqlanadi). Shu sababli
      // har qanday (tgMessageId, channelName) topilishi — butun habar
      // allaqachon ishlangan degani, demak hammasini skip qilamiz.
      this.logger.debug(`${tag} STEP 2 dup-check (tgMessageId+channel)`);
      const existing = await this.prisma.logisticMessage.findFirst({
        where: { tgMessageId, channelName },
      });

      if (existing) {
        const updated = await this.prisma.logisticMessage.update({
          where: { id: existing.id },
          data: { sentToTelegramAt: new Date() },
        });
        this.logger.warn(
          `${tag} STEP 2 SKIP duplicate-tgMessageId existing.id=${existing.id} aiStatus=${existing.aiStatus} (${elapsed()})`
        );
        return {
          skipped: true,
          reason: 'duplicate-tgMessageId',
          existing: updated,
        };
      }
      this.logger.debug(`${tag} STEP 2 OK no dup`);

      // -------------------------------------------------------------------
      // STEP 3 — duplicate check by exact text
      // -------------------------------------------------------------------
      this.logger.debug(`${tag} STEP 3 dup-check (text)`);
      const existingText = await this.prisma.logisticMessage.findFirst({
        where: { text },
      });

      if (existingText) {
        const updated = await this.prisma.logisticMessage.update({
          where: { id: existingText.id },
          data: { sentToTelegramAt: new Date() },
        });
        this.logger.warn(
          `${tag} STEP 3 SKIP duplicate-text existing.id=${existingText.id} sourceChannel=${existingText.channelName} (${elapsed()})`
        );
        return {
          skipped: true,
          reason: 'duplicate-text',
          existing: updated,
        };
      }
      this.logger.debug(`${tag} STEP 3 OK no dup`);

      // -------------------------------------------------------------------
      // STEP 4 — OpenAI classify + extract
      // -------------------------------------------------------------------
      this.logger.debug(`${tag} STEP 4 openai analyse...`);
      const openaiResponse = await this.openaiService.messageAnalyse({
        message: text,
      });
      this.logger.log(
        `${tag} STEP 4 openai isMulti=${!!openaiResponse?.isMulti} isLoad=${openaiResponse.classifieredMessage.isLoad} type=${openaiResponse.classifieredMessage.type} confidence=${openaiResponse.classifieredMessage.confidence ?? '-'}`
      );

      // -------------------------------------------------------------------
      // STEP 5 — MULTI-LOAD tarmog'i (text.length > 400)
      // -------------------------------------------------------------------
      if (openaiResponse?.isMulti) {
        const loads: any[] = Array.isArray(openaiResponse.loads)
          ? openaiResponse.loads
          : [];

        // GPT 0 yuk qaytarsa — bitta REGULAR_MESSAGE row sifatida saqlaymiz
        // (tgMessageId bilan dedup ushlanishi uchun).
        if (loads.length === 0) {
          this.logger.warn(
            `${tag} STEP 5 MULTI 0 ta yuk — REGULAR_MESSAGE saqlanmoqda`
          );
          const saved = await this.prisma.logisticMessage.create({
            data: {
              tgMessageId,
              channelName,
              text,
              date,
              views,
              blockIndex: 0,
              aiStatus: 'REGULAR_MESSAGE',
              structured: openaiResponse,
              sentToTelegramAt: new Date(),
            },
          });
          this.logger.log(
            `${tag} DONE (multi-empty) id=${saved.id} in ${elapsed()}`
          );
          return {
            saved: true,
            multi: true,
            count: 1,
            ids: [saved.id],
          };
        }

        // Bo'shliqsiz telefonlarni "primary phone" sifatida aniqlash —
        // GPT prompt allaqachon inherit qilishni so'ragan, lekin model qaramoqada
        // tashlab qo'ysa ham, biz fallback sifatida shu yerda ham to'ldiramiz.
        const primaryPhone = this.findPrimaryPhone(text);

        const savedIds: number[] = [];
        for (let i = 0; i < loads.length; i++) {
          const load = loads[i];
          const subTag = `${tag}[block=${i}]`;

          // Telefonni inherit qilish (agar bo'lakda yo'q bo'lsa).
          let phone: string | null = load?.metaData?.phone_number ?? null;
          if (
            (typeof phone !== 'string' || phone.trim().length === 0) &&
            primaryPhone
          ) {
            phone = primaryPhone;
            this.logger.debug(
              `${subTag} STEP 5 phone inherited from primary=${primaryPhone}`
            );
          }

          const hasPhone =
            typeof phone === 'string' && phone.trim().length > 0;
          // Route gate: 4 ta maydonning barchasi (countryFrom, regionFrom,
          // countryTo, regionTo) va telefon majburiy. Aks holda REGULAR_MESSAGE.
          const isComplete = Boolean(
            load?.route?.fromCountry &&
              load?.route?.toCountry &&
              load?.route?.fromRegion &&
              load?.route?.toRegion
          );
          const effectiveIsLoad = hasPhone && isComplete;

          this.logger.log(
            `${subTag} route from=${load?.route?.fromCountry ?? '?'}/${load?.route?.fromRegion ?? '?'} to=${load?.route?.toCountry ?? '?'}/${load?.route?.toRegion ?? '?'} phone=${phone ?? '-'} isComplete=${isComplete} effLoad=${effectiveIsLoad}`
          );

          const baseRow: Prisma.LogisticMessageCreateInput = {
            tgMessageId,
            channelName,
            text, // parent matn har row'da takrorlanadi (foydalanuvchi tasdiqlagan)
            date,
            views,
            blockIndex: i,
            aiStatus: effectiveIsLoad ? 'LOAD_POST' : 'REGULAR_MESSAGE',
            structured: { isMulti: true, blockIndex: i, ...load },
            sentToTelegramAt: new Date(),
          };

          // Masofa (ma'lum viloyat bo'lsa) — LOAD_POST bo'lganida DB ga yoziladi
          const multiDist = effectiveIsLoad
            ? getRouteDistance(
                load?.route?.fromRegion,
                load?.route?.toRegion
              )
            : null;
          const multiPaymentAmount =
            load?.metaData?.paymentAmount != null &&
            !isNaN(Number(load.metaData.paymentAmount))
              ? Number(load.metaData.paymentAmount)
              : null;
          const multiPricePerKm = effectiveIsLoad
            ? getPricePerKm(
                multiPaymentAmount,
                multiDist?.distanceKm,
                load?.metaData?.paymentCurrency
              )
            : null;

          const fullRow: Prisma.LogisticMessageCreateInput = effectiveIsLoad
            ? {
                ...baseRow,
                countryFrom: load?.route?.fromCountry,
                countryTo: load?.route?.toCountry,
                regionFrom: load?.route?.fromRegion,
                regionTo: load?.route?.toRegion,

                title: load?.metaData?.title,
                weight:
                  load?.metaData?.weight != null &&
                  !isNaN(Number(load.metaData.weight))
                    ? Number(load.metaData.weight)
                    : undefined,
                cargoUnit: load?.metaData?.cargoUnit,
                vehicleType: load?.metaData?.vehicleType,

                paymentType: load?.metaData?.paymentType,
                paymentAmount:
                  load?.metaData?.paymentAmount != null &&
                  !isNaN(Number(load.metaData.paymentAmount))
                    ? Number(load.metaData.paymentAmount)
                    : undefined,
                advancePayment:
                  load?.metaData?.advancePayment != null &&
                  !isNaN(Number(load.metaData.advancePayment))
                    ? Number(load.metaData.advancePayment)
                    : undefined,
                paymentCurrency: load?.metaData?.paymentCurrency,

                pickupDate: await this.normalizePickupDate(
                  load?.metaData?.pickupDate
                ),

                phoneNumber: phone,
                isComplete,

                distanceDirectKm: multiDist?.directDistanceKm ?? undefined,
                distanceKm: multiDist?.distanceKm ?? undefined,
                distanceTimeMinutes: multiDist?.timeMinutes ?? undefined,
                pricePerKm: multiPricePerKm?.value ?? undefined,
              }
            : baseRow;

          const savedRow = await this.prisma.logisticMessage.create({
            data: fullRow,
          });
          savedIds.push(savedRow.id);
          this.logger.log(
            `${subTag} SAVED id=${savedRow.id} aiStatus=${savedRow.aiStatus}`
          );

          // Telegram alert har bo'lak uchun — single tarmog'i bilan bir xil
          // mantiq (incomplete → 17906, complete → 17903).
          if (effectiveIsLoad) {
            await this.sendLoadAlert({
              text,
              route: load?.route ?? {},
              metaData: { ...(load?.metaData ?? {}), phone_number: phone },
              isComplete,
              tag: subTag,
            });
          }
        }

        this.logger.log(
          `${tag} DONE (multi) ${savedIds.length} ta row saqlandi in ${elapsed()}`
        );
        return {
          saved: true,
          multi: true,
          count: savedIds.length,
          ids: savedIds,
        };
      }

      // -------------------------------------------------------------------
      // STEP 5 — SINGLE tarmog'i (text.length <= 400) — phone + full route gate
      // -------------------------------------------------------------------
      const rawPhone = openaiResponse?.metaData?.phone_number;
      const hasPhone =
        typeof rawPhone === 'string' && rawPhone.trim().length > 0;
      // Route gate: 4 ta maydonning barchasi (countryFrom, regionFrom,
      // countryTo, regionTo) va telefon majburiy. Aks holda REGULAR_MESSAGE.
      const isComplete = Boolean(
        openaiResponse?.route?.fromCountry &&
          openaiResponse?.route?.toCountry &&
          openaiResponse?.route?.fromRegion &&
          openaiResponse?.route?.toRegion
      );
      const effectiveIsLoad =
        openaiResponse.classifieredMessage.isLoad && hasPhone && isComplete;

      if (openaiResponse.classifieredMessage.isLoad && !hasPhone) {
        this.logger.warn(
          `${tag} STEP 5 NO phone — downgrading LOAD_POST → REGULAR_MESSAGE`
        );
      } else if (
        openaiResponse.classifieredMessage.isLoad &&
        !isComplete
      ) {
        this.logger.warn(
          `${tag} STEP 5 route incomplete (from=${openaiResponse?.route?.fromCountry ?? '?'}/${openaiResponse?.route?.fromRegion ?? '?'} to=${openaiResponse?.route?.toCountry ?? '?'}/${openaiResponse?.route?.toRegion ?? '?'}) — downgrading LOAD_POST → REGULAR_MESSAGE`
        );
      } else if (effectiveIsLoad) {
        this.logger.log(
          `${tag} STEP 5 phone=${rawPhone} → effectiveLoad=true`
        );
      } else {
        this.logger.debug(`${tag} STEP 5 not-load (regular message)`);
      }

      const baseData: Prisma.LogisticMessageCreateInput = {
        tgMessageId,
        channelName,
        text,
        date,
        views,
        blockIndex: 0,
        aiStatus: effectiveIsLoad ? 'LOAD_POST' : 'REGULAR_MESSAGE',
        structured: openaiResponse,
        sentToTelegramAt: new Date(),
      };

      // -------------------------------------------------------------------
      // STEP 6 — route log (isComplete allaqachon STEP 5 da hisoblangan)
      // -------------------------------------------------------------------
      if (effectiveIsLoad) {
        this.logger.log(
          `${tag} STEP 6 route from=${openaiResponse?.route?.fromCountry ?? '?'}/${openaiResponse?.route?.fromRegion ?? '?'} to=${openaiResponse?.route?.toCountry ?? '?'}/${openaiResponse?.route?.toRegion ?? '?'} isComplete=${isComplete}`
        );
      }
      let fullData = baseData;

      if (effectiveIsLoad) {
        // Masofa (ma'lum viloyat bo'lsa) — LOAD_POST bo'lganida DB ga yoziladi
        const singleDist = getRouteDistance(
          openaiResponse?.route?.fromRegion,
          openaiResponse?.route?.toRegion
        );
        const singlePaymentAmount =
          openaiResponse?.metaData?.paymentAmount != null &&
          !isNaN(Number(openaiResponse.metaData.paymentAmount))
            ? Number(openaiResponse.metaData.paymentAmount)
            : null;
        const singlePricePerKm = getPricePerKm(
          singlePaymentAmount,
          singleDist?.distanceKm,
          openaiResponse?.metaData?.paymentCurrency
        );

        fullData = {
          ...baseData,

          countryFrom: openaiResponse?.route?.fromCountry,
          countryTo: openaiResponse?.route?.toCountry,

          regionFrom: openaiResponse?.route?.fromRegion,
          regionTo: openaiResponse?.route?.toRegion,

          title: openaiResponse?.metaData?.title,
          weight:
            openaiResponse?.metaData?.weight != null &&
              !isNaN(Number(openaiResponse.metaData.weight))
              ? Number(openaiResponse.metaData.weight)
              : undefined,
          cargoUnit: openaiResponse?.metaData?.cargoUnit,
          vehicleType: openaiResponse?.metaData?.vehicleType,

          paymentType: openaiResponse?.metaData?.paymentType,
          paymentAmount:
            openaiResponse?.metaData?.paymentAmount != null &&
              !isNaN(Number(openaiResponse.metaData.paymentAmount))
              ? Number(openaiResponse.metaData.paymentAmount)
              : undefined,
          advancePayment:
            openaiResponse?.metaData?.advancePayment != null &&
              !isNaN(Number(openaiResponse.metaData.advancePayment))
              ? Number(openaiResponse.metaData.advancePayment)
              : undefined,
          paymentCurrency: openaiResponse?.metaData?.paymentCurrency,

          pickupDate: await this.normalizePickupDate(
            openaiResponse.metaData?.pickupDate
          ),

          phoneNumber: openaiResponse.metaData?.phone_number,

          isComplete,

          distanceDirectKm: singleDist?.directDistanceKm ?? undefined,
          distanceKm: singleDist?.distanceKm ?? undefined,
          distanceTimeMinutes: singleDist?.timeMinutes ?? undefined,
          pricePerKm: singlePricePerKm?.value ?? undefined,
        };
      }
      // -------------------------------------------------------------------
      // STEP 7 — persist
      // -------------------------------------------------------------------
      this.logger.debug(`${tag} STEP 7 saving aiStatus=${fullData.aiStatus}`);
      const savedMessage = await this.prisma.logisticMessage.create({
        data: fullData,
      });
      this.logger.log(
        `${tag} STEP 7 SAVED id=${savedMessage.id} aiStatus=${savedMessage.aiStatus} isComplete=${isComplete}`
      );

      // -------------------------------------------------------------------
      // STEP 8 — Telegram alert (only for effective loads)
      // -------------------------------------------------------------------
      if (effectiveIsLoad) {
        await this.sendLoadAlert({
          text,
          route: openaiResponse?.route ?? {},
          metaData: openaiResponse?.metaData ?? {},
          isComplete,
          tag,
        });
      }

      this.logger.log(
        `${tag} DONE id=${savedMessage.id} aiStatus=${savedMessage.aiStatus} in ${elapsed()}`
      );
      return { saved: true, id: savedMessage.id, aiStatus: savedMessage.aiStatus, isComplete };
    } catch (error) {
      this.logger.error(
        `${tag} FAIL ${error?.name ?? 'Error'}: ${error?.message} (after ${elapsed()})`,
        error?.stack
      );
      throw error;
    }
  }

  /**
   * Habarda topilgan birinchi telefon raqamini ajratib oladi.
   * Multi-load tarmog'ida bo'lakda telefon yo'q bo'lsa, butun habardagi
   * yagona/asosiy telefonni inherit qilish uchun ishlatiladi.
   * Format: O'zbekiston operatorlari (+998..., 998..., yoki 9 raqamli local).
   */
  private findPrimaryPhone(text: string): string | null {
    if (!text) return null;
    const re =
      /(?:\+?998)?\s?(?:9[0-9]|88|99|97|93|94|95|91|90|33|77|50|20)\s?\d{3}\s?\d{2}\s?\d{2}/g;
    const match = text.match(re);
    if (!match || match.length === 0) return null;
    // Normallashtirish: bo'shliqlarni olib tashlash + +998 prefix
    let phone = match[0].replace(/\s+/g, '');
    if (!phone.startsWith('+')) {
      if (phone.startsWith('998')) phone = '+' + phone;
      else phone = '+998' + phone;
    }
    return phone;
  }

  /**
   * Bitta yuk uchun Telegram alert yuborish — incomplete bo'lsa topic 17906 ga,
   * complete bo'lsa topic 17903 ga. Single va multi tarmoqlari uchun umumiy.
   */
  private async sendLoadAlert(params: {
    text: string;
    route: any;
    metaData: any;
    isComplete: boolean;
    tag: string;
  }) {
    const { text, route, metaData, isComplete, tag } = params;
    const topicId = isComplete ? 17903 : 17906;
    const label = isComplete ? 'complete load' : 'incomplete load';

    this.logger.warn(`${tag} telegram alert → topic=${topicId} (${label})`);

    const messageText = `
*Asl xabar:*
\`\`\`
${text}
\`\`\`

*Aniqlangan ma'lumotlar:*
\`\`\`
• From country: ${route?.fromCountry ?? '❌ yo‘q'}
• From region: ${route?.fromRegion ?? '❌ yo‘q'}
• To country: ${route?.toCountry ?? '❌ yo‘q'}
• To region: ${route?.toRegion ?? '❌ yo‘q'}
• title: ${metaData?.title ?? '❌ yo‘q'}
• weight: ${
      metaData?.weight != null && !isNaN(Number(metaData.weight))
        ? `${Number(metaData.weight)}`
        : '❌ yo‘q'
    }
• cargoUnit: ${metaData?.cargoUnit ?? '❌ yo‘q'}
• vehicleType: ${metaData?.vehicleType ?? '❌ yo‘q'}
• paymentType: ${metaData?.paymentType ?? '❌ yo‘q'}
• paymentAmount: ${
      metaData?.paymentAmount != null && !isNaN(Number(metaData.paymentAmount))
        ? Number(metaData.paymentAmount)
        : '❌ yo‘q'
    }
• advancePayment: ${
      metaData?.advancePayment != null && !isNaN(Number(metaData.advancePayment))
        ? Number(metaData.advancePayment)
        : '❌ yo‘q'
    }
• paymentCurrency: ${metaData?.paymentCurrency ?? '❌ yo‘q'}
• pickupDate: ${metaData?.pickupDate ? metaData.pickupDate : '❌ yo‘q'}
• phone_number: ${metaData?.phone_number ?? '❌ yo‘q'}

\`\`\`
`;

    await this.telegramService.sendToGroup(messageText, topicId, {
      parseMode: 'Markdown',
    });
    this.logger.debug(`${tag} telegram alert sent (${label})`);
  }

  async getAllMessages(params?: GetLogisticsMessagesDto) {
    // =====================
    // PAGINATION DEFAULTS
    // =====================
    const page = +params?.page && +params.page > 0 ? +params.page : 1;
    const limit =
      +params?.limit && +params.limit > 0 && +params.limit <= 100
        ? +params.limit
        : 20;

    const skip = (page - 1) * limit;

    // =====================
    // WHERE BUILDER
    // =====================
    const where: Prisma.LogisticMessageWhereInput = {};

    // BASIC FILTERS
    if (params?.channelName) {
      where.channelName = params.channelName;
    }

    if (params?.aiStatus) {
      where.aiStatus = params.aiStatus;
    }

    if (params?.isActual !== undefined) {
      where.isActual = params.isActual;
    }

    if (params?.isComplete !== undefined) {
      where.isComplete = params.isComplete === 'TRUE';
    }

    // ROUTE FILTERS
    if (params?.countryFrom) {
      where.countryFrom = params.countryFrom;
    }

    if (params?.countryTo) {
      where.countryTo = params.countryTo;
    }

    if (params?.regionFrom) {
      where.regionFrom = params.regionFrom;
    }

    if (params?.regionTo) {
      where.regionTo = params.regionTo;
    }

    // WEIGHT RANGE
    if (params?.weightMin !== undefined || params?.weightMax !== undefined) {
      where.weight = {
        ...(params?.weightMin !== undefined ? { gte: params.weightMin } : {}),
        ...(params?.weightMax !== undefined ? { lte: params.weightMax } : {}),
      };
    }

    // =====================
    // NEW FILTERS
    // =====================
    // title contains (insensitive)
    if (params?.title) {
      where.title = { contains: params.title, mode: 'insensitive' };
    }

    // cargoUnit exact
    if (params?.cargoUnit) {
      where.cargoUnit = params.cargoUnit;
    }

    // vehicleType contains (insensitive)
    if (params?.vehicleType) {
      where.vehicleType = { contains: params.vehicleType, mode: 'insensitive' };
    }

    // paymentType exact
    if (params?.paymentType) {
      where.paymentType = params.paymentType;
    }

    // paymentAmount range
    if (
      params?.paymentAmountMin !== undefined ||
      params?.paymentAmountMax !== undefined
    ) {
      where.paymentAmount = {
        ...(params?.paymentAmountMin !== undefined
          ? { gte: params.paymentAmountMin }
          : {}),
        ...(params?.paymentAmountMax !== undefined
          ? { lte: params.paymentAmountMax }
          : {}),
      };
    }

    // paymentCurrency exact
    if (params?.paymentCurrency) {
      where.paymentCurrency = params.paymentCurrency;
    }

    // hasAdvancePayment => NOT NULL / NULL
    if (params?.hasAdvancePayment !== undefined) {
      where.advancePayment = params.hasAdvancePayment ? { not: null } : null;
    }

    // pickupDate / sentToTelegramAt ranges from UNIX ms
    const toDate = (v?: number): Date | undefined => {
      if (v === undefined || v === null) return undefined;
      const d = new Date(Number(v));
      return isNaN(d.getTime()) ? undefined : d;
    };

    {
      const from = toDate(params?.pickupDateFrom);
      const to = toDate(params?.pickupDateTo);
      if (from || to) {
        where.pickupDate = {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        };
      }
    }

    {
      const from = toDate(params?.sentFrom);
      const to = toDate(params?.sentTo);
      if (from || to) {
        where.sentToTelegramAt = {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        };
      }
    }

    // =====================
    // DB QUERIES (parallel)
    // =====================
    const [data, total] = await Promise.all([
      this.prisma.logisticMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { createdBy: { select: CREATED_BY_SELECT } },
      }),
      this.prisma.logisticMessage.count({ where }),
    ]);

    // =====================
    // RESPONSE
    // =====================
    return {
      page,
      limit,
      total, // jami mos keladigan yozuvlar
      totalPages: Math.ceil(total / limit),
      count: data.length, // shu sahifadagi yozuvlar
      data,
    };
  }
  async getAllMessagesWithFormat(params?: GetLogisticsMessagesDto) {
    // =====================
    // PAGINATION DEFAULTS
    // =====================
    const page = +params?.page && +params.page > 0 ? +params.page : 1;
    const limit =
      +params?.limit && +params.limit > 0 && +params.limit <= 100
        ? +params.limit
        : 20;

    const skip = (page - 1) * limit;

    // =====================
    // WHERE BUILDER
    // =====================
    const where: Prisma.LogisticMessageWhereInput = {};

    // BASIC FILTERS
    if (params?.channelName) {
      where.channelName = params.channelName;
    }

    if (params?.aiStatus) {
      where.aiStatus = params.aiStatus;
    }

    if (params?.isActual !== undefined) {
      where.isActual = params.isActual;
    }

    if (params?.isComplete !== undefined) {
      where.isComplete = params.isComplete === 'TRUE';
    }

    // ROUTE FILTERS
    if (params?.countryFrom) {
      where.countryFrom = params.countryFrom;
    }

    if (params?.countryTo) {
      where.countryTo = params.countryTo;
    }

    if (params?.regionFrom) {
      where.regionFrom = params.regionFrom;
    }

    if (params?.regionTo) {
      where.regionTo = params.regionTo;
    }

    // WEIGHT RANGE
    if (params?.weightMin !== undefined || params?.weightMax !== undefined) {
      where.weight = {
        ...(params?.weightMin !== undefined ? { gte: params.weightMin } : {}),
        ...(params?.weightMax !== undefined ? { lte: params.weightMax } : {}),
      };
    }

    // =====================
    // NEW FILTERS
    // =====================
    if (params?.title) {
      where.title = { contains: params.title, mode: 'insensitive' };
    }

    if (params?.cargoUnit) {
      where.cargoUnit = params.cargoUnit;
    }

    if (params?.vehicleType) {
      where.vehicleType = { contains: params.vehicleType, mode: 'insensitive' };
    }

    if (params?.paymentType) {
      where.paymentType = params.paymentType;
    }

    if (
      params?.paymentAmountMin !== undefined ||
      params?.paymentAmountMax !== undefined
    ) {
      where.paymentAmount = {
        ...(params?.paymentAmountMin !== undefined
          ? { gte: params.paymentAmountMin }
          : {}),
        ...(params?.paymentAmountMax !== undefined
          ? { lte: params.paymentAmountMax }
          : {}),
      };
    }

    if (params?.paymentCurrency) {
      where.paymentCurrency = params.paymentCurrency;
    }

    if (params?.hasAdvancePayment !== undefined) {
      where.advancePayment =
        params.hasAdvancePayment == 'YES' ? { not: null } : null;
    }

    const toDate = (v?: number): Date | undefined => {
      if (v === undefined || v === null) return undefined;
      const d = new Date(Number(v));
      return isNaN(d.getTime()) ? undefined : d;
    };

    {
      const from = toDate(params?.pickupDateFrom);
      const to = toDate(params?.pickupDateTo);
      if (from || to) {
        where.pickupDate = {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        };
      }
    }

    {
      const from = toDate(params?.sentFrom);
      const to = toDate(params?.sentTo);
      if (from || to) {
        where.sentToTelegramAt = {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        };
      }
    }
    console.log(where);

    // =====================
    // DB QUERIES (parallel)
    // =====================
    const [data, total] = await Promise.all([
      this.prisma.logisticMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { createdBy: { select: CREATED_BY_SELECT } },
      }),
      this.prisma.logisticMessage.count({ where }),
    ]);
    let formattedData = [];
    for (const message of data) {
      let formattedMessage = {
        id: message.id,
        countryFrom: await this.getCountryNameByIndexedName(
          routeData,
          message.countryFrom
        ),
        countryTo: await this.getCountryNameByIndexedName(
          routeData,
          message.countryTo
        ),
        regionFrom: await (
          await this.getRegionInfoByIndexedName(routeData, message.regionFrom)
        )?.regionName,
        regionTo: await (
          await this.getRegionInfoByIndexedName(routeData, message.regionTo)
        )?.regionName,
        title: message.title,
        weight: message.weight,
        cargoUnit: message.cargoUnit,
        vehicleType: message.vehicleType,
        paymentType: message.paymentType,
        paymentAmount: message.paymentAmount,
        paymentCurrency: message.paymentCurrency,
        advancePayment: message.advancePayment,
        pickupDate: message.pickupDate,
        phoneNumber: message.phoneNumber,
        sentAgo: await this.getTimeAgo(message.sentToTelegramAt),
        sentToTelegramAt: message.sentToTelegramAt,

        // Masofa DB'da saqlangan (LOAD_POST saqlanayotgan paytda hisoblangan).
        // formattedTime esa runtime hisoblanadi — chunki u shunchaki formatlash.
        // Uchala qiymat null bo'lsa → distance: null (O'zb ichida bo'lmagan).
        distance:
          message.distanceKm != null
            ? {
                directDistanceKm: message.distanceDirectKm,
                distanceKm: message.distanceKm,
                timeMinutes: message.distanceTimeMinutes,
                formattedTime:
                  message.distanceTimeMinutes != null
                    ? formatMinutes(message.distanceTimeMinutes)
                    : null,
              }
            : null,

        // Per km narx — DB'da saqlangan (LOAD_POST saqlanayotgan paytda hisoblangan).
        // Value va currency mavjud bo'lsagina obyekt sifatida qaytariladi.
        pricePerKm:
          message.pricePerKm != null && message.paymentCurrency
            ? {
                value: message.pricePerKm,
                currency: message.paymentCurrency,
              }
            : null,

        // Frontend yig'gan statistika (view-increment endpoint orqali).
        viewCount: message.viewCount,
        callCount: message.callCount,

        source: message.source,
        createdBy: message.createdBy,

        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
      };

      formattedData.push(formattedMessage);
    }

    // =====================
    // RESPONSE
    // =====================
    return {
      page,
      limit,
      total, // jami mos keladigan yozuvlar
      totalPages: Math.ceil(total / limit),
      count: data.length, // shu sahifadagi yozuvlar
      data: formattedData,
    };
  }

  async getMessageById(id: number) {
    const message = await this.prisma.logisticMessage.findUnique({
      where: { id },
      include: { createdBy: { select: CREATED_BY_SELECT } },
    });

    if (!message) {
      throw new NotFoundException(`Message with id ${id} not found`);
    }

    return message;
  }

  async updateMessage(id: number, dto: UpdateLogisticMessageDto) {
    const existing = await this.prisma.logisticMessage.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Message with id ${id} not found`);
    }

    // Agar date string bo‘lsa → DateTime ga aylantiramiz
    const payload: any = { ...dto };
    if (dto.date) {
      payload.date = new Date(dto.date);
    }

    const updated = await this.prisma.logisticMessage.update({
      where: { id },
      data: payload,
    });

    return {
      success: true,
      message: 'Message updated successfully',
      data: updated,
    };
  }

  /**
   * Run the classifier + OpenAI extraction pipeline on a raw message text
   * (same as `create()` does for scraped posts) BUT do not persist anything.
   * Returns a structured payload shaped to drop straight into the body of
   * POST /v1/post/send-to-telegram so the dispatcher can review / edit / send.
   *
   * Single-load javob: { isLoad, isMulti:false, aiStatus, isComplete, hasPhone, data }
   * Multi-load javob:  { isLoad, isMulti:true,  count, items:[{blockIndex, ...data}] }
   * MULTI tarmog'iga (text.length > 400) mos ravishda parseMessageMulti() delegat qiladi.
   */
  async parseMessage(text: string, dispatcherId?: number) {
    const tag = `[parseMessage caller=${dispatcherId ?? '-'}]`;
    const startedAt = Date.now();
    const elapsed = () => `${Date.now() - startedAt}ms`;

    this.logger.log(`${tag} STEP 1 incoming text_len=${text?.length ?? 0}`);

    const openaiResponse = await this.openaiService.messageAnalyse({
      message: text,
    });

    if (openaiResponse?.isMulti) {
      return this.parseMessageMulti(text, openaiResponse, tag, elapsed);
    }

    this.logger.log(
      `${tag} STEP 2 openai isLoad=${openaiResponse.classifieredMessage.isLoad} type=${openaiResponse.classifieredMessage.type} confidence=${openaiResponse.classifieredMessage.confidence ?? '-'}`
    );

    const rawPhone = openaiResponse?.metaData?.phone_number;
    const hasPhone =
      typeof rawPhone === 'string' && rawPhone.trim().length > 0;
    // Route gate: 4 ta maydonning barchasi (countryFrom, regionFrom,
    // countryTo, regionTo) va telefon majburiy. Aks holda REGULAR_MESSAGE.
    const isComplete = Boolean(
      openaiResponse?.route?.fromCountry &&
        openaiResponse?.route?.toCountry &&
        openaiResponse?.route?.fromRegion &&
        openaiResponse?.route?.toRegion
    );
    const effectiveIsLoad =
      openaiResponse.classifieredMessage.isLoad && hasPhone && isComplete;

    // Translate indexed dictionary keys (e.g. "uzbekistan", "tashkent_city")
    // back to display names so the response can be dropped straight into
    // /post/send-to-telegram without further frontend mapping.
    const [countryFromName, countryToName, regionFromInfo, regionToInfo] =
      await Promise.all([
        this.getCountryNameByIndexedName(
          routeData,
          openaiResponse?.route?.fromCountry
        ),
        this.getCountryNameByIndexedName(
          routeData,
          openaiResponse?.route?.toCountry
        ),
        this.getRegionInfoByIndexedName(
          routeData,
          openaiResponse?.route?.fromRegion
        ),
        this.getRegionInfoByIndexedName(
          routeData,
          openaiResponse?.route?.toRegion
        ),
      ]);

    const normalizedPickup = await this.normalizePickupDate(
      openaiResponse?.metaData?.pickupDate
    );

    // Shape matches SendTelegramStructuredDto so the frontend can post `data`
    // back unchanged. The `country*/region*` fields carry the indexed dictionary
    // key (e.g. "russia", "tashkent_city") so dispatcher posts persist under the
    // same vocabulary as scraper-ingested posts and filters stay consistent.
    // The `*Name` siblings are display-only and are dropped by the send-to-telegram
    // ValidationPipe whitelist.
    const data = {
      countryFrom: openaiResponse?.route?.fromCountry ?? null,
      countryFromName: countryFromName ?? null,
      regionFrom: openaiResponse?.route?.fromRegion ?? null,
      regionFromName: regionFromInfo?.regionName ?? null,
      countryTo: openaiResponse?.route?.toCountry ?? null,
      countryToName: countryToName ?? null,
      regionTo: openaiResponse?.route?.toRegion ?? null,
      regionToName: regionToInfo?.regionName ?? null,

      title: openaiResponse?.metaData?.title ?? null,
      weight: openaiResponse?.metaData?.weight ?? null,
      cargoUnit: openaiResponse?.metaData?.cargoUnit ?? null,
      capacity: null,
      vehicleType: openaiResponse?.metaData?.vehicleType ?? null,
      vehicleBodyType: null,

      paymentType: openaiResponse?.metaData?.paymentType ?? null,
      paymentAmount: openaiResponse?.metaData?.paymentAmount ?? null,
      paymentCurrency: openaiResponse?.metaData?.paymentCurrency ?? null,

      pickupDate: normalizedPickup
        ? normalizedPickup.toISOString().slice(0, 10) // YYYY-MM-DD
        : openaiResponse?.metaData?.pickupDate ?? null,

      phone_number: openaiResponse?.metaData?.phone_number ?? null,
      description: null,
    } as any;

    // Ma'lum viloyat ichidagi yo'nalish uchun taxminiy masofa/vaqt.
    const singleDistance = getRouteDistance(
      openaiResponse?.route?.fromRegion,
      openaiResponse?.route?.toRegion
    );
    data.distance = singleDistance;

    // Per km narx (paymentAmount, distanceKm va paymentCurrency uchtasi bor bo'lsa).
    data.pricePerKm = getPricePerKm(
      openaiResponse?.metaData?.paymentAmount,
      singleDistance?.distanceKm,
      openaiResponse?.metaData?.paymentCurrency
    );

    this.logger.log(
      `${tag} DONE effectiveLoad=${effectiveIsLoad} isComplete=${isComplete} hasPhone=${hasPhone} in ${elapsed()}`
    );

    return {
      isLoad: effectiveIsLoad,
      isMulti: false,
      aiStatus: effectiveIsLoad ? 'LOAD_POST' : 'REGULAR_MESSAGE',
      isComplete,
      hasPhone,
      data,
    };
  }

  /**
   * Multi-load javob (isMulti=true) uchun parseMessage() delegat qiladigan metod.
   * Har bir yuk uchun alohida `data` obyekti qaytaradi — SendTelegramStructuredDto
   * shakliga mos, ya'ni frontend har bir elementni to'g'ridan-to'g'ri
   * POST /v1/post/send-to-telegram ga yubora oladi.
   *
   * Telefon inherit qilish `create()` bilan bir xil: bo'lakda telefon yo'q bo'lsa
   * — butun matndagi birinchi telefon raqami qo'shiladi.
   */
  private async parseMessageMulti(
    text: string,
    openaiResponse: any,
    tag: string,
    elapsed: () => string
  ) {
    const loads: any[] = Array.isArray(openaiResponse?.loads)
      ? openaiResponse.loads
      : [];

    this.logger.log(
      `${tag} STEP 2 MULTI loads_count=${loads.length} type=${openaiResponse?.classifieredMessage?.type ?? '-'}`
    );

    if (loads.length === 0) {
      this.logger.warn(`${tag} MULTI 0 ta yuk — bo'sh items qaytmoqda`);
      return {
        isLoad: false,
        isMulti: true,
        count: 0,
        items: [],
      };
    }

    const primaryPhone = this.findPrimaryPhone(text);

    const items = await Promise.all(
      loads.map(async (load: any, i: number) => {
        // Telefonni inherit qilish (create() bilan bir xil mantiq)
        let phone: string | null = load?.metaData?.phone_number ?? null;
        if (
          (typeof phone !== 'string' || phone.trim().length === 0) &&
          primaryPhone
        ) {
          phone = primaryPhone;
        }
        const hasPhone =
          typeof phone === 'string' && phone.trim().length > 0;
        // Route gate: 4 ta maydonning barchasi (countryFrom, regionFrom,
        // countryTo, regionTo) va telefon majburiy. Aks holda REGULAR_MESSAGE.
        const isComplete = Boolean(
          load?.route?.fromCountry &&
            load?.route?.toCountry &&
            load?.route?.fromRegion &&
            load?.route?.toRegion
        );
        const effectiveIsLoad = hasPhone && isComplete;

        const [countryFromName, countryToName, regionFromInfo, regionToInfo] =
          await Promise.all([
            this.getCountryNameByIndexedName(
              routeData,
              load?.route?.fromCountry
            ),
            this.getCountryNameByIndexedName(
              routeData,
              load?.route?.toCountry
            ),
            this.getRegionInfoByIndexedName(
              routeData,
              load?.route?.fromRegion
            ),
            this.getRegionInfoByIndexedName(
              routeData,
              load?.route?.toRegion
            ),
          ]);

        const normalizedPickup = await this.normalizePickupDate(
          load?.metaData?.pickupDate
        );

        const data = {
          countryFrom: load?.route?.fromCountry ?? null,
          countryFromName: countryFromName ?? null,
          regionFrom: load?.route?.fromRegion ?? null,
          regionFromName: regionFromInfo?.regionName ?? null,
          countryTo: load?.route?.toCountry ?? null,
          countryToName: countryToName ?? null,
          regionTo: load?.route?.toRegion ?? null,
          regionToName: regionToInfo?.regionName ?? null,

          title: load?.metaData?.title ?? null,
          weight: load?.metaData?.weight ?? null,
          cargoUnit: load?.metaData?.cargoUnit ?? null,
          capacity: null,
          vehicleType: load?.metaData?.vehicleType ?? null,
          vehicleBodyType: null,

          paymentType: load?.metaData?.paymentType ?? null,
          paymentAmount: load?.metaData?.paymentAmount ?? null,
          paymentCurrency: load?.metaData?.paymentCurrency ?? null,

          pickupDate: normalizedPickup
            ? normalizedPickup.toISOString().slice(0, 10)
            : load?.metaData?.pickupDate ?? null,

          phone_number: phone ?? null,
          description: null,
        } as any;

        // Ma'lum viloyat ichidagi yo'nalish uchun taxminiy masofa/vaqt.
        const blockDistance = getRouteDistance(
          load?.route?.fromRegion,
          load?.route?.toRegion
        );
        data.distance = blockDistance;

        // Per km narx (paymentAmount, distanceKm va paymentCurrency uchtasi bor bo'lsa).
        data.pricePerKm = getPricePerKm(
          load?.metaData?.paymentAmount,
          blockDistance?.distanceKm,
          load?.metaData?.paymentCurrency
        );

        return {
          blockIndex: i,
          isLoad: effectiveIsLoad,
          aiStatus: effectiveIsLoad ? 'LOAD_POST' : 'REGULAR_MESSAGE',
          isComplete,
          hasPhone,
          data,
        };
      })
    );

    const loadCount = items.filter((x) => x.isLoad).length;
    this.logger.log(
      `${tag} DONE MULTI ${items.length} items (${loadCount} effective loads) in ${elapsed()}`
    );

    return {
      isLoad: loadCount > 0,
      isMulti: true,
      count: items.length,
      items,
    };
  }

  async sendToTelegram(body: SendTelegramStructuredDto, dispatcherId: number) {
    // 1) Dispatcher validatsiya
    const dispatcher = await this.prisma.user.findUnique({
      where: { id: dispatcherId },
      select: { id: true, phone: true },
    });
    if (!dispatcher) {
      throw new NotFoundException('Dispatcher not found');
    }
    if (!dispatcher.phone) {
      throw new BadRequestException(
        'Dispatcher account has no phone on file; cannot attach contact number',
      );
    }

    // 2) Aktiv guruhlarni olish, bloklanganlarni chiqarib tashlash
    const now = new Date();
    const [activeGroups, blocked] = await Promise.all([
      this.prisma.telegramGroup.findMany({
        where: { isActive: true },
        select: { username: true },
      }),
      this.prisma.blockedGroup.findMany({
        where: { unblockAt: { gt: now } },
        select: { username: true },
      }),
    ]);
    const blockedSet = new Set(blocked.map((b) => b.username));
    const groupUsernames = activeGroups
      .map((g) => g.username)
      .filter((u) => u && !blockedSet.has(u));

    if (groupUsernames.length === 0) {
      throw new BadRequestException(
        'No active telegram groups available (all blocked or none configured)',
      );
    }

    // 3) Xabar matnini quramiz
    const message = body.isMessage
      ? body.message
      : this.buildTelegramMessage(body, dispatcher.phone);

    // 4) Bazaga saqlaymiz (avval PENDING, keyin QUEUED ga o'tkazamiz)
    const saved = await this.persistDispatcherPost(
      body,
      message,
      dispatcherId,
      dispatcher.phone,
    );
    this.logger.log(
      `Dispatcher post saved id=${saved.id} createdById=${dispatcherId} groups=${groupUsernames.length}`
    );

    // 5) Python MTProto servisga navbatga qo'yish (agar sozlangan bo'lsa).
    // Fallback: env yo'q bo'lsa post PENDING'da qoladi va biz muvaffaqiyat qaytaramiz —
    // shunda MTProto servisi hali ishga tushmagan bo'lsa ham backend buzilmaydi.
    // Bu bosqichma-bosqich rollout uchun kerak: avval Node chiqariladi, keyin
    // env sozlanadi, keyin Python ishga tushiriladi.
    const mtprotoUrl = this.configService.get<string>('MTPROTO_SERVICE_URL');
    const sharedSecret = this.configService.get<string>('MTPROTO_SHARED_SECRET');
    const publicBaseUrl = this.configService.get<string>('PUBLIC_BASE_URL');

    if (!mtprotoUrl || !sharedSecret) {
      this.logger.warn(
        `MTPROTO_SERVICE_URL yoki MTPROTO_SHARED_SECRET .env da yo'q — post ${saved.id} DB'ga saqlandi, lekin navbatga qo'yilmadi (sendStatus=PENDING)`
      );
      return {
        success: true,
        savedId: saved.id,
        sendStatus: 'PENDING',
        groupsCount: groupUsernames.length,
        note: 'MTProto service not configured — persisted only',
      };
    }

    const callbackUrl = `${(publicBaseUrl ?? '').replace(/\/$/, '')}/v1/internal/send-result`;

    try {
      await axios.post(
        `${mtprotoUrl.replace(/\/$/, '')}/enqueue`,
        {
          id: saved.id,
          message,
          groups: groupUsernames,
          callbackUrl,
        },
        {
          headers: { 'X-Internal-Secret': sharedSecret },
          timeout: 10_000,
        }
      );

      await this.prisma.logisticMessage.update({
        where: { id: saved.id },
        data: {
          sendStatus: 'QUEUED',
          queuedAt: new Date(),
        },
      });

      this.logger.log(
        `Post ${saved.id} navbatga qo'shildi (${groupUsernames.length} ta guruh)`
      );

      return {
        success: true,
        savedId: saved.id,
        sendStatus: 'QUEUED',
        groupsCount: groupUsernames.length,
      };
    } catch (error) {
      this.logger.error(
        `Python /enqueue chaqiruv xatosi (post ${saved.id}): ${error?.message}`
      );
      await this.prisma.logisticMessage.update({
        where: { id: saved.id },
        data: {
          sendStatus: 'FAILED',
          sendResults: {
            error: 'mtproto_service_unavailable',
            detail: error?.message ?? 'unknown',
          },
        },
      });
      throw new BadRequestException(
        'MTProto service unavailable — post saved but not queued'
      );
    }
  }

  /**
   * Python MTProto worker'i yuborgan natijalar.
   * `POST /v1/internal/send-result` orqali chaqiriladi.
   *
   * results shakli:
   *   [{ group: "@name", ok: true, sentAt: "ISO" },
   *    { group: "@x", ok: false, error: "peer_flood", errorRaw: "..." }]
   *
   * Guruh xatolari `BlockedGroup` jadvaliga yoziladi, keyin cron 24h dan
   * so'ng avtomatik ochib yuboradi (permanent xatolar uchun uzoq muddat).
   */
  async applySendResult(payload: {
    id: number;
    status: 'SENDING' | 'SENT' | 'PARTIAL' | 'FAILED';
    results?: Array<{
      group: string;
      ok: boolean;
      sentAt?: string;
      error?: string;
      errorRaw?: string;
      retryAfterSec?: number;
    }>;
    finishedAt?: string;
    startedAt?: string;
  }) {
    const { id, status, results = [], finishedAt, startedAt } = payload;

    const existing = await this.prisma.logisticMessage.findUnique({
      where: { id },
      select: { id: true, sendStatus: true },
    });
    if (!existing) {
      throw new NotFoundException(`Post ${id} not found`);
    }

    // Bekor qilingan bo'lsa Python natijasini e'tibormasa
    if (existing.sendStatus === 'CANCELLED') {
      this.logger.warn(
        `Post ${id} bekor qilingan — Python natijasi e'tiborsiz`
      );
      return { skipped: true, reason: 'cancelled' };
    }

    // Guruh xatolarini BlockedGroup jadvaliga yozamiz
    for (const r of results) {
      if (r.ok || !r.error) continue;
      await this.markGroupBlocked(r.group, r.error, r.errorRaw, r.retryAfterSec);
    }

    const data: Prisma.LogisticMessageUpdateInput = {
      sendStatus: status,
      sendResults: results as unknown as Prisma.InputJsonValue,
    };
    if (startedAt) data.sendStartedAt = new Date(startedAt);
    if (finishedAt) data.sendFinishedAt = new Date(finishedAt);

    await this.prisma.logisticMessage.update({ where: { id }, data });
    this.logger.log(
      `Post ${id} sendStatus=${status} (${results.length} ta natija)`
    );

    return { success: true };
  }

  /**
   * Guruh xatosini BlockedGroup jadvaliga yozadi (upsert).
   * error kodi bo'yicha unblockAt muddati:
   *   peer_flood, flood_wait, slow_mode → 24 soat (yoki retryAfterSec)
   *   write_forbidden, banned, invalid_username → 365 kun (permanent-like)
   *   unknown → 6 soat
   */
  private async markGroupBlocked(
    username: string,
    error: string,
    errorRaw?: string,
    retryAfterSec?: number
  ) {
    const reasonMap: Record<string, string> = {
      peer_flood: 'PEER_FLOOD',
      flood_wait: 'FLOOD_WAIT',
      slow_mode: 'SLOW_MODE',
      write_forbidden: 'WRITE_FORBIDDEN',
      banned: 'BANNED',
      invalid_username: 'INVALID_USERNAME',
    };
    const reason = (reasonMap[error] ?? 'UNKNOWN') as any;

    const DAY = 24 * 60 * 60 * 1000;
    let durationMs: number;
    if (retryAfterSec && retryAfterSec > 0) {
      durationMs = retryAfterSec * 1000;
    } else if (
      reason === 'WRITE_FORBIDDEN' ||
      reason === 'BANNED' ||
      reason === 'INVALID_USERNAME'
    ) {
      durationMs = 365 * DAY;
    } else if (reason === 'UNKNOWN') {
      durationMs = 6 * 60 * 60 * 1000;
    } else {
      durationMs = DAY;
    }

    const unblockAt = new Date(Date.now() + durationMs);

    await this.prisma.blockedGroup.upsert({
      where: { username },
      create: {
        username,
        reason,
        unblockAt,
        lastError: errorRaw ?? error,
      },
      update: {
        reason,
        unblockAt,
        lastError: errorRaw ?? error,
        blockedAt: new Date(),
      },
    });
    this.logger.warn(
      `Guruh bloklandi: ${username} reason=${reason} until=${unblockAt.toISOString()}`
    );
  }

  /**
   * Dispatcher navbatdagi postni bekor qilishi (faqat QUEUED yoki PENDING).
   * SENDING/SENT/PARTIAL/FAILED holatlarini bekor qilib bo'lmaydi.
   * Python worker'iga /cancel/{id} chaqirig'i yuboriladi — u navbatdan olib tashlaydi.
   */
  async cancelPost(id: number, dispatcherId: number) {
    const post = await this.prisma.logisticMessage.findUnique({
      where: { id },
      select: {
        id: true,
        createdById: true,
        sendStatus: true,
        source: true,
      },
    });
    if (!post) throw new NotFoundException(`Post ${id} not found`);
    if (post.source !== 'DISPATCHER') {
      throw new BadRequestException('Faqat dispatcher postlarini bekor qilish mumkin');
    }
    if (post.createdById !== dispatcherId) {
      throw new BadRequestException('Sizga tegishli emas');
    }
    if (post.sendStatus !== 'QUEUED' && post.sendStatus !== 'PENDING') {
      throw new BadRequestException(
        `Bu holat bekor qilinmaydi: ${post.sendStatus}`
      );
    }

    // Python'ga bekor qilish xabari
    const mtprotoUrl = this.configService.get<string>('MTPROTO_SERVICE_URL');
    const sharedSecret = this.configService.get<string>('MTPROTO_SHARED_SECRET');
    if (mtprotoUrl && sharedSecret) {
      try {
        await axios.post(
          `${mtprotoUrl.replace(/\/$/, '')}/cancel/${id}`,
          {},
          {
            headers: { 'X-Internal-Secret': sharedSecret },
            timeout: 5_000,
          }
        );
      } catch (err) {
        this.logger.warn(
          `Python /cancel/${id} chaqiruv xatosi (davom etamiz): ${err?.message}`
        );
      }
    }

    await this.prisma.logisticMessage.update({
      where: { id },
      data: { sendStatus: 'CANCELLED', sendFinishedAt: new Date() },
    });
    this.logger.log(`Post ${id} bekor qilindi (dispatcher=${dispatcherId})`);
    return { success: true, id, sendStatus: 'CANCELLED' };
  }

  /**
   * Post yuborish holatini olish.
   */
  async getSendStatus(id: number) {
    const post = await this.prisma.logisticMessage.findUnique({
      where: { id },
      select: {
        id: true,
        sendStatus: true,
        queuedAt: true,
        sendStartedAt: true,
        sendFinishedAt: true,
        sendResults: true,
        source: true,
      },
    });
    if (!post) throw new NotFoundException(`Post ${id} not found`);
    return post;
  }

  /**
   * Frontend yuboradigan view/call increment. Bir chaqiruvda bir necha post
   * uchun bir xil turdagi statistika oshirilishi mumkin.
   *
   * Non-existent ID lar sukut bilan tashlab yuboriladi (updateMany faqat
   * mavjudlarni yangilaydi). Noyob string ID lar Number ga o'girilib,
   * finite/musbat bo'lganlari qabul qilinadi.
   */
  async incrementCounts(dto: IncrementCountsDto) {
    const ids = dto.loadIds
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (ids.length === 0) {
      return { updated: 0, requested: dto.loadIds.length };
    }

    const field = dto.type === 'view' ? 'viewCount' : 'callCount';
    const result = await this.prisma.logisticMessage.updateMany({
      where: { id: { in: ids } },
      data: { [field]: { increment: 1 } },
    });

    this.logger.log(
      `incrementCounts type=${dto.type} requested=${dto.loadIds.length} valid=${ids.length} updated=${result.count}`
    );
    return {
      updated: result.count,
      requested: dto.loadIds.length,
      type: dto.type,
    };
  }

  /**
   * "Telegram" yoki "Qo'ng'iroq qilish" tugmasi bosilganda chaqiriladi.
   * Har bosish ButtonClick jadvaliga alohida yozuv sifatida tushadi —
   * soatlik/kunlik grafik uchun. Fire-and-forget (Prisma await'lanadi lekin
   * frontend uchun tez javob).
   */
  async trackButtonClick(dto: CallCountDto) {
    await this.prisma.buttonClick.create({
      data: {
        type: dto.type,
        loadId: dto.loadId,
      },
    });
    this.logger.log(
      `Button click: type=${dto.type} loadId=${dto.loadId ?? '-'}`
    );
    return { ok: true, type: dto.type };
  }

  /**
   * Har soatda BlockedGroup jadvalidan muddati o'tganlarni tozalab turadi.
   * Guruh keyingi safar sendToTelegram'da avtomatik qayta ishlatiladi.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async unblockExpiredGroupsCron() {
    const result = await this.prisma.blockedGroup.deleteMany({
      where: { unblockAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      this.logger.log(
        `unblockExpiredGroupsCron: ${result.count} ta guruh muddati tugadi va ochildi`
      );
    }
  }

  private async persistDispatcherPost(
    body: SendTelegramStructuredDto,
    finalText: string,
    dispatcherId: number,
    phone: string
  ) {
    const toNum = (v: unknown): number | undefined =>
      v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : undefined;

    const isComplete = Boolean(
      body.countryFrom && body.countryTo && body.regionFrom && body.regionTo
    );

    // Masofa (ma'lum viloyat bo'lsa) — LOAD_POST bo'lganida DB ga yoziladi
    const isLoad = (body.aiStatus ?? 'LOAD_POST') === 'LOAD_POST';
    const dist = isLoad
      ? getRouteDistance(body.regionFrom, body.regionTo)
      : null;
    const dispatcherPricePerKm = isLoad
      ? getPricePerKm(
          toNum(body.paymentAmount),
          dist?.distanceKm,
          body.paymentCurrency
        )
      : null;

    return this.prisma.logisticMessage.create({
      data: {
        // Sentinels: dispatcher-submitted posts don't come from a Telegram channel.
        tgMessageId: 0,
        channelName: 'DISPATCHER',
        text: finalText,
        date: new Date(),
        aiStatus: body.aiStatus ?? 'LOAD_POST',
        structured: body as unknown as Prisma.InputJsonValue,
        sentToTelegramAt: new Date(),

        source: 'DISPATCHER',
        createdById: dispatcherId,

        countryFrom: body.countryFrom,
        countryTo: body.countryTo,
        regionFrom: body.regionFrom,
        regionTo: body.regionTo,

        title: body.title,
        weight: toNum(body.weight),
        cargoUnit: body.cargoUnit,
        vehicleType: body.vehicleType,

        paymentType: body.paymentType,
        paymentAmount: toNum(body.paymentAmount),
        paymentCurrency: body.paymentCurrency,

        pickupDate: body.pickupDate ? new Date(body.pickupDate) : null,
        phoneNumber: phone,

        isComplete,

        distanceDirectKm: dist?.directDistanceKm ?? undefined,
        distanceKm: dist?.distanceKm ?? undefined,
        distanceTimeMinutes: dist?.timeMinutes ?? undefined,
        pricePerKm: dispatcherPricePerKm?.value ?? undefined,
      },
      select: { id: true, source: true, createdById: true },
    });
  }

  private buildTelegramMessage(
    body: SendTelegramStructuredDto,
    phone: string
  ): string {
    const s = body;
    const lines: string[] = [];

    if (s.title) lines.push(`📦 ${s.title}!`);
    const from = [s.countryFrom, s.regionFrom].filter(Boolean).join(', ');
    if (from) lines.push(`📍 From: ${from}`);
    const to = [s.countryTo, s.regionTo].filter(Boolean).join(', ');
    if (to) lines.push(`➡️ To: ${to}`);
    if (s.weight || s.cargoUnit)
      lines.push(
        `⚖️ Weight: ${[s.weight, s.cargoUnit].filter(Boolean).join(' ')}`
      );
    if (s.vehicleType || s.vehicleBodyType)
      lines.push(
        `🚚 Vehicle: ${[s.vehicleType, s.vehicleBodyType].filter(Boolean).join(' / ')}`
      );
    if (s.paymentAmount || s.paymentCurrency || s.paymentType) {
      const amount = [s.paymentAmount, (s.paymentCurrency || '').toUpperCase()]
        .filter(Boolean)
        .join(' ');
      const pay = s.paymentType ? ` (${s.paymentType})` : '';
      lines.push(`💰 Payment: ${amount}${pay}`);
    }
    if (s.capacity) lines.push(`📦 Capacity: ${s.capacity}`);
    if (s.pickupDate) lines.push(`📅 Pickup: ${s.pickupDate}`);
    if (phone) lines.push(`📞 Phone: ${phone}`);
    if (s.description) lines.push(`📝 ${s.description}`);

    return lines.join('\n');
  }

  async deleteMessage(id: number) {
    const existing = await this.prisma.logisticMessage.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Message with id ${id} not found`);
    }

    await this.prisma.logisticMessage.delete({
      where: { id },
    });

    return {
      success: true,
      message: 'Message deleted successfully',
    };
  }

  async restore(
    id: string,
    req: RequestWithUser,
    isService: boolean = false
  ): Promise<any> {
    const methodName: string = this.restore.name;
    this.logger.debug(`Method: ${methodName} - Request:`, id);

    let filter: any = { _id: id, deleted_at: { $ne: null } };

    // if (!application) {
    //   this.logger.debug(
    //     `Method: ${methodName} - Application Not Found or Not Deleted`
    //   );
    //   throw new NotFoundException('Application not found or is not deleted');
    // }

    this.logger.debug(
      `Method: ${methodName} - Application Restored:`,
      application
    );

    return application;
  }

  async normalizePickupDate(rawDate?: string): Promise<Date> {
    if (!rawDate) return null;

    rawDate = rawDate.trim();

    /**
     * 1) DD.MM.YYYY
     */
    const fullMatch = rawDate.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);

    if (fullMatch) {
      const day = Number(fullMatch[1]);
      const month = Number(fullMatch[2]) - 1;
      const year = Number(fullMatch[3]);

      const date = new Date(year, month, day);

      return isNaN(date.getTime()) ? null : date;
    }

    /**
     * 2) DD.MM (yilsiz)
     */
    const shortMatch = rawDate.match(/^(\d{1,2})\.(\d{1,2})$/);

    if (shortMatch) {
      const day = Number(shortMatch[1]);
      const month = Number(shortMatch[2]) - 1;

      const now = new Date();
      let year = now.getFullYear();

      let date = new Date(year, month, day);

      // Agar sana o'tib ketgan bo‘lsa → keyingi yil
      if (date < now) {
        year += 1;
        date = new Date(year, month, day);
      }

      return isNaN(date.getTime()) ? null : date;
    }

    return null;
  }

  async formatNumber(num: number): Promise<string> {
    if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
    return num.toFixed(2);
  }

  async getRegionInfoByIndexedName(
    routeData: any[],
    indexedName: string
  ): Promise<{ regionName: string; countryIndexedName: string }> {
    for (const country of routeData) {
      for (const region of country.regions || []) {
        if (region.indexedName === indexedName) {
          return {
            regionName: region.name,
            countryIndexedName: country.indexedName,
          };
        }
      }
    }
    return null;
  }

  async getCountryNameByIndexedName(
    routeData: any[],
    indexedName: string
  ): Promise<string> {
    const country = routeData.find((c) => c.indexedName === indexedName);

    return country ? country.countryNameLat : null;
  }

  async getTimeAgo(
    fromDate?: Date | null
  ): Promise<{ count: number; unit: 'second' | 'minute' | 'hour' | 'day' }> {
    if (!fromDate) return null;

    const now = Date.now();
    const diffMs = now - new Date(fromDate).getTime();

    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) {
      return { count: seconds, unit: 'second' };
    }

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return { count: minutes, unit: 'minute' };
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return { count: hours, unit: 'hour' };
    }

    const days = Math.floor(hours / 24);
    return { count: days, unit: 'day' };
  }

  // @Cron(CronExpression.EVERY_MINUTE)
  async processScrapedChannels(): Promise<any> {
    const methodName = this.processScrapedChannels.name;
    this.logger.debug(`Method: ${methodName} - Scrapingni boshlayapmiz`);

    try {
      // 1️⃣ Scraping
      const response = await axios.get(
        'https://logistics-scraping.coachingzona.uz/mtproto/channels?limit=1'
      );

      const channels = response.data;

      if (!channels) {
        return { success: false, message: 'Maʼlumot topilmadi' };
      }

      let totalSaved = 0;
      let totalSkipped = 0;

      // 2️⃣ Har bir kanal bo‘yicha
      for (const channelName of Object.keys(channels)) {
        const channel = channels[channelName];

        if (!channel.messages || channel.messages.length === 0) continue;

        for (const message of channel.messages) {
          try {
            await this.create({
              tgMessageId: message.id,
              channelName,
              text: message.text,
              date: message.date,
              views: message.views,
            });

            totalSaved++;
          } catch (err) {
            // Duplicate bo‘lsa yoki skip bo‘lsa → create error beradi
            totalSkipped++;
            this.logger.warn(`Message skipped: ${message.id} (${err.message})`);
          }
        }
      }

      return {
        success: true,
        saved: totalSaved,
        skipped: totalSkipped,
      };
    } catch (error) {
      this.logger.error(`Method: ${methodName} - Xatolik: ${error.message}`);

      return {
        success: false,
        message: 'Scraping yoki GPT jarayonida xatolik',
      };
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async deleteOldMessagesByCron() {
    const methodName = 'deleteOldMessagesByCron';
    const now = new Date();

    // 24 soat oldin
    const yesterdaySameTime = new Date(now);
    yesterdaySameTime.setDate(now.getDate() - 1);

    this.logger.debug(
      `Method: ${methodName} | Now: ${now.toISOString()} | Threshold: ${yesterdaySameTime.toISOString()}`
    );

    const oldMessages = await this.prisma.logisticMessage.findMany({
      where: {
        createdAt: {
          lt: yesterdaySameTime,
        },
      },
      select: {
        id: true,
      },
    });

    this.logger.log(
      `Method: ${methodName} | Found ${oldMessages.length} messages to delete`
    );

    let deletedCount = 0;

    for (const msg of oldMessages) {
      try {
        await this.deleteMessage(msg.id);
        deletedCount++;

        this.logger.debug(
          `Method: ${methodName} | Deleted message id=${msg.id}`
        );
      } catch (err) {
        this.logger.error(
          `Method: ${methodName} | Failed to delete message id=${msg.id}`,
          err.stack
        );
      }
    }

    this.logger.log(
      `Method: ${methodName} | Deleted ${deletedCount} messages successfully`
    );

    return {
      success: true,
      deletedCount,
    };
  }
}
