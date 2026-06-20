import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  CONFIG_TELEGRAM_GATEWAY_TOKEN,
  TelegramGatewayConfig,
} from '@/common/config/app.config';

const GATEWAY_BASE_URL = 'https://gatewayapi.telegram.org';

export type SendVerificationResult = {
  requestId: string;
  deliveryStatus?: string;
};

@Injectable()
export class TelegramGatewayService {
  private readonly logger = new Logger(TelegramGatewayService.name);
  private readonly cfg: TelegramGatewayConfig;

  constructor(configService: ConfigService) {
    this.cfg = configService.get<TelegramGatewayConfig>(
      CONFIG_TELEGRAM_GATEWAY_TOKEN
    );
  }

  async sendVerificationCode(
    phoneE164: string,
    code: string
  ): Promise<SendVerificationResult> {
    if (!this.cfg.apiToken) {
      throw new InternalServerErrorException(
        'TELEGRAM_GATEWAY_API_TOKEN is not configured'
      );
    }

    const payload: Record<string, any> = {
      phone_number: phoneE164,
      code,
      ttl: this.cfg.ttlSeconds,
    };
    if (this.cfg.senderUsername) {
      payload.sender_username = this.cfg.senderUsername;
    }

    try {
      const { data } = await axios.post(
        `${GATEWAY_BASE_URL}/sendVerificationMessage`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.cfg.apiToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10_000,
        }
      );

      if (!data?.ok) {
        const errMsg = data?.error || 'Unknown Telegram Gateway error';
        this.logger.error(
          `Telegram Gateway rejected sendVerificationMessage for ${phoneE164}: ${errMsg}`
        );
        throw new InternalServerErrorException(
          `Telegram Gateway error: ${errMsg}`
        );
      }

      return {
        requestId: data.result?.request_id,
        deliveryStatus: data.result?.delivery_status?.status,
      };
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        const body = err.response.data;
        this.logger.error(
          `Telegram Gateway HTTP ${err.response.status}: ${JSON.stringify(body)}`
        );
        throw new InternalServerErrorException(
          `Telegram Gateway error: ${body?.error || err.response.statusText}`
        );
      }
      throw err;
    }
  }
}
