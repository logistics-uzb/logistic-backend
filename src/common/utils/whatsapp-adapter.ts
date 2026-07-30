import { CreateLogisticMessageDto, WhatsAppMessagePayloadDto } from '@/types/application';

/**
 * WhatsApp payload'ini `PostsService.create` kutadigan shape'ga o'giradi.
 *
 * KEY DECISION: `LogisticMessage.tgMessageId` Prisma'da `Int` (schema.prisma:35).
 * WhatsApp ID'lari hex string (masalan "3EB0C767D82B5F5A1E9A") — Int'ga sig'maydi.
 * Yechim: WA ID'ni deterministik 31-bit positive int'ga hash qilamiz.
 *
 *   parseInt(waId.slice(-8), 16) & 0x7fffffff
 *
 * - Deterministik: bir xil waMessageId → bir xil son → dedup ishlaydi
 * - 31-bit (positive): PostgreSQL Int (Prisma default) diapazoniga sig'adi
 * - Kolliziya xavfi: 2^31 keng makonda kam. Hatto kolliziya bo'lganda ham
 *   dedup kaliti `(tgMessageId, channelName)` — WhatsApp uchun channelName
 *   `chatId` bo'ladi, shuning uchun kolliziya faqat bir guruh ichida bir
 *   xil hash bergan ikki xabar orasida bo'lishi mumkin. Bunga qo'shimcha
 *   himoya STEP 3 (text-based dedup) ta'minlaydi.
 */
export function waMessageIdToInt(waMessageId: string): number {
  if (!waMessageId) return 0;

  const cleaned = waMessageId.replace(/[^0-9A-Fa-f]/g, '');
  if (!cleaned) {
    // Hex bo'lmasa (kutilmagan format) — string bo'yicha oddiy hash
    let hash = 0;
    for (let i = 0; i < waMessageId.length; i++) {
      hash = ((hash << 5) - hash + waMessageId.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  const tail = cleaned.slice(-8); // oxirgi 8 hex belgi = 32 bit
  const value = parseInt(tail, 16);
  if (Number.isNaN(value)) return 0;
  return value & 0x7fffffff; // 31-bit positive
}

/**
 * views yo'q — WhatsApp'da bunday metric yo'q. senderPhone matnga qo'shiladi
 * yoki backend structured'ida qoladi (hozircha shunchaki text bilan uzatiladi).
 */
export function whatsappToCreateDto(
  payload: WhatsAppMessagePayloadDto
): CreateLogisticMessageDto {
  return {
    tgMessageId: waMessageIdToInt(payload.waMessageId),
    channelName: payload.chatId,
    text: payload.text ?? '',
    date: payload.date,
    views: null,
    // WhatsApp'da username tushunchasi yo'q — telefon raqami identifikator.
    // senderId'ga JID'ni beramiz, senderTgUsername/senderFullName null.
    senderTgUsername: null,
    senderFullName: payload.groupName ?? null,
    senderId: payload.sender ?? null,
    postAuthor: null,
  };
}
