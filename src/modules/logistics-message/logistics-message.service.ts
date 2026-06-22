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
  SendTelegramRawDto,
  SendTelegramStructuredDto,
} from '@/types/logistics-message';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LogisticsGateway } from '../notification-gateway/notification-gateway.gateway';
import { classifyByRegex } from '@/common/utils/regex-classifier';
import { Prisma } from '@prisma/client';
import { routeData } from '@/common/helpers/route-data';

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
        `${tag} STEP 4 openai isLoad=${openaiResponse.classifieredMessage.isLoad} type=${openaiResponse.classifieredMessage.type} confidence=${openaiResponse.classifieredMessage.confidence ?? '-'}`
      );

      // -------------------------------------------------------------------
      // STEP 5 — phone gate (load must carry a phone number)
      // -------------------------------------------------------------------
      const rawPhone = openaiResponse?.metaData?.phone_number;
      const hasPhone =
        typeof rawPhone === 'string' && rawPhone.trim().length > 0;
      const effectiveIsLoad =
        openaiResponse.classifieredMessage.isLoad && hasPhone;

      if (openaiResponse.classifieredMessage.isLoad && !hasPhone) {
        this.logger.warn(
          `${tag} STEP 5 NO phone — downgrading LOAD_POST → REGULAR_MESSAGE`
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
        aiStatus: effectiveIsLoad ? 'LOAD_POST' : 'REGULAR_MESSAGE',
        structured: openaiResponse,
        sentToTelegramAt: new Date(),
      };

      // -------------------------------------------------------------------
      // STEP 6 — route completeness
      // -------------------------------------------------------------------
      const isComplete = Boolean(
        openaiResponse?.route?.fromCountry &&
        openaiResponse?.route?.toCountry &&
        openaiResponse?.route?.fromRegion &&
        openaiResponse?.route?.toRegion
      );
      if (effectiveIsLoad) {
        this.logger.log(
          `${tag} STEP 6 route from=${openaiResponse?.route?.fromCountry ?? '?'}/${openaiResponse?.route?.fromRegion ?? '?'} to=${openaiResponse?.route?.toCountry ?? '?'}/${openaiResponse?.route?.toRegion ?? '?'} isComplete=${isComplete}`
        );
      }
      let fullData = baseData;

      if (effectiveIsLoad) {
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
      if (!isComplete && effectiveIsLoad) {
        this.logger.warn(
          `${tag} STEP 8 telegram alert → topic=17906 (incomplete load)`
        );

        const incompleteMessageText = `
*Asl xabar:*
\`\`\`
${text}
\`\`\`

*Aniqlangan ma'lumotlar:*
\`\`\`
• From country: ${openaiResponse?.route?.fromCountry ?? '❌ yo‘q'}
• From region: ${openaiResponse?.route?.fromRegion ?? '❌ yo‘q'}
• To country: ${openaiResponse?.route?.toCountry ?? '❌ yo‘q'}
• To region: ${openaiResponse?.route?.toRegion ?? '❌ yo‘q'}
• title: ${openaiResponse?.metaData?.title ?? '❌ yo‘q'}
• weight: ${openaiResponse?.metaData?.weight != null &&
            !isNaN(Number(openaiResponse.metaData.weight))
            ? `${Number(openaiResponse.metaData.weight)}`
            : '❌ yo‘q'
          }
• cargoUnit: ${openaiResponse?.metaData?.cargoUnit ?? '❌ yo‘q'}
• vehicleType: ${openaiResponse?.metaData?.vehicleType ?? '❌ yo‘q'}
• paymentType: ${openaiResponse?.metaData?.paymentType ?? '❌ yo‘q'}
• paymentAmount: ${openaiResponse?.metaData?.paymentAmount != null &&
            !isNaN(Number(openaiResponse.metaData.paymentAmount))
            ? Number(openaiResponse.metaData.paymentAmount)
            : '❌ yo‘q'
          }
• advancePayment: ${openaiResponse?.metaData?.advancePayment != null &&
            !isNaN(Number(openaiResponse.metaData.advancePayment))
            ? Number(openaiResponse.metaData.advancePayment)
            : '❌ yo‘q'
          }
• paymentCurrency: ${openaiResponse?.metaData?.paymentCurrency ?? '❌ yo‘q'}
• pickupDate: ${openaiResponse?.metaData?.pickupDate
            ? openaiResponse.metaData.pickupDate
            : '❌ yo‘q'
          }
• phone_number: ${openaiResponse?.metaData?.phone_number ?? '❌ yo‘q'}

\`\`\`
`;

        await this.telegramService.sendToGroup(incompleteMessageText, 17906, {
          parseMode: 'Markdown',
        });
        this.logger.debug(`${tag} STEP 8 telegram alert sent (incomplete)`);
      }

      if (isComplete && effectiveIsLoad) {
        this.logger.warn(
          `${tag} STEP 8 telegram alert → topic=17903 (complete load)`
        );

        const completeMessageText = `
*Asl xabar:*
\`\`\`
${text}
\`\`\`

*Aniqlangan ma'lumotlar:*
\`\`\`
• From country: ${openaiResponse?.route?.fromCountry ?? '❌ yo‘q'}
• From region: ${openaiResponse?.route?.fromRegion ?? '❌ yo‘q'}
• To country: ${openaiResponse?.route?.toCountry ?? '❌ yo‘q'}
• To region: ${openaiResponse?.route?.toRegion ?? '❌ yo‘q'}
• title: ${openaiResponse?.metaData?.title ?? '❌ yo‘q'}
• weight: ${openaiResponse?.metaData?.weight != null &&
            !isNaN(Number(openaiResponse.metaData.weight))
            ? `${Number(openaiResponse.metaData.weight)}`
            : '❌ yo‘q'
          }
• cargoUnit: ${openaiResponse?.metaData?.cargoUnit ?? '❌ yo‘q'}
• vehicleType: ${openaiResponse?.metaData?.vehicleType ?? '❌ yo‘q'}
• paymentType: ${openaiResponse?.metaData?.paymentType ?? '❌ yo‘q'}
• paymentAmount: ${openaiResponse?.metaData?.paymentAmount != null &&
            !isNaN(Number(openaiResponse.metaData.paymentAmount))
            ? Number(openaiResponse.metaData.paymentAmount)
            : '❌ yo‘q'
          }
• advancePayment: ${openaiResponse?.metaData?.advancePayment != null &&
            !isNaN(Number(openaiResponse.metaData.advancePayment))
            ? Number(openaiResponse.metaData.advancePayment)
            : '❌ yo‘q'
          }
• paymentCurrency: ${openaiResponse?.metaData?.paymentCurrency ?? '❌ yo‘q'}
• pickupDate: ${openaiResponse?.metaData?.pickupDate
            ? openaiResponse.metaData.pickupDate
            : '❌ yo‘q'
          }
• phone_number: ${openaiResponse?.metaData?.phone_number ?? '❌ yo‘q'}

\`\`\`
`;

        await this.telegramService.sendToGroup(completeMessageText, 17903, {
          parseMode: 'Markdown',
        });
        this.logger.debug(`${tag} STEP 8 telegram alert sent (complete)`);
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
   */
  async parseMessage(text: string, dispatcherId?: number) {
    const tag = `[parseMessage caller=${dispatcherId ?? '-'}]`;
    const startedAt = Date.now();
    const elapsed = () => `${Date.now() - startedAt}ms`;

    this.logger.log(`${tag} STEP 1 incoming text_len=${text?.length ?? 0}`);

    const openaiResponse = await this.openaiService.messageAnalyse({
      message: text,
    });
    this.logger.log(
      `${tag} STEP 2 openai isLoad=${openaiResponse.classifieredMessage.isLoad} type=${openaiResponse.classifieredMessage.type} confidence=${openaiResponse.classifieredMessage.confidence ?? '-'}`
    );

    const rawPhone = openaiResponse?.metaData?.phone_number;
    const hasPhone =
      typeof rawPhone === 'string' && rawPhone.trim().length > 0;
    const effectiveIsLoad =
      openaiResponse.classifieredMessage.isLoad && hasPhone;

    const isComplete = Boolean(
      openaiResponse?.route?.fromCountry &&
        openaiResponse?.route?.toCountry &&
        openaiResponse?.route?.fromRegion &&
        openaiResponse?.route?.toRegion
    );

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

    // Shape matches SendTelegramStructuredDto so the frontend can post it back
    // unchanged (after the dispatcher edits whatever they want to override).
    const data = {
      countryFrom: countryFromName ?? openaiResponse?.route?.fromCountry ?? null,
      regionFrom:
        regionFromInfo?.regionName ?? openaiResponse?.route?.fromRegion ?? null,
      countryTo: countryToName ?? openaiResponse?.route?.toCountry ?? null,
      regionTo:
        regionToInfo?.regionName ?? openaiResponse?.route?.toRegion ?? null,

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
    };

    this.logger.log(
      `${tag} DONE effectiveLoad=${effectiveIsLoad} isComplete=${isComplete} hasPhone=${hasPhone} in ${elapsed()}`
    );

    return {
      isLoad: effectiveIsLoad,
      aiStatus: effectiveIsLoad ? 'LOAD_POST' : 'REGULAR_MESSAGE',
      isComplete,
      hasPhone,
      data,
    };
  }

  async sendToTelegram(body: SendTelegramStructuredDto, dispatcherId: number) {
    // ---------------------------------------------------------------------
    // Telegram dispatch temporarily disabled — this endpoint currently only
    // accepts dispatcher input and persists it to the DB as a LOAD_POST.
    // Re-enable the active-group fetch + Python MTProto call when needed.
    // ---------------------------------------------------------------------
    // const groups = await this.prisma.telegramGroup.findMany({
    //   where: { isActive: true },
    //   select: { username: true },
    // });
    // const groupUsernames = groups.map((g) => g.username).filter(Boolean);
    // if (groupUsernames.length === 0) {
    //   throw new BadRequestException('No active telegram groups found');
    // }

    const message = body.isMessage
      ? body.message
      : this.buildTelegramMessage(body as any);

    // Persist the dispatcher-submitted post directly — no classifier, no OpenAI.
    const saved = await this.persistDispatcherPost(body, message, dispatcherId);
    this.logger.log(
      `Dispatcher post saved id=${saved.id} createdById=${dispatcherId}`
    );

    // ---------------------------------------------------------------------
    // const baseUrl = this.configService.get<string>('PYTHON_TELETHON_API_URL');
    // if (!baseUrl) {
    //   throw new BadRequestException('Python service URL is not configured');
    // }
    //
    // try {
    //   const res = await axios.post(
    //     `${baseUrl.replace(/\/$/, '')}/mtproto/send`,
    //     {
    //       message,
    //       groups: groupUsernames,
    //     }
    //   );
    //   this.logger.log(
    //     `Sent to Telegram groups: ${groupUsernames.length} (savedId=${saved.id})`
    //   );
    //   return {
    //     success: true,
    //     sent: groupUsernames.length,
    //     savedId: saved.id,
    //     service: res.data,
    //   };
    // } catch (error) {
    //   this.logger.error(`Failed to send to Telegram: ${error.message}`);
    //   throw new BadRequestException(
    //     'Failed to send message to Telegram service'
    //   );
    // }

    return { success: true, savedId: saved.id };
  }

  private async persistDispatcherPost(
    body: SendTelegramStructuredDto,
    finalText: string,
    dispatcherId: number
  ) {
    const toNum = (v: unknown): number | undefined =>
      v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : undefined;

    const isComplete = Boolean(
      body.countryFrom && body.countryTo && body.regionFrom && body.regionTo
    );

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
        phoneNumber: body.phone_number,

        isComplete,
      },
      select: { id: true, source: true, createdById: true },
    });
  }

  private buildTelegramMessage(body: SendTelegramStructuredDto): string {
    const s = body as SendTelegramStructuredDto;
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
    if (s.phone_number) lines.push(`📞 Phone: ${s.phone_number}`);
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
