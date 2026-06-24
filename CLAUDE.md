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

Production deploys go through [.github/workflows/deploy.yml](.github/workflows/deploy.yml) (push to `main` → SSH deploy to the prod server). The `docker-compose.yml` only runs the `nest-app` service — Postgres, Redis, MinIO, and the Python MTProto sender are expected to be reachable externally.

## Architecture

NestJS 10 + TypeScript service that ingests scraped Telegram logistics posts, classifies them with OpenAI, persists them in PostgreSQL via Prisma, and pushes results back out to Telegram groups and connected WebSocket clients. It also serves a dispatcher-facing API used by an internal frontend.

### End-to-end pipeline (the main thing to understand)

1. **Ingress.** A separate Python scraper pushes raw Telegram messages in through **either**:
   - HTTP `POST /v1/post` ([logistics-message.controller.ts](src/modules/logistics-message/logistics-message.controller.ts)), or
   - Socket.IO event `telegram:new_message_logistics` on [LogisticsGateway](src/modules/notification-gateway/notification-gateway.gateway.ts), which delegates to `SocketService.processTelegramMessage` and then back into `PostsService.create`.
2. **Dedup.** `PostsService.create` ([logistics-message.service.ts](src/modules/logistics-message/logistics-message.service.ts)) rejects duplicates by `(tgMessageId, channelName)` and by exact `text`. On a duplicate hit it bumps `sentToTelegramAt` and returns `{ skipped: true, reason }`.
3. **Classification + extraction.** `OpenaiService.messageAnalyse` ([openai.service.ts](src/modules/openai/openai.service.ts)) first runs a fast **regex/keyword classifier** (`classifier()`) that scores load-related keywords, direction markers, phone numbers, and metric units in Uzbek (Latin + Cyrillic) and Russian. Only messages above the score threshold are sent to **GPT-4o-mini** (`extractData`, `response_format: json_object`, `temperature: 0`) for structured route + metadata extraction. `extractData` swallows OpenAI errors and returns an all-null shape so an OpenAI outage doesn't crash ingest.
4. **Phone gate.** Even if the classifier + GPT say it's a load, `PostsService.create` downgrades it to `REGULAR_MESSAGE` if `metaData.phone_number` is empty. **`aiStatus = LOAD_POST` therefore always implies a non-empty `phoneNumber`.** Only `effectiveIsLoad` posts get the full extracted columns populated and a Telegram alert.
5. **Route resolution.** Extracted `from`/`to` strings are matched against the static dictionary in [src/common/helpers/route-data.ts](src/common/helpers/route-data.ts) via [find-route.ts](src/common/utils/find-route.ts) — first exact alias match, then Levenshtein-based fuzzy match. The dictionary's `indexedName` (e.g. `"uzbekistan"`, `"tashkent_city"`) is what gets stored on `LogisticMessage.countryFrom/To` and `regionFrom/To`; display names are resolved later via `PostsService.getCountryNameByIndexedName` / `getRegionInfoByIndexedName`.
6. **Persistence.** Saved to `LogisticMessage` with `aiStatus = "LOAD_POST" | "REGULAR_MESSAGE"`, `isComplete` true iff all four route fields resolved, and the full OpenAI response retained in the `structured` JSON column. Scraped posts get `source = "SCRAPING"`; dispatcher-submitted posts get `source = "DISPATCHER"` + `createdById` pointing at the `User` row.
7. **Egress.**
   - `TelegramService.sendToGroup` ([external/telegram/telegram.service.ts](src/external/telegram/telegram.service.ts)) uses **nestjs-telegraf** to post into a single configured chat (`TELEGRAM_GROUP_ID`) under specific **forum topic threads**: hardcoded `17906` for incomplete loads, `17903` for complete loads. Topic IDs for sentiment routing come from env (`TELEGRAM_TOPIC_ID_GOOD_NEWS / NEYRTAL_NEWS / BAD_NEWS`).
   - `PostsService.sendToTelegram` (called from `POST /v1/post/send-to-telegram`) **currently only persists** a dispatcher-edited post to `LogisticMessage` with `source = DISPATCHER`. The fan-out to the external Python MTProto sender (`${PYTHON_TELETHON_API_URL}/mtproto/send` + active `TelegramGroup` usernames) is **commented out** in the source — re-enable that block when you actually want the post to leave the system.
