"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  runEmailMonitorNowAction,
  saveEmailMonitorSettingsAction
} from "@/features/email-monitor/ui-actions";

export type EmailMonitorSettingsSummary = {
  enabled: boolean;
  gmailQuery: string;
  consentedAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorMessage: string | null;
  counts: {
    pending: number;
    processing: number;
    autoApplied: number;
    reviewRequired: number;
    ignored: number;
    retryWait: number;
    failed: number;
  };
};

export function EmailMonitorSettings({
  connected,
  initial
}: {
  connected: boolean;
  initial: EmailMonitorSettingsSummary;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [gmailQuery, setGmailQuery] = useState(initial.gmailQuery);
  const [consent, setConsent] = useState(Boolean(initial.consentedAt));
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await saveEmailMonitorSettingsAction({
        enabled,
        gmailQuery,
        consentToAiProcessing: consent
      });
      setMessage(result.message);
    });
  };

  const runNow = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await runEmailMonitorNowAction();
      setMessage(result.message);
    });
  };

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
        <p className="font-semibold">15分間隔のベストエフォート監視</p>
        <p className="mt-1">
          有効化した時刻より後の検索一致メールを処理します。無料枠や一時障害で処理できない場合は課金せず、次回以降へ繰り越します。
        </p>
      </div>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-slate-300"
          checked={enabled}
          disabled={!connected || isPending}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>
          <span className="block text-sm font-semibold text-slate-900">Gmail監視を有効にする</span>
          <span className="block text-xs text-slate-500">
            Gmail readonly権限だけを使用し、Gmail上のメールは変更しません。
          </span>
        </span>
      </label>

      <label className="block space-y-2">
        <span className="text-sm font-semibold text-slate-900">Gmail検索条件</span>
        <Input
          value={gmailQuery}
          disabled={!connected || isPending}
          maxLength={1_000}
          onChange={(event) => setGmailQuery(event.target.value)}
        />
      </label>

      <label className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-slate-300"
          checked={consent}
          disabled={!connected || isPending}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <span className="text-sm text-amber-950">
          一致したメール本文をGroq上のgpt-ossへ送信し、総合・変更対象項目の信頼度が90%以上かつ一意な既存応募だけを自動更新することに同意します。本文はApplyFlowのDBやログへ保存しません。
        </span>
      </label>

      {message ? (
        <p role="status" className="text-sm text-slate-700">
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={!connected || !initial.enabled || isPending}
          onClick={runNow}
        >
          {isPending ? "処理中" : "今すぐ実行"}
        </Button>
        <Button
          type="button"
          disabled={!connected || isPending || (enabled && !consent)}
          onClick={save}
        >
          {isPending ? "保存中" : "監視設定を保存"}
        </Button>
      </div>

      <div className="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2">
        <StatusRow label="最終実行" value={formatTimestamp(initial.lastRunAt)} />
        <StatusRow label="最終成功" value={formatTimestamp(initial.lastSuccessAt)} />
      </div>

      {initial.lastErrorMessage ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          最新エラー: {initial.lastErrorMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <CountBadge label="処理待ち" count={initial.counts.pending} />
        <CountBadge label="処理中" count={initial.counts.processing} />
        <CountBadge label="自動反映" count={initial.counts.autoApplied} variant="success" />
        <CountBadge
          label="確認待ち"
          count={initial.counts.reviewRequired}
          variant="warning"
        />
        <CountBadge label="対象外" count={initial.counts.ignored} variant="muted" />
        <CountBadge label="再試行" count={initial.counts.retryWait} variant="warning" />
        <CountBadge label="失敗" count={initial.counts.failed} variant="danger" />
      </div>
    </div>
  );
}

function CountBadge({
  label,
  count,
  variant = "default"
}: {
  label: string;
  count: number;
  variant?: "default" | "muted" | "success" | "warning" | "danger";
}) {
  return <Badge variant={variant}>{label} {count}</Badge>;
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function formatTimestamp(value: string | null) {
  if (!value) return "未実行";

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
