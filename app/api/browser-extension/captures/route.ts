import { ActivityAction, ApplicationRoute, ApplicationStatus, Prisma, Priority } from "@prisma/client";
import {
  BrowserExtensionRequestError,
  browserExtensionJson,
  browserExtensionOptionsResponse,
  readBrowserExtensionJson
} from "@/features/browser-extension/api";
import { authenticateBrowserExtensionRequest } from "@/features/browser-extension/auth";
import {
  browserExtensionCaptureSchema,
  buildBrowserExtensionSourceKey,
  normalizeCapturedUrl,
  validateCaptureSourceHost,
  type BrowserExtensionCaptureInput
} from "@/features/browser-extension/contracts";
import { prisma } from "@/lib/prisma";

const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9_-]{16,100}$/;

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

    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";

    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      return browserExtensionJson(
        { ok: false, code: "INVALID_IDEMPOTENCY_KEY", message: "保存要求の識別子が不正です" },
        { status: 400 }
      );
    }

    const parsed = browserExtensionCaptureSchema.safeParse(
      await readBrowserExtensionJson(request)
    );

    if (!parsed.success || !validateCaptureSourceHost(parsed.data.sourceSite, parsed.data.sourceUrl)) {
      return browserExtensionJson(
        { ok: false, code: "INVALID_INPUT", message: "入力内容を確認してください" },
        { status: 400 }
      );
    }

    const sourceKey = buildBrowserExtensionSourceKey(parsed.data);
    const normalizedSourceUrl = normalizeCapturedUrl(parsed.data.sourceUrl);
    const existing = await findExistingApplication(
      authentication.user.id,
      sourceKey,
      idempotencyKey,
      normalizedSourceUrl
    );

    if (existing) {
      return existingApplicationResponse(existing.id, request.url);
    }

    try {
      const application = await prisma.$transaction(async (tx) => {
        const company =
          (await tx.company.findFirst({
            where: {
              userId: authentication.user.id,
              name: parsed.data.companyName
            },
            orderBy: {
              createdAt: "asc"
            }
          })) ??
          (await tx.company.create({
            data: {
              userId: authentication.user.id,
              name: parsed.data.companyName
            }
          }));

        const created = await tx.application.create({
          data: buildApplicationData(
            authentication.user.id,
            company.id,
            parsed.data,
            sourceKey,
            idempotencyKey,
            normalizedSourceUrl
          )
        });

        await tx.activityLog.create({
          data: {
            userId: authentication.user.id,
            applicationId: created.id,
            action: ActivityAction.APPLICATION_CREATED,
            message: `${company.name} / ${created.position} をブラウザ拡張機能から登録しました`,
            metadata: {
              sourceSite: parsed.data.sourceSite,
              sourceJobId: parsed.data.sourceJobId,
              adapterVersion: parsed.data.adapterVersion
            }
          }
        });

        return created;
      });

      return browserExtensionJson(
        {
          ok: true,
          result: "created",
          applicationId: application.id,
          applicationUrl: new URL(`/applications/${application.id}`, request.url).toString(),
          applicationStatus: application.status
        },
        { status: 201 }
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const racedApplication = await findExistingApplication(
          authentication.user.id,
          sourceKey,
          idempotencyKey,
          normalizedSourceUrl
        );

        if (racedApplication) {
          return existingApplicationResponse(racedApplication.id, request.url);
        }
      }

      throw error;
    }
  } catch (error) {
    if (error instanceof BrowserExtensionRequestError) {
      return browserExtensionJson(
        { ok: false, code: "INVALID_REQUEST", message: error.message },
        { status: error.status }
      );
    }

    return browserExtensionJson(
      { ok: false, code: "SERVER_ERROR", message: "応募先を保存できませんでした" },
      { status: 500 }
    );
  }
}

function buildApplicationData(
  userId: string,
  companyId: string,
  input: BrowserExtensionCaptureInput,
  sourceKey: string,
  idempotencyKey: string,
  normalizedSourceUrl: string
) {
  return {
    userId,
    companyId,
    position: input.position,
    applicationType: input.applicationType,
    route: ApplicationRoute.JOB_BOARD,
    status: ApplicationStatus.DRAFT,
    priority: Priority.MEDIUM,
    sourceUrl: normalizedSourceUrl,
    note: input.note,
    sourceSite: input.sourceSite,
    sourceJobId: input.sourceJobId,
    sourceKey,
    locationText: input.locationText,
    employmentTypeText: input.employmentTypeText,
    compensationText: input.compensationText,
    capturedAt: new Date(input.capturedAt),
    captureAdapterVersion: input.adapterVersion,
    captureIdempotencyKey: idempotencyKey
  };
}

function findExistingApplication(
  userId: string,
  sourceKey: string,
  idempotencyKey: string,
  normalizedSourceUrl: string
) {
  return prisma.application.findFirst({
    where: {
      userId,
      deletedAt: null,
      OR: [
        { sourceKey },
        { captureIdempotencyKey: idempotencyKey },
        { sourceUrl: normalizedSourceUrl }
      ]
    },
    select: {
      id: true
    }
  });
}

function existingApplicationResponse(applicationId: string, requestUrl: string) {
  return browserExtensionJson({
    ok: true,
    result: "existing",
    applicationId,
    applicationUrl: new URL(`/applications/${applicationId}`, requestUrl).toString()
  });
}
