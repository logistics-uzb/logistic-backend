import { PrismaClient } from '@prisma/client';

/**
 * TelegramGroup seeder — outbound MTProto guruhlar ro'yxati.
 * Idempotent: `upsert` bilan mavjud username uchun yangilanadi.
 * slowModeSec — Telegram slow-mode sekundlari (ma'lum bo'lganlar uchun).
 */
const TELEGRAM_GROUPS: Array<{
  username: string;
  title: string;
  slowModeSec: number | null;
}> = [
  { username: 'TIRtrans',                       title: 'TIR Trans',                slowModeSec: null },
  { username: 'yuk_gruppa',                     title: 'Yuk gruppa',               slowModeSec: null },
  { username: 'yukboruzb',                      title: 'Yuk bor UZB',              slowModeSec: null },
  { username: 'Russiasng',                      title: 'Russia SNG',               slowModeSec: null },
  { username: 'bbmpy',                          title: 'BBMPY',                    slowModeSec: null },
  { username: 'logistika_ru',                   title: 'Logistika RU',             slowModeSec: null },
  { username: 'Transportationuz',               title: 'Transportation UZ',        slowModeSec: null },
  { username: 'LOGISTIKA_24',                   title: 'Logistika 24',             slowModeSec: null },
  { username: 'akum_tashkent',                  title: 'Akum Tashkent',            slowModeSec: null },
  { username: 'YANDEX_GRUZ_YUKMARKAZI_YUKLAR',  title: 'Yandex Gruz Yukmarkazi',   slowModeSec: 30 },
  { username: 'specgruz_express',               title: 'SpecGruz Express',         slowModeSec: 30 },
  { username: 'isuzuchilar_uzb',                title: 'Isuzuchilar UZB',          slowModeSec: null },
  { username: 'AzerbaijanLogistics',            title: 'Azerbaijan Logistics',     slowModeSec: 10 },
  { username: 'dellakz',                        title: 'Dellakz',                  slowModeSec: 60 },
  { username: 'Logistikagroup',                 title: 'Logistika group',          slowModeSec: 60 },
  { username: 'intercargouzz',                  title: 'Intercargo UZZ',           slowModeSec: 30 },
];

export async function seedTelegramGroups(prisma: PrismaClient): Promise<void> {
  console.log(`[telegram-groups] ${TELEGRAM_GROUPS.length} ta guruh upsert qilinmoqda...`);
  let created = 0;
  let updated = 0;
  for (const g of TELEGRAM_GROUPS) {
    const result = await prisma.telegramGroup.upsert({
      where: { username: g.username },
      create: { ...g, isActive: true },
      update: { title: g.title, slowModeSec: g.slowModeSec },
    });
    // Prisma upsert `wasUpdated` ni qaytarmaydi — createdAt bilan tekshiramiz
    if (result.createdAt.getTime() === result.updatedAt.getTime()) created++;
    else updated++;
  }
  console.log(`[telegram-groups] Tayyor: ${created} yaratildi, ${updated} yangilandi`);
}
