/*
  Warnings:

  - A unique constraint covering the columns `[chatId]` on the table `TelegramGroup` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "TelegramGroup" ADD COLUMN     "chatId" BIGINT,
ADD COLUMN     "members" INTEGER,
ADD COLUMN     "type" TEXT,
ALTER COLUMN "username" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "TelegramGroup_chatId_key" ON "TelegramGroup"("chatId");

-- CreateIndex
CREATE INDEX "TelegramGroup_isActive_idx" ON "TelegramGroup"("isActive");
