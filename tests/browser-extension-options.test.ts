/** @vitest-environment jsdom */

import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("browser extension connection settings", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "chrome");
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("rejects HTTP before requesting permission and saves an HTTPS origin", async () => {
    document.body.innerHTML = `
      <form id="settings-form">
        <input id="api-base-url" />
        <input id="api-token" />
        <select id="default-application-type"><option value="CAREER_CHANGE">転職</option></select>
        <input id="adapter-green" type="checkbox" />
        <input id="adapter-doda" type="checkbox" />
        <button type="submit">保存</button>
      </form>
      <button id="reset-settings" type="button">削除</button>
      <div id="status" hidden></div>
    `;

    const requestPermission = vi.fn(async () => true);
    const save = vi.fn(async () => undefined);
    const target = globalThis as typeof globalThis & { chrome?: typeof chrome };
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
          get: vi.fn(async () => ({
            settings: {
              apiBaseUrl: "http://legacy.invalid",
              apiToken: "",
              defaultApplicationType: "CAREER_CHANGE",
              adapters: { GREEN: false, DODA: false }
            }
          })),
          set: save,
          remove: vi.fn(async () => undefined),
          setAccessLevel: vi.fn(async () => undefined)
        },
        onChanged: { addListener: vi.fn() }
      },
      permissions: {
        contains: vi.fn(async () => false),
        request: requestPermission,
        remove: vi.fn(async () => true)
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

    // @ts-expect-error Extension pages intentionally compile as classic scripts, not ES modules.
    await import("../browser-extension/src/options");

    const form = document.querySelector<HTMLFormElement>("#settings-form");
    const apiBaseUrl = document.querySelector<HTMLInputElement>("#api-base-url");
    const status = document.querySelector<HTMLElement>("#status");
    expect(form).not.toBeNull();
    expect(apiBaseUrl).not.toBeNull();
    expect(status).not.toBeNull();

    await waitFor(() => expect(apiBaseUrl?.value).toBe(""));
    if (!form || !apiBaseUrl || !status) throw new Error("設定フォームを初期化できませんでした");

    fireEvent.input(apiBaseUrl, { target: { value: "http://applyflow.example.com" } });
    fireEvent.submit(form);

    expect(status.textContent).toBe("ApplyFlow URLにはHTTPS URLを指定してください。");
    expect(requestPermission).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();

    fireEvent.input(apiBaseUrl, { target: { value: "https://applyflow.example.com/path" } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(requestPermission).toHaveBeenCalledWith({
        origins: ["https://applyflow.example.com/*"]
      });
      expect(save).toHaveBeenCalledWith({
        settings: {
          apiBaseUrl: "https://applyflow.example.com",
          apiToken: "",
          defaultApplicationType: "CAREER_CHANGE",
          adapters: { GREEN: false, DODA: false }
        }
      });
    });
  });
});
