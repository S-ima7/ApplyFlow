import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmailImportConfirmForm } from "@/features/email-import/components/email-import-confirm-form";
import { getEmailImportConfirmDefaults } from "@/features/email-import/defaults";
import { normalizeEmailExtraction } from "@/features/email-import/extraction";
import { getEmailExtractionForConfirmation } from "@/features/email-import/queries";
import { requireUser } from "@/lib/auth-guard";
import { formatDateTime } from "@/lib/date";

export default async function EmailImportConfirmPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const extraction = await getEmailExtractionForConfirmation(user.id, id);

  if (!extraction) {
    notFound();
  }

  const normalized = normalizeEmailExtraction(extraction.extractedJson);
  const automationReview =
    extraction.automationJob?.status === "REVIEW_REQUIRED" && normalized.ok
      ? extraction.automationJob
      : null;
  const matchedApplication = automationReview?.matchedApplication ?? null;
  const canUseCreateForm =
    !automationReview ||
    (normalized.ok &&
      normalized.data.eventType === "CREATE_OR_UPDATE" &&
      !matchedApplication);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-950">抽出結果確認</h2>
          <p className="text-sm text-slate-500">
            内容を確認・修正してから ApplyFlow に登録します。
          </p>
        </div>
        {normalized.ok ? (
          <Badge variant={normalized.data.confidence >= 0.75 ? "success" : "warning"}>
            confidence {Math.round(normalized.data.confidence * 100)}%
          </Badge>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>取り込み元メール</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <Meta label="件名" value={extraction.emailImport.subject ?? "-"} />
          <Meta label="送信者" value={extraction.emailImport.fromAddress ?? "-"} />
          <Meta label="日時" value={formatDateTime(extraction.emailImport.sentAt)} />
          <Meta label="Gmail Message ID" value={extraction.emailImport.gmailMessageId} />
        </CardContent>
      </Card>

      {extraction.confirmedAt && extraction.createdApplication ? (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold text-green-950">登録済みです</p>
              <p className="text-sm text-green-800">
                {extraction.createdApplication.company.name} /{" "}
                {extraction.createdApplication.position}
              </p>
            </div>
            <Link
              href={`/applications/${extraction.createdApplication.id}`}
              className="rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800"
            >
              応募詳細へ
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {automationReview ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold text-amber-950">自動反映せず確認待ちにしました</p>
              <p className="text-sm text-amber-800">
                {getAutomationReviewMessage(automationReview.errorCode)}
              </p>
              {matchedApplication ? (
                <p className="mt-1 text-sm text-amber-900">
                  候補: {matchedApplication.company.name} / {matchedApplication.position}
                </p>
              ) : null}
            </div>
            <Link
              href={
                matchedApplication
                  ? `/applications/${matchedApplication.id}`
                  : "/applications"
              }
              className="rounded-md border border-amber-300 bg-white px-4 py-2 text-center text-sm font-semibold text-amber-950 hover:bg-amber-100"
            >
              {matchedApplication ? "応募詳細で確認" : "応募先一覧で確認"}
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{canUseCreateForm ? "登録内容" : "確認方法"}</CardTitle>
        </CardHeader>
        <CardContent>
          {normalized.ok && canUseCreateForm ? (
            <EmailImportConfirmForm
              extractionResultId={extraction.id}
              defaultValues={getEmailImportConfirmDefaults(normalized.data)}
              fieldConfidence={normalized.data.fieldConfidence}
              evidence={normalized.data.evidence}
            />
          ) : normalized.ok ? (
            <p className="text-sm text-slate-700">
              日程変更・取消、または既存応募と紐付いた確認待ちは、誤った新規応募を作らないようこの画面から登録しません。上のリンクから対象応募と面接を確認して手動で更新してください。
            </p>
          ) : (
            <p className="text-sm text-red-600">{normalized.message}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function getAutomationReviewMessage(code: string | null) {
  switch (code) {
    case "CANCEL_REQUIRES_CONFIRMATION":
      return "取消は自動適用しません。対象面接を確認してください。";
    case "APPLICATION_NOT_UNIQUE":
      return "応募先を一意に特定できませんでした。既存応募との重複を確認してください。";
    case "LOW_CONFIDENCE":
      return "変更対象に90%未満の抽出項目があります。";
    case "INTERVIEW_NOT_UNIQUE":
      return "日程変更の対象面接を一意に特定できませんでした。";
    case "MANUAL_DATA_CONFLICT":
      return "手入力済みの面接情報と競合するため、自動上書きしませんでした。";
    case "DEADLINE_CONFLICT":
      return "既存の期限と競合するため、自動上書きしませんでした。";
    case "STAGE_NOT_UNIQUE":
    case "MISSING_STAGE":
      return "対象の選考フェーズを安全に特定できませんでした。";
    default:
      return "安全条件を満たさなかったため、内容を確認してください。";
  }
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 break-words font-semibold text-slate-950">{value}</p>
    </div>
  );
}
