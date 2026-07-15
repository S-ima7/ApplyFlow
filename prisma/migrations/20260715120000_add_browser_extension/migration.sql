-- Extend applications with the minimum structured metadata captured by the browser extension.
ALTER TABLE "Application"
ADD COLUMN "sourceSite" TEXT,
ADD COLUMN "sourceJobId" TEXT,
ADD COLUMN "sourceKey" TEXT,
ADD COLUMN "locationText" TEXT,
ADD COLUMN "employmentTypeText" TEXT,
ADD COLUMN "compensationText" TEXT,
ADD COLUMN "capturedAt" TIMESTAMP(3),
ADD COLUMN "captureAdapterVersion" TEXT,
ADD COLUMN "captureIdempotencyKey" TEXT;

CREATE UNIQUE INDEX "Application_userId_sourceKey_key"
ON "Application"("userId", "sourceKey");

CREATE UNIQUE INDEX "Application_userId_captureIdempotencyKey_key"
ON "Application"("userId", "captureIdempotencyKey");

-- Store only a SHA-256 digest of extension bearer tokens.
CREATE TABLE "BrowserExtensionToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Chrome extension',
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrowserExtensionToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrowserExtensionToken_tokenHash_key"
ON "BrowserExtensionToken"("tokenHash");

CREATE INDEX "BrowserExtensionToken_userId_revokedAt_idx"
ON "BrowserExtensionToken"("userId", "revokedAt");

ALTER TABLE "BrowserExtensionToken"
ADD CONSTRAINT "BrowserExtensionToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