8. **Housekeeping.** `@Cron(EVERY_10_MINUTES) deleteOldMessagesByCron` deletes `LogisticMessage` rows older than 24h. There is also a commented-out `@Cron(EVERY_MINUTE) processScrapedChannels` that pulls from `https://logistics-scraping.coachingzona.uz`.

### Module map

- `modules/logistics-message` — class is named `PostsService` / `PostsModule` despite the folder name. All ingest, query, dispatcher-post persistence, and Telegram-send logic lives here. `GET /v1/post/formatted` translates indexed dictionary keys back to display names and adds a relative `sentAgo`; `GET /v1/post/all/sse` re-runs `getAllMessages` on a configurable interval (≥1000 ms) and pushes results over Server-Sent Events. `POST /v1/post/ai-analyser` runs the classifier + OpenAI pipeline **without** persisting and returns a payload pre-shaped for `POST /v1/post/send-to-telegram`.
- `modules/openai` — OpenAI client + regex classifier + GPT-4o-mini extractor.
- `modules/notification-gateway` — Socket.IO gateway (`@WebSocketGateway`) plus `SocketService` that bridges incoming socket events into `PostsService`. Uses `forwardRef` to break the cycle with `PostsService`.
- `modules/telegram-group` — CRUD for the `TelegramGroup` table (whitelist of active destination chats for the now-disabled Python MTProto sender).
- `modules/auth` — JWT-based auth with two roles defined by Prisma `UserRole`:
  - **ADMIN** logs in with `username` + bcrypt `password` at `POST /v1/auth/admin/login`. Bootstrap an ADMIN with `POST /v1/auth/admin/create-admin` (open during initial setup).
  - **DISPATCHER** self-registers via phone OTP: `POST /v1/auth/send-code` → SMS via Eskiz → `POST /v1/auth/verify-code` returns a short-lived (10 min) verification JWT → `POST /v1/auth/register` (purpose `REGISTER`) or `POST /v1/auth/reset-password` (purpose `RESET_PASSWORD`). Existing dispatchers then log in at `POST /v1/auth/login` with username **or** phone (`+998XXXXXXXXX`) + password.
  - Roles are enforced via `JwtAuthGuard` + `RolesGuard` + `@Roles(...)` decorator. OTP policy (TTL, max attempts, resend cooldown) is read from `AUTH_CODE_*` env vars via `authCodeConfig`.
  - Note: some Swagger summaries on the OTP endpoints still say "Telegram Gateway", but the actual sender is `SmsService` (Eskiz.uz).
- `external/eskiz` — Eskiz.uz SMS gateway client used for dispatcher OTP delivery. The SMS template (`"Yukchi ilovasiga kirish uchun kod - {code}"`) must be pre-approved by Eskiz support before production traffic.
- `external/telegram` — outbound Telegraf bot used for the topic-based alerts in `PostsService.create` (separate from the gateway).
- `modules/health` — `/v1/health` liveness probe.
- `modules/prisma` — `@Global()` module exposing `PrismaService`.
- `common/cron`, `common/filter`, `common/interceptors`, `common/config` — global wiring (see Conventions).

Several modules (`TelegramGroupModule`, `OpenaiModule`, `TelegramModule`, `TelegramQueueModule`) are commented out in [app.module.ts](src/app.module.ts) but are still reachable at runtime because `PostsModule` imports `OpenaiModule` directly and `TelegramModule` / `LogisticsGatewayModule` via `forwardRef`. If you need direct HTTP access to `TelegramGroup` CRUD, you have to uncomment `TelegramGroupModule` in `AppModule`.

### Conventions

