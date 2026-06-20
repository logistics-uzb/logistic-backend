# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install
npm install

# Local dev (watch mode)
npm run start:dev

# Build  ⚠️ uses `rm -rf dist && nest build` — the rm step fails on PowerShell.
# On Windows run `nest build` directly, or `Remove-Item -Recurse -Force dist; nest build`.
npm run build
npm run start:prod          # node dist/main

# Lint / format
npm run lint                # eslint --fix on src, apps, libs, test
npm run format              # prettier write on src + test

# Tests (Jest, rootDir = src, pattern *.spec.ts)
npm test
npm run test:watch
npm test -- path/to/file.spec.ts            # single file
npm test -- -t "name of describe or it"     # single test by name
npm run test:e2e                             # uses test/jest-e2e.json

# Prisma (PostgreSQL)
npx prisma generate
npx prisma migrate dev --name <change>
npx prisma migrate deploy
npx prisma studio
```

Swagger UI is mounted at `/docs`. Global HTTP prefix is `v1` (set in [src/main.ts](src/main.ts#L23)), so all controller paths are served under `/v1/...`.

## Architecture

NestJS 10 + TypeScript service that ingests scraped Telegram logistics posts, classifies them with OpenAI, persists them in PostgreSQL via Prisma, and pushes results back out to Telegram groups and connected WebSocket clients.

### End-to-end pipeline (the main thing to understand)

1. **Ingress.** A separate Python scraper pushes raw Telegram messages in through **either**:
   - HTTP `POST /v1/post` ([logistics-message.controller.ts](src/modules/logistics-message/logistics-message.controller.ts)), or
   - Socket.IO event `telegram:new_message_logistics` on [LogisticsGateway](src/modules/notification-gateway/notification-gateway.gateway.ts), which delegates to `SocketService.processTelegramMessage` and then back into `PostsService.create`.
2. **Dedup.** `PostsService.create` ([logistics-message.service.ts](src/modules/logistics-message/logistics-message.service.ts)) rejects duplicates by `(tgMessageId, channelName)` and by exact `text`.
3. **Classification + extraction.** `OpenaiService.messageAnalyse` ([openai.service.ts](src/modules/openai/openai.service.ts)) first runs a fast **regex/keyword classifier** (`classifier()`) that scores load-related keywords, direction markers, phone numbers, and metric units in Uzbek (Latin + Cyrillic) and Russian. Only messages above the score threshold are sent to **GPT-4o-mini** (`extractData`) for structured route + metadata extraction.
4. **Route resolution.** Extracted `from`/`to` strings are matched against the static dictionary in [src/common/helpers/route-data.ts](src/common/helpers/route-data.ts) via [find-route.ts](src/common/utils/find-route.ts) — first exact alias match, then Levenshtein-based fuzzy match (threshold 0.75). The dictionary is the source of truth for `countryFrom/To` and `regionFrom/To` indexed names stored on `LogisticMessage`.
5. **Persistence.** Saved to `LogisticMessage` with `aiStatus = "LOAD_POST" | "REGULAR_MESSAGE"`, `isComplete` derived from whether all four route fields resolved, and the full OpenAI response retained in the `structured` JSON column.
6. **Egress.**
   - `TelegramService.sendToGroup` ([external/telegram/telegram.service.ts](src/external/telegram/telegram.service.ts)) uses **nestjs-telegraf** to post into a single configured chat (`TELEGRAM_GROUP_ID`) under specific **forum topic threads** identified by hardcoded numeric topic IDs (e.g. `17906` for incomplete loads, `17903` for complete loads). Topic IDs for sentiment routing also come from `TELEGRAM_TOPIC_ID_GOOD_NEWS / NEYRTAL_NEWS / BAD_NEWS`.
   - `PostsService.sendToTelegram` (called from `POST /v1/post/send-to-telegram`) POSTs to an **external Python MTProto sender** at `${PYTHON_TELETHON_API_URL}/mtproto/send` with the message + active group usernames pulled from the `TelegramGroup` table.
7. **Housekeeping.** `@Cron(EVERY_10_MINUTES) deleteOldMessagesByCron` deletes `LogisticMessage` rows older than 24h. There is also a commented-out `@Cron(EVERY_MINUTE) processScrapedChannels` that pulls from `https://logistics-scraping.coachingzona.uz`.

