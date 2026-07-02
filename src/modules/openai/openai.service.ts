import { CONFIG_OPENAI_TOKEN, OpenAIConfig } from '@/common/config/app.config';
import { routeData } from '@/common/helpers/route-data';
import { findRoute } from '@/common/utils/find-route';
import { extractDataPrompt, extractMultiDataPrompt } from '@/common/utils/promts';
import { MessageAnalyseDto } from '@/types/openai';
import { Injectable, Inject, Logger } from '@nestjs/common';
import OpenAI from 'openai';

// Bo'lakli (multi-load) tarmoqqa o'tish chegarasi.
// Bu qiymatdan kichik matnlar — hozirgi classifier + bitta yukli extractData
// quvurini ishlatadi; kattalari — extractDataMulti() ga yo'naltiriladi.
// classifier() ichidagi MAX_LENGTH bilan bir xil bo'lishi shart, aks holda
// "uzun lekin multi-branch'ga kirmagan" oraliq paydo bo'ladi.
const MULTI_LOAD_THRESHOLD = 400;
// import { CONFIG_OPENAI_TOKEN, OpenAIConfig } from 'src/config/openai.config';
@Injectable()
export class OpenaiService {
  private logger = new Logger(OpenaiService.name);
  private client: OpenAI;
  private model: string;
  constructor(
    @Inject(CONFIG_OPENAI_TOKEN)
    private readonly openaiConfig: OpenAIConfig
  ) {
    this.client = new OpenAI({
      apiKey: this.openaiConfig.apiKey,
    });

    this.model = this.openaiConfig.model;
  }

