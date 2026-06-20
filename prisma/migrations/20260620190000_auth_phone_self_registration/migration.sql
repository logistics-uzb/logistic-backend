-- User rebuild: drop existing rows (per product decision: start clean) and replace
-- the loginCode mechanism with phone + password self-registration.

TRUNCATE TABLE "User" RESTART IDENTITY CASCADE;

DROP INDEX IF EXISTS "User_loginCode_key";
ALTER TABLE "User" DROP COLUMN IF EXISTS "loginCode";

ALTER TABLE "User" ADD COLUMN "phone" TEXT;
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- VerificationCode + purpose enum for SMS/Telegram-Gateway verification flows.
CREATE TYPE "VerificationPurpose" AS ENUM ('REGISTER', 'RESET_PASSWORD');

CREATE TABLE "VerificationCode" (
    "id"           SERIAL PRIMARY KEY,
    "phone"        TEXT NOT NULL,
    "codeHash"     TEXT NOT NULL,
    "purpose"      "VerificationPurpose" NOT NULL,
    "attemptsLeft" INTEGER NOT NULL DEFAULT 3,
    "expiresAt"    TIMESTAMP(3) NOT NULL,
    "consumedAt"   TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "VerificationCode_phone_purpose_idx" ON "VerificationCode"("phone", "purpose");
