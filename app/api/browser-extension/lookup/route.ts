import { DeadlineStatus } from "@prisma/client";
import {
  BrowserExtensionRequestError,
  browserExtensionJson,
  browserExtensionOptionsResponse,
  readBrowserExtensionJson
} from "@/features/browser-extension/api";
import { authenticateBrowserExtensionRequest } from "@/features/browser-extension/auth";
import {
  browserExtensionLookupSchema,
  buildBrowserExtensionSourceKey,
  normalizeCapturedUrl,
  validateCaptureSourceHost
} from "@/features/browser-extension/contracts";
import { prisma } from "@/lib/prisma";

export function OPTIONS() {
  return browserExtensionOptionsResponse();
}

export async function POST(request: Request) {
  try {
    const authentication = await authenticateBrowserExtensionRequest(request);

    if (!authentication.ok) {
      return browserExtensionJson(
        { ok: false, code: "AUTH_REQUIRED", message: authentication.message },
        { status: authentication.status }
      );
    }

    const parsed = browserExtensionLookupSchema.safeParse(
      await readBrowserExtensionJson(request)
    );

    if (!parsed.success || !validateCaptureSourceHost(parsed.data.sourceSite, parsed.data.sourceUrl)) {
      return browserExtensionJson(
        { ok: false, code: "INVALID_INPUT", message: "求人ページ情報が不正です" },
        { status: 400 }
      );
    }

    const application = await prisma.application.findFirst({
      where: {
        userId: authentication.user.id,
        OR: [
          { sourceKey: buildBrowserExtensionSourceKey(parsed.data) },
          { sourceUrl: normalizeCapturedUrl(parsed.data.sourceUrl) }
        ],
        deletedAt: null
      },
      select: {
        id: true,
        status: true,
        company: { select: { name: true } },
        position: true,
        deadlines: {
          where: {
            status: DeadlineStatus.OPEN,
            deletedAt: null
          },
          select: {
            title: true,
            dueAt: true
          },
          orderBy: {
            dueAt: "asc"
          },
          take: 1
        }
      }
    });

    if (!application) {
      return browserExtensionJson({ ok: true, saved: false });
    }

    return browserExtensionJson({
      ok: true,
      saved: true,
      applicationId: application.id,
      applicationUrl: new URL(`/applications/${application.id}`, request.url).toString(),
      companyName: application.company.name,
      position: application.position,
      applicationStatus: application.status,
      nextDeadline: application.deadlines[0]
        ? {
            title: application.deadlines[0].title,
            dueAt: application.deadlines[0].dueAt.toISOString()
          }
        : null
    });
  } catch (error) {
    if (error instanceof BrowserExtensionRequestError) {
      return browserExtensionJson(
        { ok: false, code: "INVALID_REQUEST", message: error.message },
        { status: error.status }
      );
    }

    return browserExtensionJson(
      { ok: false, code: "SERVER_ERROR", message: "保存済み情報を確認できませんでした" },
      { status: 500 }
    );
  }
}