  async askGPT(prompt: string): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
    });

    return completion.choices[0].message.content;
  }

  /**
   * messageAnalyse — qaytarish shakli ikki xil bo'lishi mumkin:
   *
   *   SINGLE (text.length <= MULTI_LOAD_THRESHOLD):
   *     { isMulti: false, classifieredMessage, route, metaData }
   *
   *   MULTI  (text.length > MULTI_LOAD_THRESHOLD):
   *     { isMulti: true,  classifieredMessage, loads: [{ route, metaData }, ...] }
   *
   * PostsService.create — `isMulti` flag'iga qarab tarmoqlanadi.
   */
  async messageAnalyse(message: MessageAnalyseDto): Promise<any> {
    const text = message.message ?? '';

    // -----------------------------------------------------------------
    // MULTI-LOAD TARMOQ — uzun habarlar
    // -----------------------------------------------------------------
    // Bu yerda regex classifier'ni o'tkazib yuboramiz, chunki uning
    // MAX_LENGTH=400 cheklovi har qanday batch habarni avtomatik rad etadi.
    // O'rniga GPT'ga ishonamiz — u har bo'lakni o'zicha klassifikatsiya qiladi.
    // -----------------------------------------------------------------
    if (text.length > MULTI_LOAD_THRESHOLD) {
      this.logger.log(
        `[messageAnalyse] text_len=${text.length} > ${MULTI_LOAD_THRESHOLD} → multi-load branch`
      );
      const multi = await this.extractDataMulti(text);
      const loadsCount = multi?.loads?.length ?? 0;

      return {
        isMulti: true,
        classifieredMessage: {
          isLoad: loadsCount > 0,
          type: loadsCount > 0 ? 'MULTI_LOAD' : 'REGULAR_MESSAGE',
          confidence: loadsCount,
          originalText: text.substring(0, 50) + '...',
        },
        loads: multi.loads,
      };
    }
    //comment`
    // -----------------------------------------------------------------
    // SINGLE TARMOQ — hozirgi pipeline o'zgarmasdan
    // -----------------------------------------------------------------
    const classifieredMessage = await this.classifier(text);

    if (!classifieredMessage.isLoad) {
      return {
        isMulti: false,
        classifieredMessage,
        route: null,
        metaData: null,
      };
    }

    const data = await this.extractData(text);

    // extractData can return:
    //  - null            (GPT returned from=null && to=null)
    //  - { from: null, to: null, ... }   (OpenAI call threw — caught & swallowed)
    //  - a populated object
    // Guard every access so an OpenAI outage or unparseable text doesn't crash
    // the whole ingest pipeline.
    return {
      isMulti: false,
      classifieredMessage,
      route: {
        fromCountry: data?.from?.country?.indexedName ?? null,
        toCountry: data?.to?.country?.indexedName ?? null,
        fromRegion: data?.from?.region?.indexedName ?? null,
        toRegion: data?.to?.region?.indexedName ?? null,
      },
      metaData: {
        title: data?.title ?? null,
        weight: data?.weight ?? null,
        cargoUnit: data?.cargoUnit ?? null,
        vehicleType: data?.vehicleType ?? null,
        paymentType: data?.paymentType ?? null,
        paymentAmount: data?.paymentAmount ?? null,
        advancePayment: data?.advancePayment ?? null,
        paymentCurrency: data?.paymentCurrency ?? null,
        pickupDate: data?.pickupDate ?? null,
        phone_number: data?.phone_number ?? null,
      },
    };
  }

  // ISCLOSE FUNCTION
  async normalizeLoc(s) {
    return (s ?? '')
      .toLowerCase()
      .trim()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '') // diacritics
      .replace(/[`ʻ’‘]/g, "'") // har xil apostroflarni bitta qil
      .replace(/o['’ʻ]g/g, 'og') // o‘g -> og (xohlasang)
      .replace(/g['’ʻ]/g, 'g') // g‘ -> g
      .replace(/o['’ʻ]/g, 'o') // o‘ -> o
      .replace(/[^a-zа-яё\s-]/g, '') // faqat harf
      .replace(/\s+/g, ' ')
      .trim();
  }

  async levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length,
      n = b.length;
    if (!m) return n;
    if (!n) return m;

    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[m][n];
  }

  async isClose(a, b) {
    a = await this.normalizeLoc(a);
    b = await this.normalizeLoc(b);
    if (!a || !b) return false;
    if (a === b) return true;
    // 1 harf farq (kukon~kokon), uzunroq bo‘lsa 2 gacha
    const maxDist = a.length <= 6 && b.length <= 6 ? 1 : 2;
    return (await this.levenshtein(a, b)) <= maxDist;
  }

  // CLASSIFIER
  async classifier(text) {
    const MAX_LENGTH = 400;

    const THRESHOLD = 5; // Chegara

    const ALLOWED_SYMBOLS = ['+', '-', '.', ',', '$', '%', ':', '/'];
    if (!text) return { isLoad: false, type: 'no-text', confidence: 0 };
    if (text.length > MAX_LENGTH)
      return { isLoad: false, type: 'too-long', confidence: 0 };

    function removeEmojis(text) {
      const escaped = ALLOWED_SYMBOLS.map((s) =>
        s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
      ) // regex escape
        .join('');

      const regex = new RegExp(`[^\\p{L}\\p{N}\\s${escaped}]`, 'gu');

      return text
        .normalize('NFKC')
        .replace(/\p{Extended_Pictographic}/gu, '')
        .replace(/\uFE0F/g, '')
        .replace(regex, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const cleanText = removeEmojis(text).toLowerCase();

    // 1. Yuk tashishga xos kalit so'zlar (Lotin va Kirill uyg'unligi)
    const loadKeywords = [
      'yuk',
      'юк',
      'moshina',
      'мошина',
      'mashina',
      'машина',
      'fura',
      'фура',
      'isuzu',
      'исузу',
      'kamaz',
      'камаз',
      'gazel',
      'газел',
      'reys',
      'рейс',
      'tonna',
      'тонна',
      ' tn',
      ' тн',
      ' kg',
      ' кг',
      'kub',
      'куб',
      "so'm",
      'som',
      'сум',
      'сўм',
      'dostavka',
      'доставка',
      'pochta',
      'почта',
      'bor',
      'бор',
      'ketti',
      'кетди',
      'shofyor',
      'шофёр',
      'исузи',
      'лабо',

      'ref',

      'yuk',
      'moshina',
      'mashina',
      'kamaz',
      'fura',
      'isuzu',
      'labo',
      'gazel',
      'reys',
      'tonna',
      'tn',
      'kg',
      'kilo',
      'kub',
      "so'm",
      'som',
      'dostavka',
      'pochta',
      "bo'sh",
      'bosh',
      'bor',
      'ketti',
      'ketdi',
      'shofyor',
      'haydovchi',

      'груз',
      'т',
      'авто',
      'вес',
      'груз',
      'оплата',
      'аванс',
      'погрузка',
      'тент',
      'реф',
      'готов',
    ];

    // 2. Yuk bo'lmagan so'zlar (qattiq blok)
    const strictZeroWords = [
      'salom',
      'салом',
      'reklama',
      'реклама',
      'aksiya',
      'акция',
      'tabrik',
      'поздравляю',
      'sotiladi',
      'продается',
      'ish bor',
      'работа',
      'vakansiya',
      'вакансия',
      'obuna',
      'обуна',
      'guruhga',
      'yozish',
    ];

    // STRICT ZERO CHECK
    for (const word of strictZeroWords) {
      if (cleanText.includes(word)) {
        return {
          isLoad: false,
          type: 'REGULAR_MESSAGE',
          confidence: 0,
          cleanText: cleanText,
          originalText: text.substring(0, 50) + '...',
        };
      }
    }

    // 2. Yo'nalish ko'rsatuvchi qo'shimchalar (Lotin va Kirill)
    // -dan, -ga, -дан, -га, shuningdek strelka belgisi →
    const directionPattern = /([a-z'а-я]+(dan|ga|дан|га|qa|ка)|[→\-<>|])/i;

    // 3. Telefon raqami (Yuk xabarlarida deyarli har doim bo'ladi)
    const phonePattern =
      /(?:\+?998|9[0-9]|88|99|97|93|94|95|91|90|33|77|50|20)\s?\d{3}\s?\d{2}\s?\d{2}/;

    // 4. Metrik pattern (Og'irlik yoki narx: 10т, 500$, 7млн)
    const metricPattern =
      /(\d+\s*(tn|t|тн|т|тонна|кг|kg|сум|сўм|som|usd|\$|млн))/i;

    let score = 0;

    // Kalit so'zlarni tekshirish
    loadKeywords.forEach((word) => {
      if (cleanText.includes(word)) score += 1.5;
    });

    // Yo'nalish belgilari uchun ball
    if (directionPattern.test(cleanText)) score += 2;

    // Telefon raqami mavjudligi - juda kuchli indikator
    if (phonePattern.test(cleanText)) score += 3;

    // Metrik o'lchovlar
    if (metricPattern.test(cleanText)) score += 2;

    // Maxsus: Agar xabarda → belgisi bo'lsa (Siz yuborgan msg1 kabi)
    if (cleanText.includes('→') || cleanText.includes('—')) score += 2;

    return {
      isLoad: score >= THRESHOLD,
      type: score >= THRESHOLD ? 'LOAD_POST' : 'REGULAR_MESSAGE',
      confidence: score,
      cleanText: cleanText,
      originalText: text.substring(0, 50) + '...', // Matndan namuna
    };
  }






  async extractData(text) {
    try {
      const completion = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: extractDataPrompt },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      });

      const rawResult = JSON.parse(completion.choices[0].message.content);

      if (rawResult.from === null && rawResult.to === null) {
        return null;
      }

      const from = await findRoute(rawResult.from);
      const to = await findRoute(rawResult.to);

      return {
        from: {
          country: from?.country,
          region: from?.region,
        },
        to: {
          country: to?.country,
          region: to?.region,
        },
        title: rawResult?.title,
        weight: rawResult?.weight,
        cargoUnit: rawResult?.cargoUnit,
        vehicleType: rawResult?.vehicleType,
        paymentType: rawResult?.paymentType,
        paymentAmount: rawResult?.paymentAmount,
        advancePayment: rawResult?.advancePayment,
        paymentCurrency: rawResult?.paymentCurrency,
        pickupDate: rawResult?.pickupDate,
        phone_number: rawResult?.phone_number,
      };
    } catch (error) {
      console.error('Xatolik:', error);
      return {
        from: null,
        to: null,
        title: null,
        weight: null,
        cargoUnit: null,
        vehicleType: null,
        paymentType: null,
        paymentAmount: null,
        advancePayment: null,
        paymentCurrency: null,
        pickupDate: null,
        phone_number: null,
      };
    }
  }

  /**
   * Uzun habardan (MULTI_LOAD_THRESHOLD dan kotta) bir nechta yukni ajratib
   * olish uchun GPT-4o-mini chaqiruvi. extractMultiDataPrompt prompt'i
   * { loads: [...] } shaklida array qaytaradi; har bir element extractData
   * qaytaradigan obyektga deyarli bir xil — faqat har bir yuk uchun.
   *
   * Qaytarish shakli (PostsService uchun mos):
   *   {
   *     loads: [
   *       {
   *         route: { fromCountry, toCountry, fromRegion, toRegion },
   *         metaData: { title, weight, ... phone_number }
   *       },
   *       ...
   *     ]
   *   }
   *
   * Xatolik yoki bo'sh array bo'lsa — { loads: [] } qaytaradi.
   */
  async extractDataMulti(text: string): Promise<{ loads: any[] }> {
    let rawResult: any;
    try {
      const completion = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: extractMultiDataPrompt },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      });
      rawResult = JSON.parse(completion.choices[0].message.content);
    } catch (error) {
      this.logger.error(
        `[extractDataMulti] OpenAI/JSON xatosi: ${error?.message ?? error}`
      );
      return { loads: [] };
    }

    const rawLoads: any[] = Array.isArray(rawResult?.loads)
      ? rawResult.loads
      : [];

    if (rawLoads.length === 0) {
      this.logger.warn(`[extractDataMulti] GPT 0 ta yuk qaytardi`);
      return { loads: [] };
    }

    // Har bir yukning from/to ni route dictionary'ga moslash —
    // single tarmog'idagi findRoute() bilan bir xil mantiq.
    const loads = await Promise.all(
      rawLoads.map(async (raw: any) => {
        if (raw == null || typeof raw !== 'object') {
          return null;
        }
        const from = await findRoute(raw.from);
        const to = await findRoute(raw.to);

        return {
          route: {
            fromCountry: from?.country?.indexedName ?? null,
            toCountry: to?.country?.indexedName ?? null,
            fromRegion: from?.region?.indexedName ?? null,
            toRegion: to?.region?.indexedName ?? null,
          },
          metaData: {
            title: raw?.title ?? null,
            weight: raw?.weight ?? null,
            cargoUnit: raw?.cargoUnit ?? null,
            vehicleType: raw?.vehicleType ?? null,
            paymentType: raw?.paymentType ?? null,
            paymentAmount: raw?.paymentAmount ?? null,
            advancePayment: raw?.advancePayment ?? null,
            paymentCurrency: raw?.paymentCurrency ?? null,
            pickupDate: raw?.pickupDate ?? null,
            phone_number: raw?.phone_number ?? null,
          },
        };
      })
    );

    return { loads: loads.filter((l) => l !== null) };
  }
}
