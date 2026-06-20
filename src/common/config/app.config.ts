import { registerAs } from '@nestjs/config';
import * as process from 'process';
import * as dotenv from 'dotenv';
dotenv.config();

export const CONFIG_APP_TOKEN = process.env.CONFIG_APP_TOKEN || 'app';
export const CONFIG_MONGO_DB_TOKEN = process.env.CONFIG_MONGO_DB_TOKEN || 'db';
export const CONFIG_MINIO_TOKEN = process.env.CONFIG_MINIO_TOKEN || 'minio';
export const CONFIG_OPENAI_TOKEN = 'openai';

export const appConfig = registerAs(
  CONFIG_APP_TOKEN,
  (): AppConfig => ({
    host: process.env.APP_HOST || '0.0.0.0',
    port: parseInt(process.env.APP_PORT) || 3000,
    cors_domains: process.env.CORS_DOMAINS || '*',
  })
);

export const dbConfig = registerAs(
  CONFIG_MONGO_DB_TOKEN,
  (): DbConfig => ({
    url: process.env.DATABASE_URL || 'mongodb://localhost:27017/crm',
  })
);

export const minioConfig = registerAs(
  CONFIG_MINIO_TOKEN,
  (): MinioConfig => ({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT) || 9000,
    useSSL: process.env.MINIO_USE_SSL === 'true' || false,
    accessKey: process.env.MINIO_ACCESS_KEY || 'admin',
    secretKey: process.env.MINIO_SECRET_KEY || 'admin',
    bucketName: process.env.MINIO_BUCKET_NAME || 'crm',
    publicUrl: process.env.MINIO_URL || 'http://localhost:9000',
    publicBucket: process.env.MINIO_PUBLIC_BUCKET || 'crm',
  })
);
export const openAIConfig = registerAs(
  CONFIG_OPENAI_TOKEN,
  (): OpenAIConfig => ({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  })
);

export type OpenAIConfig = {
  apiKey: string;
  model: string;
};
export type AppConfig = {
  host: string;
  port: number;
  cors_domains: string;
};

export type DbConfig = {
  url: string;
};

export type MinioConfig = {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucketName: string;
  publicUrl: string;
  publicBucket: string;
};

export const ValidatorConfig = {
  transform: true,
  stopAtFirstError: true,
  whitelist: true,
  transformOptions: {
    enableImplicitConversion: true, // 🔥 SHART
  },
};

export const JwtConfig = {
  secret: process.env.JWT_SECRET_KEY || 'secret-key',
  expiresIn: process.env.JWT_EXPIRES_IN || '10d',
};

export const ProxyConfig = {
  host: process.env.PROXY_HOST || 'localhost',
  port: parseInt(process.env.PROXY_PORT) || 8080,
  token: process.env.PROXY_TOKEN || 'token',
};

export const TelegramConfig=() => ({
  telegramServiceURL: process.env.TELEGRAM_BOT_URL,
  telegramServiceToken: process.env.TELEGRAM_BOT_TOKEN,
  frontendUrl: process.env.FRONTEND_BASE_URL,
});

export const CONFIG_TELEGRAM_GATEWAY_TOKEN = 'telegramGateway';
export const telegramGatewayConfig = registerAs(
  CONFIG_TELEGRAM_GATEWAY_TOKEN,
  (): TelegramGatewayConfig => ({
    apiToken: process.env.TELEGRAM_GATEWAY_API_TOKEN || '',
    senderUsername: process.env.TELEGRAM_GATEWAY_SENDER_USERNAME || undefined,
    ttlSeconds: parseInt(process.env.AUTH_CODE_TTL_SECONDS || '300', 10),
    maxAttempts: parseInt(process.env.AUTH_CODE_MAX_ATTEMPTS || '3', 10),
    resendCooldownSeconds: parseInt(process.env.AUTH_CODE_RESEND_COOLDOWN_SECONDS || '60', 10),
  })
);

export type TelegramGatewayConfig = {
  apiToken: string;
  senderUsername?: string;
  ttlSeconds: number;
  maxAttempts: number;
  resendCooldownSeconds: number;
};

export const RagChatConfig = {
  url: process.env.RAG_API_URL || 'http://localhost:8000',
  token: process.env.RAG_API_TOKEN,
};
