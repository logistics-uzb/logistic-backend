-- CreateEnum
CREATE TYPE "SendStatus" AS ENUM ('PENDING', 'QUEUED', 'SENDING', 'SENT', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BlockReason" AS ENUM ('PEER_FLOOD', 'FLOOD_WAIT', 'SLOW_MODE', 'WRITE_FORBIDDEN', 'BANNED', 'INVALID_USERNAME', 'UNKNOWN');

-- AlterTable
ALTER TABLE "LogisticMessage" ADD COLUMN     "queuedAt" TIMESTAMP(3),
ADD COLUMN     "sendFinishedAt" TIMESTAMP(3),
ADD COLUMN     "sendResults" JSONB,
ADD COLUMN     "sendStartedAt" TIMESTAMP(3),
ADD COLUMN     "sendStatus" "SendStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "BlockedGroup" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "reason" "BlockReason" NOT NULL,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unblockAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockedGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlockedGroup_username_key" ON "BlockedGroup"("username");

-- CreateIndex
CREATE INDEX "BlockedGroup_unblockAt_idx" ON "BlockedGroup"("unblockAt");

-- CreateIndex
CREATE INDEX "LogisticMessage_sendStatus_idx" ON "LogisticMessage"("sendStatus");
