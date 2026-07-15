import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashBrowserExtensionToken, isBrowserExtensionToken } from "./token";

export type BrowserExtensionAuthentication =
  | { ok: true; user: User; tokenId: string }
  | { ok: false; status: 401; message: string };

export async function authenticateBrowserExtensionRequest(
  request: Request
): Promise<BrowserExtensionAuthentication> {
  const authorization = request.headers.get("authorization");
  const rawToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (!isBrowserExtensionToken(rawToken)) {
    return { ok: false, status: 401, message: "拡張機能トークンが必要です" };
  }

  const now = new Date();
  const token = await prisma.browserExtensionToken.findUnique({
    where: {
      tokenHash: hashBrowserExtensionToken(rawToken)
    },
    include: {
      user: true
    }
  });

  if (!token || token.revokedAt || (token.expiresAt && token.expiresAt <= now)) {
    return { ok: false, status: 401, message: "拡張機能トークンが無効です" };
  }

  await prisma.browserExtensionToken.update({
    where: { id: token.id },
    data: { lastUsedAt: now }
  });

  return { ok: true, user: token.user, tokenId: token.id };
}
