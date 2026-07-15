import { InterviewStatus } from "@prisma/client";
import {
  BrowserExtensionRequestError,
  browserExtensionJson,
  browserExtensionOptionsResponse,
  readBrowserExtensionJson
} from "@/features/browser-extension/api";
import { authenticateBrowserExtensionRequest } from "@/features/browser-extension/auth";
import { resolveBrowserMessageApplicationMatch } from "@/features/browser-extension/application-matching";
import {
  browserMessageExtractionRequestSchema,
  buildBrowserMessageDigest,
  validateSourceHost
} from "@/features/browser-extension/contracts";
import { extractBrowserMessageWithOpenAI } from "@/features/browser-extension/message-extraction";
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

    const parsed = browserMessageExtractionRequestSchema.safeParse(
      await readBrowserExtensionJson(request)
    );
    if (!parsed.success || !validateSourceHost(parsed.data.sourceSite, parsed.data.sourceUrl)) {
      return browserExtensionJson(
        { ok: false, code: "INVALID_INPUT", message: "選択したメッセージを確認してください" },
        { status: 400 }
      );
    }

    const extraction = await extractBrowserMessageWithOpenAI(
      parsed.data,
      authentication.user.timezone ?? "Asia/Tokyo"
    );
    if (!extraction.ok) {
      return browserExtensionJson(
        { ok: false, code: "EXTRACTION_FAILED", message: extraction.message },
        { status: 422 }
      );
    }

    const applications = await prisma.application.findMany({
      where: { userId: authentication.user.id, deletedAt: null },
      select: {
        id: true,
        position: true,
        status: true,
        sourceSite: true,
        updatedAt: true,
        company: { select: { id: true, name: true } },
        stages: {
          where: { deletedAt: null },
          select: {
            id: true,
            type: true,
            name: true,
            interviews: {
              where: { deletedAt: null },
              select: {
                id: true,
                title: true,
                status: true,
                confirmedStartAt: true,
                confirmedEndAt: true
              },
              orderBy: { updatedAt: "desc" },
              take: 20
            }
          },
          orderBy: { order: "asc" }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: 100
    });

    const matchResolution = resolveBrowserMessageApplicationMatch(
      applications.map((application) => ({
        id: application.id,
        companyId: application.company.id,
        companyName: application.company.name,
        position: application.position,
        sourceSite: application.sourceSite
      })),
      extraction.data,
      parsed.data.sourceSite
    );
    const applicationById = new Map(applications.map((application) => [application.id, application]));
    const ranked = matchResolution.applications.map((match) => ({
      application: applicationById.get(match.id)!,
      score: match.matchScore,
      matchKind: match.matchKind
    }));
    const recommendedApplication = matchResolution.recommendedApplicationId
      ? applicationById.get(matchResolution.recommendedApplicationId)
      : undefined;
    const recommendedInterview = recommendedApplication
      ? findRecommendedInterview(recommendedApplication, extraction.data.stageType)
      : undefined;

    return browserExtensionJson({
      ok: true,
      messageDigest: buildBrowserMessageDigest(parsed.data.sourceSite, parsed.data.selectedText),
      extraction: extraction.data,
      extractionMetadata: extraction.metadata,
      recommendedApplicationId: recommendedApplication?.id ?? null,
      recommendedInterviewId:
        extraction.data.eventType === "CREATE_OR_UPDATE" ? null : recommendedInterview?.id ?? null,
      possibleApplicationIds: matchResolution.possibleApplicationIds,
      exactCompanyId: matchResolution.exactCompanyId,
      companySuggestions: matchResolution.companySuggestions,
      matchResolution: matchResolution.resolution,
      applications: ranked.map(({ application, score, matchKind }) => ({
        id: application.id,
        companyId: application.company.id,
        companyName: application.company.name,
        position: application.position,
        status: application.status,
        sourceSite: application.sourceSite,
        matchScore: score,
        matchKind,
        interviews: application.stages.flatMap((stage) =>
          stage.interviews.map((interview) => ({
            id: interview.id,
            stageId: stage.id,
            stageType: stage.type,
            stageName: stage.name,
            title: interview.title,
            status: interview.status,
            confirmedStartAt: interview.confirmedStartAt?.toISOString() ?? null,
            confirmedEndAt: interview.confirmedEndAt?.toISOString() ?? null
          }))
        )
      }))
    });
  } catch (error) {
    if (error instanceof BrowserExtensionRequestError) {
      return browserExtensionJson(
        { ok: false, code: "INVALID_REQUEST", message: error.message },
        { status: error.status }
      );
    }

    return browserExtensionJson(
      { ok: false, code: "SERVER_ERROR", message: "メッセージから日時を抽出できませんでした" },
      { status: 500 }
    );
  }
}

type ApplicationCandidate = {
  stages: Array<{
    type: string;
    interviews: Array<{
      id: string;
      status: InterviewStatus;
      confirmedStartAt: Date | null;
    }>;
  }>;
};

function findRecommendedInterview(application: ApplicationCandidate, stageType: string | null) {
  const activeStatuses = new Set<InterviewStatus>([
    InterviewStatus.CONFIRMED,
    InterviewStatus.WAITING_REPLY,
    InterviewStatus.PROPOSED,
    InterviewStatus.DRAFT
  ]);
  const interviews = application.stages.flatMap((stage) =>
    stage.interviews
      .filter((interview) => activeStatuses.has(interview.status))
      .map((interview) => ({ ...interview, stageMatches: stage.type === stageType }))
  );

  return interviews.sort((a, b) => {
    if (a.stageMatches !== b.stageMatches) return a.stageMatches ? -1 : 1;
    return (b.confirmedStartAt?.getTime() ?? 0) - (a.confirmedStartAt?.getTime() ?? 0);
  })[0];
}
