"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  createBrowserExtensionTokenValue,
  getBrowserExtensionTokenPrefix,
  hashBrowserExtensionToken
} from "./token";

export async function createBrowserExtensionToken() {
  const user = await requireUser();
  const rawToken = createBrowserExtensionTokenValue();

  const token = await prisma.browserExtensionToken.create({
    data: {
      userId: user.id,
      tokenHash: hashBrowserExtensionToken(rawToken),
      tokenPrefix: getBrowserExtensionTokenPrefix(rawToken)
    }
  });

  revalidatePath("/settings");

  return {
    ok: true as const,
    id: token.id,
    token: rawToken,
    tokenPrefix: token.tokenPrefix
  };
}

export async function revokeBrowserExtensionToken(tokenId: string) {
  const user = await requireUser();
  await prisma.browserExtensionToken.updateMany({
    where: {
      id: tokenId,
      userId: user.id,
      revokedAt: null
    },
    data: {
      revokedAt: new Date()
    }
  });

  revalidatePath("/settings");
  return { ok: true as const };
}
