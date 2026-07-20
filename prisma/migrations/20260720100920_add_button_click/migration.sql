-- CreateTable
CREATE TABLE "ButtonClick" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "loadId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ButtonClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ButtonClick_type_createdAt_idx" ON "ButtonClick"("type", "createdAt");

-- CreateIndex
CREATE INDEX "ButtonClick_createdAt_idx" ON "ButtonClick"("createdAt");
