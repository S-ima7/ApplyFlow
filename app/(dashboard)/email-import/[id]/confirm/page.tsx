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

      <Card>
        <CardHeader>
          <CardTitle>登録内容</CardTitle>
        </CardHeader>
        <CardContent>
          {normalized.ok ? (
            <EmailImportConfirmForm
              extractionResultId={extraction.id}
              defaultValues={getEmailImportConfirmDefaults(normalized.data)}
            />
          ) : (
            <p className="text-sm text-red-600">{normalized.message}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 break-words font-semibold text-slate-950">{value}</p>
    </div>
  );
}
