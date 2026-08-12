-- Keep the token columns during the acceptance window so the previous app can
-- still be restored without a destructive down migration.
ALTER TABLE "EmailAutomationJob"
ADD COLUMN "aiReservedNeurons" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "aiNeuronReservationDate" TEXT;

ALTER TABLE "AiDailyUsage"
ADD COLUMN "usedNeurons" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "reservedNeurons" INTEGER NOT NULL DEFAULT 0;

-- Old Groq reservations use a different unit and must not be reused by either
-- version after the provider cutover.
UPDATE "EmailAutomationJob"
SET "aiReservedTokens" = 0,
    "aiReservationDate" = NULL;

UPDATE "AiDailyUsage"
SET "usedTokens" = 0,
    "reservedTokens" = 0
WHERE "provider" = 'groq';