- **Path alias:** `@/*` → `src/*` (configured in [tsconfig.json](tsconfig.json#L20-L22)). Use it in all new imports.
- **DTOs and shared types live under `src/types/<domain>`**, not next to the controllers. Controllers import `CreateLogisticMessageDto`, `GetLogisticsMessagesDto`, etc. from `@/types/application`, `@/types/auth`, `@/types/logistics-message`, etc.
- **Response shape is wrapped globally** by `ResponseInterceptor` → `{ status_code, data }`. Errors are normalized by `AllExceptionFilter` → `{ status_code, message }`. Don't add your own wrapping in handlers.
- **Country/region columns store the dictionary `indexedName`**, not display names. New endpoints meant for a human-facing UI should translate via `getCountryNameByIndexedName` / `getRegionInfoByIndexedName` (see `getAllMessagesWithFormat` and `parseMessage` for the pattern). Filters and inserts should keep using `indexedName` so scraper-ingested and dispatcher-submitted posts stay queryable under the same vocabulary.
- **`isComplete`** on a `LogisticMessage` is the load-completeness signal — both branches in `PostsService.create` send a Telegram alert; topic `17906` is used for incomplete loads, `17903` for complete loads. If you add a new completeness criterion, update the `isComplete` calculation, both alert branches, the `pickupDate` normalizer, **and** `persistDispatcherPost` (which recomputes `isComplete` from the dispatcher's submitted `country*/region*`).
- **Creator info** is exposed via the `CREATED_BY_SELECT` whitelist in `logistics-message.service.ts` — it selects only `id, fullName, username, phone, role`. Don't re-add `password` or other sensitive columns to that select.
- **Date filters in list queries are UNIX milliseconds**, converted via the local `toDate` helper inside `getAllMessages` / `getAllMessagesWithFormat`.
- **Logging:** every service method uses `private logger = new Logger(ClassName.name)` and logs the method name (or a `[tag]` prefix in `PostsService.create`) at entry. Keep this style — many handlers depend on these debug lines for prod tracing.

### Known footguns

- **`AllExceptionFilter` still imports and handles `MongoError` / `mongoose` errors** ([common/filter/all-exceptions.filter.ts](src/common/filter/all-exceptions.filter.ts)) even though the database is PostgreSQL via Prisma. Mongoose is still in `package.json` and the commented-out `MongooseModule.forRootAsync` block remains in [app.module.ts](src/app.module.ts). Don't reintroduce Mongo — Prisma is the live ORM.
- **`TelegramGroupController` is double-prefixed.** It declares `@Controller('v1/telegram-groups')` on top of the global `v1` prefix, so its routes are served at `/v1/v1/telegram-groups/...`. `AuthController` (`@Controller('auth')`) and `PostsController` (`@Controller('post')`) are correctly single-prefixed. Do **not** add `v1/` to new `@Controller(...)` decorators; rely on the global prefix.
- **`docker-compose.yml` does not declare PostgreSQL, Redis, or MinIO services** and the `.env.example` still shows a `mongodb://` URL for `DATABASE_URL` — both are stale. The real DB is whatever PostgreSQL `DATABASE_URL` is set to in `.env`.
- **Telegram topic IDs (`17906`, `17903`) are hardcoded inline** in `PostsService.create`. Sentiment-routing topic IDs are env-driven, but the load alert IDs are not — changing chats/topics for loads means editing the service.
- **`PostsService.sendToTelegram` is in a transitional "persist only" state.** The Python MTProto fan-out is commented out; the endpoint returns `{ success: true, savedId }` without actually messaging any group. If you re-enable the `axios.post` block, also restore the active-group fetch and the empty-groups guard above it.
- **`PostsModule` ↔ `LogisticsGatewayModule` ↔ `TelegramModule`** have a circular dependency broken by `forwardRef`. New providers that need both `PostsService` and `LogisticsGateway` should follow the same pattern.
- **`strictNullChecks` and `noImplicitAny` are disabled** in tsconfig. Don't assume the compiler is catching nullability bugs.
