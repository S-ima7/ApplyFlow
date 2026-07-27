import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export type EmailMonitorJobListItem = {
  id: string;
  status:
    | "PENDING"
    | "PROCESSING"
    | "AUTO_APPLIED"
    | "REVIEW_REQUIRED"
    | "IGNORED"
    | "RETRY_WAIT"
    | "FAILED";
  errorMessage: string | null;
  processedAt: string | null;
  createdAt: string;
  extractionResultId: string | null;
  subject: string | null;
  fromAddress: string | null;
  sentAt: string | null;
  matchedApplication: {
    id: string;
    companyName: string;
    position: string;
  } | null;
};

export function EmailMonitorJobList({
  jobs
}: {
  jobs: EmailMonitorJobListItem[];
}) {
  if (jobs.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        定期監視で処理したメールはまだありません。
      </p>
    );
  }

  return (
    <div className="divide-y divide-slate-200">
      {jobs.map((job) => {
        const presentation = getStatusPresentation(job.status);
        return (
          <article key={job.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-950">
                  {job.subject ?? "件名なし"}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {job.fromAddress ?? "送信者不明"}・{formatTimestamp(job.sentAt)}
                </p>
              </div>
              <Badge variant={presentation.variant}>{presentation.label}</Badge>
            </div>

            {job.matchedApplication ? (
              <Link
                href={`/applications/${job.matchedApplication.id}`}
                className="inline-flex text-sm font-semibold text-blue-700 hover:text-blue-800"
              >
                {job.matchedApplication.companyName} /{" "}
                {job.matchedApplication.position}
              </Link>
            ) : null}

            {job.status === "REVIEW_REQUIRED" && job.extractionResultId ? (
              <div>
                <Link
                  href={`/email-import/${job.extractionResultId}/confirm`}
                  className="inline-flex rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                >
                  抽出内容を確認
                </Link>
              </div>
            ) : null}

            {job.status === "FAILED" && job.errorMessage ? (
              <p className="text-xs text-red-700">{job.errorMessage}</p>
            ) : null}

            <p className="text-xs text-slate-400">
              受付 {formatTimestamp(job.createdAt)}
              {job.processedAt
                ? ` / 処理 ${formatTimestamp(job.processedAt)}`
                : ""}
            </p>
          </article>
        );
      })}
    </div>
  );
}

function getStatusPresentation(status: EmailMonitorJobListItem["status"]): {
  label: string;
  variant: "default" | "muted" | "success" | "warning" | "danger";
} {
  switch (status) {
    case "PENDING":
      return { label: "処理待ち", variant: "default" };
    case "PROCESSING":
      return { label: "処理中", variant: "default" };
    case "AUTO_APPLIED":
      return { label: "自動反映済み", variant: "success" };
    case "REVIEW_REQUIRED":
      return { label: "確認が必要", variant: "warning" };
    case "IGNORED":
      return { label: "対象外", variant: "muted" };
    case "RETRY_WAIT":
      return { label: "再試行待ち", variant: "warning" };
    case "FAILED":
      return { label: "処理失敗", variant: "danger" };
  }
}

function formatTimestamp(value: string | null) {
  if (!value) return "日時不明";

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
