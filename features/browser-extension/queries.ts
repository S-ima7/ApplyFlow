import { prisma } from "@/lib/prisma";

export async function getBrowserExtensionTokens(userId: string) {
  return prisma.browserExtensionToken.findMany({
    where: {
      userId,
      revokedAt: null
    },
    select: {
      id: true,
      tokenPrefix: true,
      createdAt: true,
      lastUsedAt: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
}
