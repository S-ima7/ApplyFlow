-- CreateTable
CREATE TABLE "EmailImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "gmailThreadId" TEXT,
    "subject" TEXT,
    "fromAddress" TEXT,
    "snippet" TEXT,
    "sentAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiExtractionResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailImportId" TEXT NOT NULL,
    "extractedJson" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION,
    "confirmedAt" TIMESTAMP(3),
    "createdApplicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiExtractionResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailImport_userId_gmailMessageId_key" ON "EmailImport"("userId", "gmailMessageId");

-- CreateIndex
CREATE INDEX "EmailImport_userId_importedAt_idx" ON "EmailImport"("userId", "importedAt");

-- CreateIndex
CREATE INDEX "AiExtractionResult_userId_createdAt_idx" ON "AiExtractionResult"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiExtractionResult_emailImportId_idx" ON "AiExtractionResult"("emailImportId");

-- CreateIndex
CREATE INDEX "AiExtractionResult_createdApplicationId_idx" ON "AiExtractionResult"("createdApplicationId");

-- AddForeignKey
ALTER TABLE "EmailImport" ADD CONSTRAINT "EmailImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiExtractionResult" ADD CONSTRAINT "AiExtractionResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiExtractionResult" ADD CONSTRAINT "AiExtractionResult_emailImportId_fkey" FOREIGN KEY ("emailImportId") REFERENCES "EmailImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiExtractionResult" ADD CONSTRAINT "AiExtractionResult_createdApplicationId_fkey" FOREIGN KEY ("createdApplicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
