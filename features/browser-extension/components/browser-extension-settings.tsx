"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  createBrowserExtensionToken,
  revokeBrowserExtensionToken
} from "@/features/browser-extension/actions";

type TokenSummary = {
  id: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export function BrowserExtensionSettings({ tokens }: { tokens: TokenSummary[] }) {
  const [isPending, startTransition] = useTransition();
  const [newToken, setNewToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const issueToken = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await createBrowserExtensionToken();
      setNewToken(result.token);
      setMessage("トークンを発行しました。拡張機能の設定へ貼り付けてください。");
    });
  };

  const revokeToken = (tokenId: string) => {
    setMessage(null);
    startTransition(async () => {
      await revokeBrowserExtensionToken(tokenId);
      setMessage("トークンを失効しました。");
    });
  };

  const copyToken = async () => {
    if (!newToken) {
      return;
    }

    await navigator.clipboard.writeText(newToken);
    setMessage("トークンをコピーしました。");
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
        <p className="font-semibold">Chrome拡張機能との接続</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>下のボタンで専用トークンを発行します。</li>
          <li>拡張機能の設定でApplyFlow URLとトークンを保存します。</li>
          <li>Greenまたはdodaへのアクセス権限を個別に有効化します。</li>
        </ol>
        <p className="mt-2 text-xs text-blue-800">
          トークンは発行直後に一度だけ表示します。紛失時は失効して再発行してください。
        </p>
      </div>

      {newToken ? (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-950">新しいトークン（再表示できません）</p>
          <code className="block break-all rounded bg-white p-3 text-xs text-slate-900">
            {newToken}
          </code>
          <Button type="button" size="sm" variant="secondary" onClick={copyToken}>
            コピー
          </Button>
        </div>
      ) : null}

      {message ? (
        <p role="status" className="text-sm text-slate-700">
          {message}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="button" onClick={issueToken} disabled={isPending}>
          {isPending ? "処理中" : "拡張機能トークンを発行"}
        </Button>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-slate-900">有効なトークン</p>
        {tokens.length === 0 ? (
          <p className="text-sm text-slate-500">有効なトークンはありません。</p>
        ) : (
          tokens.map((token) => (
            <div
              key={token.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 p-3"
            >
              <div>
                <p className="font-mono text-sm font-semibold text-slate-900">
                  {token.tokenPrefix}
                </p>
                <p className="text-xs text-slate-500">
                  発行 {formatTimestamp(token.createdAt)} / 最終利用 {formatTimestamp(token.lastUsedAt)}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={isPending}
                onClick={() => revokeToken(token.id)}
              >
                失効
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "未使用";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
