(function initializePopup() {
  const settingsKey = "settings";
  const sitePatterns: Record<ApplyFlowSourceSite, string> = {
    GREEN: "https://*.green-japan.com/*",
    DODA: "https://*.doda.jp/*"
  };
  const status = document.querySelector<HTMLElement>("#page-status");
  const activateButton = document.querySelector<HTMLButtonElement>("#activate-current");
  let currentTab: ApplyFlowChromeTab | undefined;
  let currentSite: ApplyFlowSourceSite | null = null;

  void inspectCurrentPage();

  document.querySelector<HTMLButtonElement>("#open-options")?.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });

  activateButton?.addEventListener("click", () => void activateCurrentPage());

  async function inspectCurrentPage() {
    [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentSite = getSite(currentTab?.url);

    if (!currentSite || !currentTab?.id) {
      setStatus("このページは対象のGreen・dodaページではありません。", "error");
      return;
    }

    const settings = await getSettings();
    const permitted = await chrome.permissions.contains({ origins: [sitePatterns[currentSite]] });
    const enabled = settings.adapters[currentSite] && permitted;

    setStatus(
      enabled
        ? "この媒体は有効です。ボタンがない場合は、下のボタンで現在ページへ再挿入できます。"
        : "対応媒体のページです。このページへのアクセスを有効にしてください。",
      enabled ? "success" : "error"
    );
    if (activateButton) {
      activateButton.hidden = false;
      activateButton.textContent = enabled ? "現在ページへボタンを再挿入" : "この媒体ページで有効化";
    }
  }

  async function activateCurrentPage() {
    if (!currentSite || !currentTab?.id || !activateButton) return;
    activateButton.disabled = true;
    setStatus("Chromeのアクセス権限を確認しています…", "success");

    try {
      const granted = await chrome.permissions.request({ origins: [sitePatterns[currentSite]] });
      if (!granted) {
        setStatus("サイトへのアクセスが許可されませんでした。", "error");
        return;
      }

      const settings = await getSettings();
      settings.adapters[currentSite] = true;
      await chrome.storage.local.set({ [settingsKey]: settings });
      await chrome.runtime.sendMessage({ type: "SYNC_REGISTRATIONS" });
      await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        files: ["extraction.js", "content.js"],
        world: "ISOLATED"
      });
      setStatus("有効化しました。ページ右下にApplyFlowボタンを表示します。", "success");
      activateButton.textContent = "現在ページへボタンを再挿入";
    } catch {
      setStatus("ボタンを挿入できませんでした。拡張機能を再読み込みしてください。", "error");
    } finally {
      activateButton.disabled = false;
    }
  }

  async function getSettings(): Promise<ApplyFlowExtensionSettings> {
    const stored = await chrome.storage.local.get(settingsKey);
    const value = stored[settingsKey];
    if (!isRecord(value)) {
      return {
        apiBaseUrl: "http://localhost:3000",
        apiToken: "",
        defaultApplicationType: "CAREER_CHANGE",
        adapters: { GREEN: false, DODA: false }
      };
    }
    const adapters = isRecord(value.adapters) ? value.adapters : {};
    return {
      apiBaseUrl: typeof value.apiBaseUrl === "string" ? value.apiBaseUrl : "http://localhost:3000",
      apiToken: typeof value.apiToken === "string" ? value.apiToken : "",
      defaultApplicationType: isApplicationType(value.defaultApplicationType)
        ? value.defaultApplicationType
        : "CAREER_CHANGE",
      adapters: {
        GREEN: adapters.GREEN === true,
        DODA: adapters.DODA === true
      }
    };
  }

  function getSite(value: string | undefined): ApplyFlowSourceSite | null {
    if (!value) return null;
    try {
      const url = new URL(value);
      if (isHost(url.hostname, "green-japan.com")) return "GREEN";
      if (isHost(url.hostname, "doda.jp")) return "DODA";
      return null;
    } catch {
      return null;
    }
  }

  function setStatus(message: string, tone: "success" | "error") {
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function isHost(hostname: string, expected: string) {
    return hostname === expected || hostname.endsWith(`.${expected}`);
  }

  function isApplicationType(value: unknown): value is ApplyFlowExtensionSettings["defaultApplicationType"] {
    return [
      "JOB_HUNTING",
      "CAREER_CHANGE",
      "INTERNSHIP",
      "FREELANCE",
      "PART_TIME",
      "GRADUATE_SCHOOL",
      "OTHER"
    ].includes(String(value));
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
})();
