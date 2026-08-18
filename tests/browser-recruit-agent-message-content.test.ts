// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://mypage.r-agent.com/applied/interviews"}

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("Recruit Agent message page startup", () => {
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
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn(async () => ({ ok: true })),
        openOptionsPage: vi.fn(async () => undefined)
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
          setAccessLevel: vi.fn(async () => undefined)
        },
        onChanged: { addListener: vi.fn() }
      },
      permissions: {
        contains: vi.fn(async () => false),
        request: vi.fn(async () => false),
        remove: vi.fn(async () => false)
      },
      scripting: {
        getRegisteredContentScripts: vi.fn(async () => []),
        registerContentScripts: vi.fn(async () => undefined),
        unregisterContentScripts: vi.fn(async () => undefined),
        executeScript: vi.fn(async () => [])
      },
      tabs: {
        create: vi.fn(async () => undefined),
        query: vi.fn(async () => [])
      }
    };

    // @ts-expect-error Content scripts intentionally compile as classic scripts, not ES modules.
    await import("../browser-extension/src/content");
  });

  afterAll(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("mounts message mode on Personal Desktop", () => {
    const root = document.getElementById("applyflow-browser-extension-root");
    expect(root?.dataset.site).toBe("RECRUIT_AGENT");
    expect(root?.dataset.mode).toBe("message");
  });

  it("keeps the same message panel interactive inside a Recruit Agent modal", async () => {
    const root = document.getElementById("applyflow-browser-extension-root");
    const shadow = root?.shadowRoot;
    const trigger = shadow?.querySelector<HTMLButtonElement>(".af-floating-button");
    const overlay = shadow?.querySelector<HTMLElement>(".af-overlay");
    const textarea = shadow?.querySelector<HTMLTextAreaElement>("#af-selected-message");
    const useSelectionButton = shadow?.querySelector<HTMLButtonElement>("#af-use-selection");
    expect(root && shadow && trigger && overlay && textarea && useSelectionButton).toBeTruthy();

    trigger?.click();
    if (textarea) textarea.value = "入力済みの本文";
    expect(overlay?.hidden).toBe(false);

    const modal = document.createElement("section");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const frame = document.createElement("iframe");
    modal.append(frame);
    document.body.append(modal);
    const frameSelection = vi.spyOn(frame.contentWindow!, "getSelection").mockReturnValue({
      toString: () => "面接候補日は2026年8月24日18時です。確認をお願いします。"
    } as Selection);

    await flushUiPlacement();
    expect(root?.parentElement).toBe(modal);
    expect(overlay?.hidden).toBe(false);
    expect(textarea?.value).toBe("入力済みの本文");

    useSelectionButton?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    useSelectionButton?.click();
    expect(textarea?.value).toBe("面接候補日は2026年8月24日18時です。確認をお願いします。");

    const topSelection = vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "トップ画面で選択した本文"
    } as Selection);
    useSelectionButton?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    useSelectionButton?.click();
    expect(textarea?.value).toBe("トップ画面で選択した本文");
    topSelection.mockRestore();

    frameSelection.mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    if (textarea) textarea.value = "手入力した本文を保持";
    useSelectionButton?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    useSelectionButton?.click();
    expect(textarea?.value).toBe("手入力した本文を保持");

    modal.style.display = "none";
    await flushPeriodicPlacement();
    expect(root?.parentElement).toBe(document.documentElement);
    expect(overlay?.hidden).toBe(false);
    expect(textarea?.value).toBe("手入力した本文を保持");

    modal.remove();
    await flushUiPlacement();
  });

  async function flushUiPlacement() {
    await Promise.resolve();
    vi.advanceTimersByTime(251);
    await Promise.resolve();
  }

  async function flushPeriodicPlacement() {
    vi.advanceTimersByTime(1_001);
    await Promise.resolve();
  }
});
