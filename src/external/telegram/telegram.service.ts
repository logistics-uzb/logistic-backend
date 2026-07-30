import { Injectable, Logger } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf, Context } from 'telegraf';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  private sentimentTopicMap = {
    good: Number(process.env.TELEGRAM_TOPIC_ID_GOOD_NEWS),
    neutral: Number(process.env.TELEGRAM_TOPIC_ID_NEYRTAL_NEWS),
    bad: Number(process.env.TELEGRAM_TOPIC_ID_BAD_NEWS),
    // bad: Number(process.env.TELEGRAM_TOPIC_ID_BAD_NEWS),
  };

  constructor(@InjectBot() private readonly bot: Telegraf<Context>) {
    this.setupBot();
  }

  private setupBot() {
    // /start komandasi
    this.bot.start((ctx) => {
      ctx.reply(`Bot ishga tushdi! 🚀\n\nChat ID: ${ctx.chat.id}`);
    });

    // Har qanday text xabarni tinglaydi
    this.bot.on('text', (ctx) => {
      ctx.reply(
        `Qabul qildim 👌\n\nChat ID: ${ctx.chat.id}\nXabar: ${ctx.message.text}`
      );
    });
  }

  async sendToGroup(
    text: string,
    topicId?: number,
    options: { parseMode?: 'HTML' | 'Markdown' } = {}
  ) {
    try {
      const chatId = process.env.TELEGRAM_GROUP_ID || '@news_day_scrapping';
      if (!chatId) {
        this.logger.error('TELEGRAM_GROUP_ID .env da topilmadi');
        return;
      }

      const result = await this.bot.telegram.sendMessage(chatId, text, {
        parse_mode: options.parseMode || 'HTML',
        message_thread_id: topicId,
      });
      return result;
    } catch (error: any) {
      // Telegraf xatosini to'liq log qilamiz — endi haqiqiy sababni ko'ramiz.
      const desc =
        error?.response?.description ||
        error?.description ||
        error?.message ||
        String(error);
      const code = error?.response?.error_code ?? error?.code ?? '-';
      this.logger.error(
        `sendToGroup xato chatId=${process.env.TELEGRAM_GROUP_ID} topicId=${topicId} code=${code}: ${desc}`
      );
      throw new Error(`Telegram guruhga xabar yuborilmadi: ${desc}`);
    }
  }
  getTopicIdBySentiment(sentiment: 'good' | 'neutral' | 'bad'): number {
    return this.sentimentTopicMap[sentiment];
  }
}
