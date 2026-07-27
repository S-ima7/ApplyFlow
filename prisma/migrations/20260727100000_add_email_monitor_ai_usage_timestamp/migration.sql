-- AlterTable
ALTER TABLE "EmailAutomationJob" ADD COLUMN "aiProcessedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "EmailAutomationJob_aiProcessedAt_idx" ON "EmailAutomationJob"("aiProcessedAt");
