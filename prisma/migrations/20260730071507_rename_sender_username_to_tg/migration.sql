/*
  Warnings:

  - You are about to drop the column `senderUsername` on the `LogisticMessage` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "LogisticMessage" DROP COLUMN "senderUsername",
ADD COLUMN     "senderTgUsername" TEXT;
