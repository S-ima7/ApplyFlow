"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  runEmailMonitorForUser,
  saveEmailMonitorConfig
} from "@/features/email-monitor/config";
import { requireUser } from "@/lib/auth-guard";
import { getGmailConnectionStatus } from "@/lib/gmail";

const emailMonitorSettingsSchema = z.object({
  enabled: z.boolean(),
  gmailQuery: z.string().trim().max(500),
  consentToAiProcessing: z.boolean()
});

export async function saveEmailMonitorSettingsAction(input: {
  enabled: boolean;
  gmailQuery: string;
  consentToAiProcessing: boolean;
}) {
  const user = await requireUser();
  const parsed = emailMonitorSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      message: parsed.error.issues[0]?.message ?? "監視設定を確認してください"
    };
  }

  if (parsed.data.enabled) {
    const gmail = await getGmailConnectionStatus(user.id);
    if (gmail.status !== "connected") {
      return {
        ok: false as const,
        message: gmail.message ?? "Gmail readonly権限で再ログインしてください"
      };
    }
  }

  try {
    await saveEmailMonitorConfig(user.id, {
      enabled: parsed.data.enabled,
      query: parsed.data.gmailQuery,
      consentToAiProcessing: parsed.data.consentToAiProcessing
    });
    revalidateEmailMonitorPages();
    return {
      ok: true as const,
      message: parsed.data.enabled
        ? "メール監視を有効にしました。過去のメールは自動処理しません。"
        : "メール監視を無効にしました。"
    };
  } catch (error) {
    return {
      ok: false as const,
      message: getSafeActionMessage(error, "監視設定を保存できませんでした")
    };
  }
}

export async function runEmailMonitorNowAction() {
  const user = await requireUser();
  const origin = getInternalSiteOrigin();
  if (!origin) {
    return {
      ok: false as const,
      message: "Background Functionの送信先URLが設定されていません"
    };
  }

  try {
    await runEmailMonitorForUser(user.id, origin);
    revalidateEmailMonitorPages();
    return {
      ok: true as const,
      message: "バックグラウンド処理を受け付けました。結果はメール取り込み画面で確認できます。"
    };
  } catch (error) {
    return {
      ok: false as const,
      message: getSafeActionMessage(error, "メール監視を開始できませんでした")
    };
  }
}

function getInternalSiteOrigin() {
  const candidate =
    process.env.DEPLOY_PRIME_URL ??
    process.env.URL ??
    process.env.AUTH_URL ??
    process.env.NEXTAUTH_URL;
  if (!candidate) return null;

  try {
    return new URL(candidate).origin;
  } catch {
    return null;
  }
}

function getSafeActionMessage(error: unknown, fallback: string) {
  if (
    error instanceof Error &&
    [
      "AI処理への同意が必要です",
      "メール監視が有効ではありません",
      "Gmail検索条件は500文字以内で入力してください"
    ].includes(error.message)
  ) {
    return error.message;
  }
  return fallback;
}

function revalidateEmailMonitorPages() {
  revalidatePath("/settings");
  revalidatePath("/email-import");
}
