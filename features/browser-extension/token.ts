import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "af_ext_";

export function createBrowserExtensionTokenValue() {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashBrowserExtensionToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function getBrowserExtensionTokenPrefix(value: string) {
  return `${value.slice(0, TOKEN_PREFIX.length + 6)}…`;
}

export function isBrowserExtensionToken(value: string) {
  return value.startsWith(TOKEN_PREFIX) && value.length >= TOKEN_PREFIX.length + 32;
}
