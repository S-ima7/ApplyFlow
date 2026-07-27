-- AlterTable
ALTER TABLE "EmailAutomationJob"
ADD COLUMN "aiReservedTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "aiReservationDate" TEXT;

-- CreateTable
CREATE TABLE "AiDailyUsage" (
    "provider" TEXT NOT NULL,
    "usageDate" TEXT NOT NULL,
    "usedTokens" INTEGER NOT NULL DEFAULT 0,
    "reservedTokens" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiDailyUsage_pkey" PRIMARY KEY ("provider", "usageDate")
);