### Module map

- `modules/logistics-message` — class is named `PostsService` / `PostsModule` despite the folder name. All ingest, query, and Telegram-send logic lives here.
- `modules/openai` — OpenAI client + classifier + extractor.
- `modules/notification-gateway` — Socket.IO gateway (`@WebSocketGateway`) plus `SocketService` that bridges incoming socket events into `PostsService`. Uses `forwardRef` to break the cycle with `PostsService`.
- `modules/telegram-group` — CRUD for the `TelegramGroup` table (whitelist of active destination chats for the Python MTProto sender).
- `modules/auth` — JWT-based auth with two roles defined by `UserRole` enum in Prisma:
  - **ADMIN** logs in with `username` + bcrypt `password` at `POST /v1/v1/auth/admin/login`.
  - **DISPATCHER** logs in with a generated 10-digit `loginCode` at `POST /v1/v1/auth/user/login`.
  Roles are enforced via `JwtAuthGuard` + `RolesGuard` + `@Roles(...)` decorator.
- `modules/prisma` — `@Global()` module exposing `PrismaService`.
- `external/telegram` — outbound Telegraf bot (separate from the gateway).
- `common/cron`, `common/filter`, `common/interceptors`, `common/config` — global wiring (see Conventions).

### Conventions

- **Path alias:** `@/*` → `src/*` (configured in [tsconfig.json](tsconfig.json#L20-L22)). Use it in all new imports.
- **DTOs and shared types live under `src/types/<domain>`**, not next to the controllers. Controllers import `CreateLogisticMessageDto`, `GetLogisticsMessagesDto`, etc. from `@/types/application`.
- **Response shape is wrapped globally** by `ResponseInterceptor` → `{ status_code, data }`. Errors are normalized by `AllExceptionFilter` → `{ status_code, message }`. Don't add your own wrapping in handlers.
- **`isComplete`** on a `LogisticMessage` is the load-completeness signal — both branches in `PostsService.create` send a Telegram alert; topic `17906` is used for incomplete loads, `17903` for complete loads. If you add a new completeness criterion, update the `isComplete` calculation, both alert branches, and the `pickupDate` normalizer.
- **Date filters in list queries are UNIX milliseconds**, converted via the local `toDate` helper inside `getAllMessages` / `getAllMessagesWithFormat`.
- **Logging:** every service method uses `private logger = new Logger(ClassName.name)` and logs `methodName` at entry. Keep this style — many handlers depend on these debug lines for prod tracing.

### Known footguns

- **`AllExceptionFilter` still imports and handles `MongoError` / `mongoose` errors** ([common/filter/all-exceptions.filter.ts](src/common/filter/all-exceptions.filter.ts)) even though the database is PostgreSQL via Prisma. Mongoose is still in `package.json` and the commented-out `MongooseModule.forRootAsync` block remains in [app.module.ts](src/app.module.ts). Don't reintroduce Mongo — Prisma is the live ORM.
- **Two controllers prefix their route with `v1/` on top of the global prefix**, producing double-prefixed paths:
  - `AuthController` → `/v1/v1/auth/...`
  - `TelegramGroupController` → `/v1/v1/telegram-groups/...`
  `PostsController` (`@Controller('post')`) correctly serves at `/v1/post`. If you add new endpoints, **do not** add `v1/` to the `@Controller(...)` decorator; rely on the global prefix.
- **`docker-compose.yml` does not declare a PostgreSQL service** and the `.env.example` still shows a `mongodb://` URL — both are stale. The real DB is whatever `DATABASE_URL` (PostgreSQL) is set to in `.env`.
- **Telegram topic IDs (`17906`, `17903`, etc.) are hardcoded inline** in `PostsService.create`. Changing chats/topics means editing the service, not just env vars.
- **`strictNullChecks` and `noImplicitAny` are disabled** in tsconfig. Don't assume the compiler is catching nullability bugs.
