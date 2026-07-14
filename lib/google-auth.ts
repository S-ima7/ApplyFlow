import type { Account } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export const GOOGLE_BASE_AUTH_SCOPES = ["openid", "email", "profile"];

export const GOOGLE_GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";

export function hasGoogleScope(scope: string | null | undefined, requiredScope: string) {
  return (scope ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .includes(requiredScope);
}

export async function getGoogleAccount(userId: string) {
  return prisma.account.findFirst({
    where: {
      userId,
      provider: "google"
    }
  });
}

export async function getValidGoogleAccessToken(account: Account) {
  if (account.access_token && !isGoogleAccessTokenExpired(account)) {
    return account.access_token;
  }

  if (!account.refresh_token) {
    return account.access_token;
  }

  return refreshGoogleAccessToken(account);
}

export function isGoogleAccessTokenExpired(account: Account) {
  if (!account.expires_at) {
    return false;
  }

  const nowWithBuffer = Math.floor(Date.now() / 1000) + 60;
  return account.expires_at <= nowWithBuffer;
}

async function refreshGoogleAccessToken(account: Account) {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;

  if (!clientId || !clientSecret || !account.refresh_token) {
    return null;
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: account.refresh_token
    })
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as GoogleTokenResponse;

  if (!data.access_token) {
    return null;
  }

  await prisma.account.update({
    where: {
      id: account.id
    },
    data: {
      access_token: data.access_token,
      expires_at: data.expires_in
        ? Math.floor(Date.now() / 1000) + data.expires_in
        : account.expires_at,
      refresh_token: data.refresh_token ?? account.refresh_token,
      scope: data.scope ?? account.scope,
      token_type: data.token_type ?? account.token_type
    }
  });

  return data.access_token;
}
