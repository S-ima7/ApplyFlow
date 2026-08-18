// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.green-japan.com/messages/123"}

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

describe("browser extension message page startup", () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    const nativeAttachShadow = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (this: Element, init: ShadowRootInit) {
      return nativeAttachShadow.call(this, { ...init, mode: "open" });
    });
    const target = globalThis as typeof globalThis & {
      ApplyFlowExtraction?: ApplyFlowExtractionApi;
      chrome?: typeof chrome;
    };
    target.ApplyFlowExtraction = {
      detectPage: () => null,
      extract: () => null,
      normalizeUrl: (url) => url.toString()
    };
    target.chrome = {
      runtime: {
        onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() }, sendMessage: vi.fn(async () => ({ ok: true })),
        openOptionsPage: vi.fn(async () => undefined)
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})), set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined), setAccessLevel: vi.fn(async () => undefined)
        },
        onChanged: { addListener: vi.fn() }
      },
      permissions: {
        contains: vi.fn(async () => false), request: vi.fn(async () => false), remove: vi.fn(async () => false)
      },
      scripting: {
        getRegisteredContentScripts: vi.fn(async () => []), registerContentScripts: vi.fn(async () => undefined),
        unregisterContentScripts: vi.fn(async () => undefined), executeScript: vi.fn(async () => [])
      },
      tabs: { create: vi.fn(async () => undefined), query: vi.fn(async () => []) }
    };
    // @ts-expect-error Content scripts intentionally compile as classic scripts, not ES modules.
    await import("../browser-extension/src/content");
  });

  afterAll(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("mounts message mode on a supported non-job page", () => {
    const root = document.getElementById("applyflow-browser-extension-root");
    expect(root?.dataset.site).toBe("GREEN");
    expect(root?.dataset.mode).toBe("message");
  });

  it("keeps the underlying message page interactive while the panel is open", () => {
    const source = readFileSync("browser-extension/src/content.ts", "utf8");
    expect(source).toContain('aria-modal="false"');
    expect(source).toContain(".af-overlay{position:fixed;inset:0;z-index:2147483647;pointer-events:none");
    expect(source).toContain(".af-drawer{position:absolute");
    expect(source).toContain("pointer-events:auto");
  });

  it("allows the user to import a selection made after opening the panel", () => {
    const source = readFileSync("browser-extension/src/content.ts", "utf8");
    expect(source).toContain('querySelector<HTMLButtonElement>("#af-use-selection")');
    expect(source).toContain("現在の選択を取り込む");
    expect(source).toContain("window.getSelection()?.toString().trim()");
  });

  it("does not send the page title with the selected message", () => {
    const source = readFileSync("browser-extension/src/content.ts", "utf8");
    expect(source).not.toContain("pageTitle: document.title");
    expect(source).toContain("ページタイトルや未選択本文は送信せず");
  });

  it("offers one-step application creation and explicit variant confirmation", () => {
    const source = readFileSync("browser-extension/src/content.ts", "utf8");
    expect(source).toContain("新しい応募先を作成");
    expect(source).toContain("[表記ゆれ候補]");
    expect(source).toContain("#af-company-resolution");
    expect(source).toContain("既存企業へ統合");
  });

  it("does not require an impossible interview selection", () => {
    const source = readFileSync("browser-extension/src/content.ts", "utf8");
    expect(source).toContain("対象面接なし（新規として登録）");
    expect(source).toContain('eventTypeSelect.value = "CREATE_OR_UPDATE"');
    expect(source).toContain("option.disabled = !canSelectExistingInterview");
    expect(source).toContain("activeInterviews.some");
  });

  it("stays clear of the message composer and resumes without losing the review", () => {
    const source = readFileSync("browser-extension/src/content.ts", "utf8");
    expect(source).toContain('af-floating-button-message');
    expect(source).toContain('.af-floating-button-message{bottom:96px}');
    expect(source).toContain('overlay.dataset.suspended = "true"');
    expect(source).toContain('trigger.textContent = "日時抽出を再開"');
    expect(source).toContain('if (overlay.dataset.suspended === "true")');
    expect(source).toContain('入力内容を保持して一時的に隠す');
    expect(source).toContain('target.id !== "af-close"');
    expect(source).toContain('>一時的に隠す</button>');
  });

  it("restores the same input after temporarily hiding the panel", () => {
    const shadow = document.getElementById("applyflow-browser-extension-root")?.shadowRoot;
    const trigger = shadow?.querySelector<HTMLButtonElement>(".af-floating-button");
    const overlay = shadow?.querySelector<HTMLElement>(".af-overlay");
    const textarea = shadow?.querySelector<HTMLTextAreaElement>("#af-selected-message");
    const minimize = shadow?.querySelector<HTMLButtonElement>("#af-close");
    expect(trigger && overlay && textarea && minimize).toBeTruthy();

    trigger?.click();
    if (textarea) textarea.value = "退避しても保持する面接メッセージ本文";
    minimize?.click();
    expect(overlay?.hidden).toBe(true);
    expect(trigger?.textContent).toBe("日時抽出を再開");

    trigger?.click();
    expect(overlay?.hidden).toBe(false);
    expect(textarea?.value).toBe("退避しても保持する面接メッセージ本文");
  });
});
