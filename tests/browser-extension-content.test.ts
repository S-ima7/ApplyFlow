// @vitest-environment jsdom

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("browser extension content script startup", () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    const target = globalThis as typeof globalThis & {
      ApplyFlowExtraction?: ApplyFlowExtractionApi;
      chrome?: typeof chrome;
    };
    target.ApplyFlowExtraction = {
      detectPage: () => "GREEN",
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
  });

  it("mounts the UI after style constants have initialized", () => {
    const root = document.getElementById("applyflow-browser-extension-root");
    expect(root).not.toBeNull();
    expect(root?.dataset.site).toBe("GREEN");
  });
});
