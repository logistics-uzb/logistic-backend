# =============================================================================
# Stage 1: Build NestJS app
# =============================================================================
FROM node:20.11.0 AS builder

WORKDIR /app

# Deps
COPY package*.json ./
RUN npm ci

# Schema oldin ko'chirib prisma generate — TS build'da @prisma/client type'lari kerak
COPY prisma ./prisma
RUN npx prisma generate

# Qolgan kod
COPY . .
RUN npm run build

# =============================================================================
# Stage 2: Production image (kichikroq)
# =============================================================================
FROM node:20.11.0-alpine

WORKDIR /app

# openssl — Prisma runtime uchun kerak (alpine'da yetishmasligi mumkin)
RUN apk add --no-cache openssl

# Prod deps (dev'siz)
COPY package*.json ./
RUN npm ci --omit=dev

# Prisma schema + generated client
COPY prisma ./prisma
RUN npx prisma generate

# Build natijasi
COPY --from=builder /app/dist ./dist

EXPOSE 5000

CMD ["node", "dist/main.js"]
