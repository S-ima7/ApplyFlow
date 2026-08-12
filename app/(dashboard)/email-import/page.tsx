import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { signIn } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmailMessageList } from "@/features/email-import/components/email-message-list";
import { EmailMonitorJobList } from "@/features/email-monitor/components/email-monitor-job-list";
import { getEmailMonitorOverview } from "@/features/email-monitor/config";
import { getRecentEmailAutomationJobs } from "@/features/email-monitor/queries";
import {
  buildEmailImportSearchHref,
  decodeGmailPageTokens
} from "@/features/email-import/pagination";
import {
  GMAIL_SEARCH_PAGE_SIZE,
  getGmailConnectionStatus,
  searchGmailMessages
} from "@/lib/gmail";
import { requireUser } from "@/lib/auth-guard";

export default async function EmailImportPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const pageTokens = decodeGmailPageTokens(params.cursor);
  const pageToken = pageTokens.at(-1);
  const [gmail, emailMonitor, recentJobs] = await Promise.all([
    getGmailConnectionStatus(user.id),
    getEmailMonitorOverview(user.id),
    getRecentEmailAutomationJobs(user.id)
  ]);
  const searchResult =
    query && gmail.status === "connected"
      ? await searchGmailMessages(user.id, query, {
          maxResults: GMAIL_SEARCH_PAGE_SIZE,
          pageToken
        })
      : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-950">Gmail取り込み</h2>
          <p className="text-sm text-slate-500">
            選考メールを検索し、確信度の高い内容は自動反映、例外だけ確認します。
          </p>
        </div>
        <Badge variant={gmail.status === "connected" ? "success" : "warning"}>
          {getGmailStatusLabel(gmail.status)}
        </Badge>
      </div>

      {gmail.status !== "connected" ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold text-amber-950">Gmail連携が必要です</p>
              <p className="text-sm text-amber-800">
                {gmail.message ?? "Gmail readonly権限を許可して再ログインしてください。"}
              </p>
            </div>
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/email-import" });
              }}
            >
              <Button type="submit" size="sm">
                再ログイン
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>定期監視</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={emailMonitor.config?.enabled ? "success" : "muted"}>
                {emailMonitor.config?.enabled ? "監視中" : "停止中"}
              </Badge>
              <Link
                href="/settings"
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                監視設定
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <EmailMonitorJobList
            jobs={recentJobs.map((job) => ({
              id: job.id,
              status: job.status,
              errorMessage: job.errorMessage,
              processedAt: job.processedAt?.toISOString() ?? null,
              createdAt: job.createdAt.toISOString(),
              extractionResultId: job.extractionResultId,
              subject: job.emailImport.subject,
              fromAddress: job.emailImport.fromAddress,
              sentAt: job.emailImport.sentAt?.toISOString() ?? null,
              matchedApplication: job.matchedApplication
                ? {
                    id: job.matchedApplication.id,
                    companyName: job.matchedApplication.company.name,
                    position: job.matchedApplication.position
                  }
                : null
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>メール検索</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3 md:flex-row" action="/email-import">
            <Input
              name="q"
              defaultValue={query}
              placeholder="面接 日程調整 OR 選考"
              disabled={gmail.status !== "connected"}
            />
            <Button type="submit" disabled={gmail.status !== "connected"}>
              検索
            </Button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
            <span>例:</span>
            <span>面接</span>
            <span>日程調整</span>
            <span>候補日</span>
            <span>承諾期限</span>
            <span>from:recruit</span>
          </div>
        </CardContent>
      </Card>

      {searchResult ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>検索結果</CardTitle>
              {searchResult.status === "connected" ? (
                <span className="text-xs text-slate-500">
                  {pageTokens.length + 1}ページ目・{searchResult.messages.length}件表示
                  {typeof searchResult.resultSizeEstimate === "number"
                    ? `（推定${searchResult.resultSizeEstimate}件）`
                    : ""}
                </span>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {searchResult.status === "connected" ? (
              <div className="space-y-4">
                <EmailMessageList
                  messages={searchResult.messages}
                  timezone={user.timezone ?? "Asia/Tokyo"}
                />
                {pageTokens.length > 0 || searchResult.nextPageToken ? (
                  <div className="flex items-center justify-between border-t border-slate-200 pt-4">
                    {pageTokens.length > 0 ? (
                      <Link
                        href={buildEmailImportSearchHref(query, pageTokens.slice(0, -1))}
                        className={buttonVariants({ variant: "secondary", size: "sm" })}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        前のページ
                      </Link>
                    ) : (
                      <span />
                    )}
                    {searchResult.nextPageToken ? (
                      <Link
                        href={buildEmailImportSearchHref(query, [
                          ...pageTokens,
                          searchResult.nextPageToken
                        ])}
                        className={buttonVariants({ variant: "secondary", size: "sm" })}
                      >
                        次のページ
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-red-600">
                {searchResult.message ?? "Gmail検索に失敗しました"}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function getGmailStatusLabel(status: string) {
  switch (status) {
    case "connected":
      return "連携済み";
    case "missing_scope":
      return "権限不足";
    case "missing_token":
      return "再認証が必要";
    case "not_connected":
      return "未連携";
    default:
      return "取得エラー";
  }
}
