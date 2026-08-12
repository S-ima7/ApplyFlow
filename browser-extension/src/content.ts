(function initializeApplyFlowContentScript() {
  const rootId = "applyflow-browser-extension-root";
  const extractionApi = (
    globalThis as typeof globalThis & { ApplyFlowExtraction?: ApplyFlowExtractionApi }
  ).ApplyFlowExtraction;
  if (!extractionApi) return;

  let lastUrl = "";
  let currentCapture: ApplyFlowExtractionResult | null = null;
  let currentMessage: ApplyFlowMessageExtractionResponse | null = null;
  let lastSelectedText = "";
  let previouslyFocused: HTMLElement | null = null;
  let suspendedDrawerFocus: HTMLElement | null = null;
  let navigationTimer: number | undefined;

  function evaluatePage() {
    lastUrl = location.href;
    const url = new URL(location.href);
    const jobSite = extractionApi?.detectPage(document, url);
    const site = jobSite ?? detectSupportedSite(url);
    const mode = jobSite ? "capture" : "message";
    const existing = document.getElementById(rootId);
    if (!site) {
      existing?.remove();
      return;
    }
    if (existing && (existing.dataset.site !== site || existing.dataset.mode !== mode)) {
      existing.remove();
    }
    if (!document.getElementById(rootId)) mountUi(site, mode);
  }

  function mountUi(site: ApplyFlowSourceSite, mode: "capture" | "message") {
    const host = document.createElement("div");
    host.id = rootId;
    host.dataset.site = site;
    host.dataset.mode = mode;
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = uiStyles;
    shadow.append(style);

    const floatingButton = document.createElement("button");
    floatingButton.type = "button";
    floatingButton.className = `af-floating-button${mode === "message" ? " af-floating-button-message" : ""}`;
    floatingButton.textContent = mode === "capture" ? "ApplyFlowに保存" : "面接日時を抽出";
    floatingButton.setAttribute(
      "aria-label",
      mode === "capture" ? "この求人をApplyFlowに保存" : "選択した企業メッセージから面接日時を抽出"
    );
    floatingButton.setAttribute("aria-expanded", "false");
    if (mode === "message") {
      floatingButton.addEventListener("pointerdown", () => {
        lastSelectedText = window.getSelection()?.toString().trim() ?? "";
      });
    }
    shadow.append(floatingButton);

    const overlay = document.createElement("div");
    overlay.className = "af-overlay";
    overlay.hidden = true;
    overlay.innerHTML = mode === "capture" ? captureDrawerMarkup : messageDrawerMarkup;
    shadow.append(overlay);
    wireCommonDrawer(overlay, floatingButton, mode);

    if (mode === "capture") {
      floatingButton.addEventListener("click", () => void openCaptureDrawer(overlay, floatingButton));
      overlay.querySelector<HTMLFormElement>("#af-capture-form")?.addEventListener("submit", (event) => {
        event.preventDefault();
        void saveCapture(overlay, floatingButton);
      });
    } else {
      floatingButton.addEventListener("click", () => openMessageDrawer(overlay, floatingButton, site));
      wireMessageDrawer(overlay, floatingButton, site);
    }
    document.documentElement.append(host);
  }

  function wireCommonDrawer(
    overlay: HTMLElement,
    floatingButton: HTMLButtonElement,
    mode: "capture" | "message"
  ) {
    const dismiss = () => {
      if (mode === "message") {
        suspendMessageDrawer(overlay, floatingButton);
      } else {
        closeDrawer(overlay, floatingButton);
      }
    };
    overlay.querySelector<HTMLButtonElement>("#af-close")?.addEventListener("click", dismiss);
    overlay.querySelectorAll<HTMLButtonElement>(".af-close-drawer").forEach((button) => {
      button.addEventListener("click", dismiss);
    });
    if (mode === "message") {
      overlay.addEventListener("focusin", (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.id !== "af-close") {
          suspendedDrawerFocus = target;
        }
      });
    }
    overlay.querySelector<HTMLButtonElement>("#af-options")?.addEventListener("click", () => {
      void chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
    });
    overlay.querySelector<HTMLButtonElement>("#af-open-application")?.addEventListener("click", () => {
      const url = overlay.querySelector<HTMLButtonElement>("#af-open-application")?.dataset.applicationUrl;
      if (url) void chrome.runtime.sendMessage({ type: "OPEN_APPLICATION", applicationUrl: url });
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      }
    });
  }

  async function openCaptureDrawer(overlay: HTMLElement, trigger: HTMLButtonElement) {
    previouslyFocused = trigger;
    trigger.setAttribute("aria-expanded", "true");
    currentCapture = extractionApi?.extract(document, new URL(location.href)) ?? null;
    if (!currentCapture) return;
    setInputValue(overlay, "#af-company-name", currentCapture.companyName.value);
    setInputValue(overlay, "#af-position", currentCapture.position.value);
    setInputValue(overlay, "#af-location", currentCapture.locationText.value);
    setInputValue(overlay, "#af-employment", currentCapture.employmentTypeText.value);
    setInputValue(overlay, "#af-compensation", currentCapture.compensationText.value);
    setInputValue(overlay, "#af-note", "");
    setText(overlay, "#af-source", `${sourceLabel(currentCapture.sourceSite)} / ${currentCapture.sourceUrl}`);
    setText(
      overlay,
      "#af-warnings",
      currentCapture.warnings.length ? currentCapture.warnings.join("。") : "抽出結果を確認してから保存してください。"
    );
    setExistingState(overlay, null);
    setMessage(overlay, "保存済みか確認しています…", "info");
    overlay.hidden = false;
    overlay.querySelector<HTMLInputElement>("#af-company-name")?.focus();

    void chrome.runtime.sendMessage({ type: "GET_SETTINGS" }).then((response) => {
      if (isRecord(response) && isRecord(response.settings) && typeof response.settings.defaultApplicationType === "string") {
        setInputValue(overlay, "#af-application-type", response.settings.defaultApplicationType);
      }
    });
    try {
      const response = await chrome.runtime.sendMessage({
        type: "LOOKUP_CAPTURE",
        payload: {
          sourceSite: currentCapture.sourceSite,
          sourceJobId: currentCapture.sourceJobId,
          sourceUrl: currentCapture.sourceUrl
        }
      });
      if (!isRecord(response) || response.ok !== true) {
        setApiError(overlay, response, "ApplyFlowへ接続できません。");
      } else if (response.saved === true && typeof response.applicationUrl === "string") {
        setExistingState(overlay, response);
        setMessage(overlay, "この求人は保存済みです。", "success");
      } else {
        setMessage(overlay, "未保存の求人です。内容を確認してください。", "info");
      }
    } catch {
      setMessage(overlay, "ApplyFlowへ接続できません。拡張機能の設定を確認してください。", "error");
    }
  }

  async function saveCapture(overlay: HTMLElement, floatingButton: HTMLButtonElement) {
    if (!currentCapture) return;
    const companyName = getInputValue(overlay, "#af-company-name");
    const position = getInputValue(overlay, "#af-position");
    if (!companyName || !position) {
      setMessage(overlay, "会社名とポジションを入力してください。", "error");
      return;
    }
    const button = overlay.querySelector<HTMLButtonElement>("#af-save");
    setButtonBusy(button, true, "保存中…");
    setMessage(overlay, "ApplyFlowへ保存しています…", "info");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "SAVE_CAPTURE",
        idempotencyKey: createIdempotencyKey(),
        payload: {
          sourceSite: currentCapture.sourceSite,
          sourceUrl: currentCapture.sourceUrl,
          sourceJobId: currentCapture.sourceJobId,
          companyName,
          position,
          applicationType: getInputValue(overlay, "#af-application-type") || "CAREER_CHANGE",
          locationText: getInputValue(overlay, "#af-location") || undefined,
          employmentTypeText: getInputValue(overlay, "#af-employment") || undefined,
          compensationText: getInputValue(overlay, "#af-compensation") || undefined,
          note: getInputValue(overlay, "#af-note") || undefined,
          capturedAt: currentCapture.capturedAt,
          adapterVersion: currentCapture.adapterVersion
        }
      });
      if (!isRecord(response) || response.ok !== true) {
        setApiError(overlay, response, "保存できませんでした。");
        return;
      }
      floatingButton.textContent = "ApplyFlowに保存済み";
      setExistingState(overlay, response);
      setMessage(overlay, response.result === "existing" ? "すでに保存済みです。" : "ApplyFlowへ保存しました。", "success");
    } catch {
      setMessage(overlay, "ネットワークエラーで保存できませんでした。", "error");
    } finally {
      setButtonBusy(button, false, "ApplyFlowに保存");
    }
  }

  function openMessageDrawer(
    overlay: HTMLElement,
    trigger: HTMLButtonElement,
    site: ApplyFlowSourceSite
  ) {
    previouslyFocused = trigger;
    trigger.setAttribute("aria-expanded", "true");
    if (overlay.dataset.suspended === "true") {
      overlay.hidden = false;
      delete overlay.dataset.suspended;
      trigger.textContent = trigger.dataset.expandedLabel || "面接日時を抽出";
      delete trigger.dataset.expandedLabel;
      trigger.setAttribute("aria-label", "選択した企業メッセージから面接日時を抽出");
      const focusTarget = suspendedDrawerFocus && overlay.contains(suspendedDrawerFocus)
        ? suspendedDrawerFocus
        : overlay.querySelector<HTMLTextAreaElement>("#af-selected-message");
      suspendedDrawerFocus = null;
      focusTarget?.focus();
      return;
    }
    currentMessage = null;
    const selectedText = lastSelectedText || window.getSelection()?.toString().trim() || "";
    setInputValue(overlay, "#af-selected-message", selectedText);
    setText(overlay, "#af-source", `${sourceLabel(site)} / 選択範囲のみを処理します`);
    setMessage(
      overlay,
      selectedText ? "選択した本文と送信内容を確認してください。" : "企業メッセージを選択するか、下欄へ貼り付けてください。",
      "info"
    );
    show(overlay, "#af-message-extract-section", true);
    show(overlay, "#af-message-review-section", false);
    show(overlay, "#af-message-success", false);
    const consent = overlay.querySelector<HTMLInputElement>("#af-ai-consent");
    if (consent) consent.checked = false;
    overlay.hidden = false;
    overlay.querySelector<HTMLTextAreaElement>("#af-selected-message")?.focus();
    void chrome.runtime.sendMessage({ type: "GET_SETTINGS" }).then((response) => {
      if (isRecord(response) && isRecord(response.settings) && typeof response.settings.defaultApplicationType === "string") {
        setInputValue(overlay, "#af-new-application-type", response.settings.defaultApplicationType);
      }
    });
  }

  function wireMessageDrawer(
    overlay: HTMLElement,
    floatingButton: HTMLButtonElement,
    site: ApplyFlowSourceSite
  ) {
    overlay.querySelector<HTMLFormElement>("#af-message-extract-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      void extractSelectedMessage(overlay, site);
    });
    overlay.querySelector<HTMLFormElement>("#af-message-register-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      void registerMessageEvent(overlay, floatingButton, site);
    });
    overlay.querySelector<HTMLSelectElement>("#af-message-application")?.addEventListener("change", () => {
      syncMessageDestination(overlay);
      updateInterviewOptions(overlay, false);
    });
    overlay.querySelector<HTMLSelectElement>("#af-company-resolution")?.addEventListener("change", () => {
      syncMessageDestination(overlay);
    });
    overlay.querySelector<HTMLSelectElement>("#af-event-type")?.addEventListener("change", (event) => {
      delete (event.currentTarget as HTMLSelectElement).dataset.wasForced;
      updateScheduleVisibility(overlay);
      syncMessageDestination(overlay);
      updateInterviewOptions(overlay, false);
    });
    overlay.querySelector<HTMLButtonElement>("#af-back-to-message")?.addEventListener("click", () => {
      show(overlay, "#af-message-extract-section", true);
      show(overlay, "#af-message-review-section", false);
      setMessage(overlay, "本文を修正して再抽出できます。", "info");
    });
    overlay.querySelector<HTMLButtonElement>("#af-add-proposed-slot")?.addEventListener("click", () => {
      appendProposedSlot(overlay, null);
    });
    const useSelectionButton = overlay.querySelector<HTMLButtonElement>("#af-use-selection");
    useSelectionButton?.addEventListener("pointerdown", () => {
      lastSelectedText = window.getSelection()?.toString().trim() ?? "";
    });
    useSelectionButton?.addEventListener("click", () => {
      if (!lastSelectedText) {
        setMessage(overlay, "左側の企業メッセージを選択してから、もう一度押してください。", "error");
        return;
      }
      setInputValue(overlay, "#af-selected-message", lastSelectedText);
      setMessage(overlay, "現在選択しているメッセージを取り込みました。", "success");
    });
  }

  async function extractSelectedMessage(overlay: HTMLElement, site: ApplyFlowSourceSite) {
    const text = getInputValue(overlay, "#af-selected-message") ?? "";
    const consent = overlay.querySelector<HTMLInputElement>("#af-ai-consent")?.checked === true;
    if (text.length < 20) {
      setMessage(overlay, "日時を含む企業メッセージを20文字以上選択してください。", "error");
      return;
    }
    if (text.length > 12_000) {
      setMessage(overlay, "選択本文は12,000文字以内にしてください。", "error");
      return;
    }
    if (!consent) {
      setMessage(overlay, "選択本文のAI処理への同意を確認してください。", "error");
      return;
    }
    const button = overlay.querySelector<HTMLButtonElement>("#af-extract-message");
    setButtonBusy(button, true, "抽出中…");
    setMessage(overlay, "面接日時と変更・取消の有無を抽出しています…", "info");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "EXTRACT_MESSAGE",
        payload: {
          sourceSite: site,
          sourceUrl: location.href,
          selectedText: text,
          pageTitle: document.title,
          capturedAt: new Date().toISOString(),
          consentToAiProcessing: true
        }
      });
      if (!isMessageResponse(response)) {
        setApiError(overlay, response, "日時を抽出できませんでした。");
        return;
      }
      currentMessage = response;
      populateMessageReview(overlay, response);
    } catch {
      setMessage(overlay, "ネットワークエラーで日時を抽出できませんでした。", "error");
    } finally {
      setButtonBusy(button, false, "日時を抽出");
    }
  }

  function populateMessageReview(overlay: HTMLElement, result: ApplyFlowMessageExtractionResponse) {
    const extraction = result.extraction;
    const applicationSelect = overlay.querySelector<HTMLSelectElement>("#af-message-application");
    if (!applicationSelect) return;
    const requiresApplicationConfirmation = result.possibleApplicationIds.length > 0;
    applicationSelect.replaceChildren(
      createOption(
        "",
        requiresApplicationConfirmation
          ? "表記ゆれ候補を確認してください"
          : "登録方法を選択してください"
      ),
      createOption("__new__", `新しい応募先を作成: ${extraction.companyName ?? "会社名未抽出"} / ${extraction.position ?? "ポジション未抽出"}`)
    );
    result.applications.forEach((application) => {
      const prefix = application.matchKind === "EXACT" ? "[完全一致] " : application.matchKind === "POSSIBLE" ? "[表記ゆれ候補] " : "";
      applicationSelect.append(
        createOption(
          application.id,
          `${prefix}${application.companyName} / ${application.position}（${applicationStatusLabel(application.status)}）`
        )
      );
    });
    applicationSelect.value = result.recommendedApplicationId ?? (requiresApplicationConfirmation ? "" : "__new__");
    setInputValue(overlay, "#af-extracted-company", extraction.companyName ?? "");
    setInputValue(overlay, "#af-extracted-position", extraction.position ?? "");
    populateCompanyResolution(overlay, result);
    setInputValue(overlay, "#af-event-type", extraction.eventType);
    const eventTypeSelect = overlay.querySelector<HTMLSelectElement>("#af-event-type");
    if (eventTypeSelect) eventTypeSelect.dataset.suggestedEventType = extraction.eventType;
    setInputValue(overlay, "#af-stage-type", extraction.stageType ?? "OTHER");
    setInputValue(overlay, "#af-stage-name", extraction.stageName ?? "");
    setInputValue(overlay, "#af-confirmed-start", isoToLocalInput(extraction.confirmedSlot.startAt));
    setInputValue(overlay, "#af-confirmed-end", isoToLocalInput(extraction.confirmedSlot.endAt));
    setInputValue(overlay, "#af-meeting-url", extraction.meetingUrl ?? "");
    setInputValue(overlay, "#af-interviewer-name", extraction.interviewerName ?? "");
    renderProposedSlots(overlay, extraction.proposedSlots);
    syncMessageDestination(overlay);
    updateInterviewOptions(overlay, true);
    updateScheduleVisibility(overlay);
    setText(
      overlay,
      "#af-extraction-summary",
      `${eventTypeLabel(extraction.eventType)}として抽出 / AI信頼度 ${Math.round(extraction.confidence * 100)}%。必ず確認してください。`
    );
    show(overlay, "#af-message-extract-section", false);
    show(overlay, "#af-message-review-section", true);
    setMessage(
      overlay,
      result.applications.length
        ? "応募先と日時を確認して登録してください。"
        : "抽出した応募先を新規作成し、日時と一緒に登録できます。",
      "info"
    );
    applicationSelect.focus();
  }

  function populateCompanyResolution(
    overlay: HTMLElement,
    result: ApplyFlowMessageExtractionResponse
  ) {
    const select = overlay.querySelector<HTMLSelectElement>("#af-company-resolution");
    if (!select) return;
    select.replaceChildren();
    const exactCompany = result.companySuggestions.find(
      (company) => company.id === result.exactCompanyId
    );
    if (exactCompany) {
      select.append(createOption(exactCompany.id, `既存企業を使用: ${exactCompany.name}`));
      select.value = exactCompany.id;
      return;
    }
    const possibleCompanies = result.companySuggestions.filter(
      (company) => company.matchKind === "POSSIBLE"
    );
    if (possibleCompanies.length > 0) {
      select.append(createOption("", "表記ゆれ候補を確認してください"));
      possibleCompanies.forEach((company) => {
        select.append(createOption(company.id, `既存企業へ統合: ${company.name}`));
      });
      select.append(createOption("__new_company__", "別企業として新規作成"));
      select.value = "";
      return;
    }
    select.append(createOption("__new_company__", "新しい企業として作成"));
    select.value = "__new_company__";
  }

  function syncMessageDestination(overlay: HTMLElement) {
    if (!currentMessage) return;
    const destination = getInputValue(overlay, "#af-message-application") ?? "";
    const companyInput = overlay.querySelector<HTMLInputElement>("#af-extracted-company");
    const positionInput = overlay.querySelector<HTMLInputElement>("#af-extracted-position");
    const isNew = destination === "__new__";
    const existing = currentMessage.applications.find((application) => application.id === destination);
    if (existing) {
      if (companyInput) {
        companyInput.value = existing.companyName;
        companyInput.disabled = true;
      }
      if (positionInput) {
        positionInput.value = existing.position;
        positionInput.disabled = true;
      }
      show(overlay, "#af-company-resolution-row", false);
      show(overlay, "#af-new-application-type-row", false);
      setText(
        overlay,
        "#af-destination-hint",
        existing.matchKind === "POSSIBLE"
          ? `抽出「${currentMessage.extraction.companyName ?? "会社名不明"} / ${currentMessage.extraction.position ?? "ポジション不明"}」を、既存「${existing.companyName} / ${existing.position}」へ統合します。`
          : `既存の「${existing.companyName} / ${existing.position}」へ面接情報を統合します。`
      );
      return;
    }

    if (companyInput) {
      companyInput.disabled = false;
      companyInput.value = currentMessage.extraction.companyName ?? companyInput.value;
    }
    if (positionInput) {
      positionInput.disabled = false;
      positionInput.value = currentMessage.extraction.position ?? positionInput.value;
    }
    show(overlay, "#af-company-resolution-row", isNew);
    show(overlay, "#af-new-application-type-row", isNew);
    if (!isNew) {
      setText(overlay, "#af-destination-hint", "既存へ統合するか、新しい応募先を作成するか選択してください。");
      return;
    }
    const companyResolution = getInputValue(overlay, "#af-company-resolution") ?? "";
    const company = currentMessage.companySuggestions.find(
      (candidate) => candidate.id === companyResolution
    );
    setText(
      overlay,
      "#af-destination-hint",
      company
        ? company.matchKind === "POSSIBLE"
          ? `表記ゆれ候補「${company.name}」を既存企業として使用し、新しいポジションを追加します。`
          : `既存企業「${company.name}」に新しいポジションを追加します。`
        : companyResolution === "__new_company__"
          ? "抽出した会社名とポジションで新しい応募先を作成します。"
          : "会社名の表記ゆれ候補を確認してください。"
    );
  }

  function updateInterviewOptions(overlay: HTMLElement, useRecommendation: boolean) {
    const destination = getInputValue(overlay, "#af-message-application") ?? "";
    const applicationId = destination === "__new__" ? "" : destination;
    const eventTypeSelect = overlay.querySelector<HTMLSelectElement>("#af-event-type");
    const select = overlay.querySelector<HTMLSelectElement>("#af-target-interview");
    if (!select || !eventTypeSelect || !currentMessage) return;
    const application = currentMessage.applications.find((item) => item.id === applicationId);
    const activeInterviews = application?.interviews.filter((interview) =>
      ["DRAFT", "PROPOSED", "WAITING_REPLY", "CONFIRMED"].includes(interview.status)
    ) ?? [];
    const canSelectExistingInterview = activeInterviews.length > 0;
    for (const option of eventTypeSelect.options) {
      if (option.value === "RESCHEDULE" || option.value === "CANCEL") {
        option.disabled = !canSelectExistingInterview;
      }
    }
    if (!canSelectExistingInterview && eventTypeSelect.value !== "CREATE_OR_UPDATE") {
      eventTypeSelect.dataset.wasForced = "true";
      eventTypeSelect.value = "CREATE_OR_UPDATE";
    } else if (canSelectExistingInterview && eventTypeSelect.dataset.wasForced === "true") {
      const suggested = eventTypeSelect.dataset.suggestedEventType;
      if (suggested === "RESCHEDULE" || suggested === "CANCEL") {
        eventTypeSelect.value = suggested;
      }
      delete eventTypeSelect.dataset.wasForced;
    }
    const eventType = eventTypeSelect.value as ApplyFlowMessageEventType;
    const blankLabel = eventType === "CANCEL" ? "取消する面接を選択" : eventType === "RESCHEDULE" ? "変更する面接を選択" : "新しい面接として登録";
    select.replaceChildren(
      createOption(
        "",
        canSelectExistingInterview ? blankLabel : "対象面接なし（新規として登録）"
      )
    );
    activeInterviews.forEach((interview) => {
      const date = interview.confirmedStartAt ? ` / ${formatDate(interview.confirmedStartAt)}` : "";
      select.append(
        createOption(
          interview.id,
          `${interview.title ?? interview.stageName ?? stageTypeLabel(interview.stageType)} / ${interviewStatusLabel(interview.status)}${date}`
        )
      );
    });
    select.disabled = !canSelectExistingInterview;
    select.required = eventType === "CANCEL" || eventType === "RESCHEDULE";
    setText(
      overlay,
      "#af-target-hint",
      canSelectExistingInterview
        ? eventType === "CREATE_OR_UPDATE"
          ? "新しい面接を作成するか、更新する既存面接を選択できます。"
          : "変更・取消する既存面接を選択してください。"
        : "既存の対象面接がないため、新しい面接として登録します。"
    );
    updateScheduleVisibility(overlay);
    if (useRecommendation && currentMessage.recommendedInterviewId && activeInterviews.some((item) => item.id === currentMessage?.recommendedInterviewId)) {
      select.value = currentMessage.recommendedInterviewId;
    }
  }

  function updateScheduleVisibility(overlay: HTMLElement) {
    const active = getInputValue(overlay, "#af-event-type") !== "CANCEL";
    show(overlay, "#af-schedule-fields", active);
    show(overlay, "#af-replace-row", active);
  }

  function renderProposedSlots(overlay: HTMLElement, slots: ApplyFlowMessageSlot[]) {
    const container = overlay.querySelector<HTMLElement>("#af-proposed-slots");
    if (!container) return;
    container.replaceChildren();
    slots.forEach((slot) => appendProposedSlot(overlay, slot));
    show(overlay, "#af-no-proposed-slots", slots.length === 0);
  }

  function appendProposedSlot(overlay: HTMLElement, slot: ApplyFlowMessageSlot | null) {
    const container = overlay.querySelector<HTMLElement>("#af-proposed-slots");
    if (!container || container.childElementCount >= 10) return;
    const index = container.childElementCount + 1;
    const row = document.createElement("div");
    row.className = "af-slot-row";
    const start = document.createElement("input");
    start.type = "datetime-local";
    start.className = "af-slot-start";
    start.value = isoToLocalInput(slot?.startAt ?? null);
    const end = document.createElement("input");
    end.type = "datetime-local";
    end.className = "af-slot-end";
    end.value = isoToLocalInput(slot?.endAt ?? null);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "af-slot-remove";
    remove.textContent = "削除";
    remove.setAttribute("aria-label", `候補${index}を削除`);
    remove.addEventListener("click", () => {
      row.remove();
      show(overlay, "#af-no-proposed-slots", container.childElementCount === 0);
    });
    row.append(
      createLabeledInput(`候補${index} 開始`, start),
      createLabeledInput(`候補${index} 終了`, end),
      remove
    );
    container.append(row);
    show(overlay, "#af-no-proposed-slots", false);
  }

  async function registerMessageEvent(
    overlay: HTMLElement,
    floatingButton: HTMLButtonElement,
    site: ApplyFlowSourceSite
  ) {
    if (!currentMessage) return;
    const destination = getInputValue(overlay, "#af-message-application") ?? "";
    const isNewApplication = destination === "__new__";
    const applicationId = isNewApplication ? undefined : destination || undefined;
    const companyName = getInputValue(overlay, "#af-extracted-company") ?? "";
    const position = getInputValue(overlay, "#af-extracted-position") ?? "";
    const companyResolution = getInputValue(overlay, "#af-company-resolution") ?? "";
    const companyId =
      isNewApplication && companyResolution && companyResolution !== "__new_company__"
        ? companyResolution
        : undefined;
    const eventType = (getInputValue(overlay, "#af-event-type") ?? "CREATE_OR_UPDATE") as ApplyFlowMessageEventType;
    const targetInterviewId = getInputValue(overlay, "#af-target-interview") || undefined;
    if (!destination) {
      setMessage(overlay, "表記ゆれ候補を確認し、既存への統合または新規作成を選択してください。", "error");
      return;
    }
    if (!companyName || !position) {
      setMessage(overlay, "会社名とポジションを確認してください。", "error");
      return;
    }
    if (isNewApplication && !companyResolution) {
      setMessage(overlay, "会社名の表記ゆれ候補を確認してください。", "error");
      return;
    }
    if (isNewApplication && eventType !== "CREATE_OR_UPDATE") {
      setMessage(overlay, "日時変更・取消は既存の応募先を選択してください。", "error");
      return;
    }
    if ((eventType === "CANCEL" || eventType === "RESCHEDULE") && !targetInterviewId) {
      setMessage(overlay, "変更・取消対象の面接を選択してください。", "error");
      return;
    }
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo";
    const confirmedStartAt = localInputToIso(getInputValue(overlay, "#af-confirmed-start"));
    const confirmedEndAt = localInputToIso(getInputValue(overlay, "#af-confirmed-end"));
    if ((confirmedStartAt && !confirmedEndAt) || (!confirmedStartAt && confirmedEndAt)) {
      setMessage(overlay, "確定日時は開始と終了を両方入力してください。", "error");
      return;
    }
    const proposedSlots = collectProposedSlots(overlay, timezone);
    if (!proposedSlots) {
      setMessage(overlay, "候補日時の開始・終了を確認してください。", "error");
      return;
    }
    if (eventType !== "CANCEL" && !confirmedStartAt && proposedSlots.length === 0) {
      setMessage(overlay, "確定日時または候補日時を1件以上入力してください。", "error");
      return;
    }

    const button = overlay.querySelector<HTMLButtonElement>("#af-register-message");
    setButtonBusy(button, true, "登録中…");
    setMessage(overlay, "ダッシュボードと応募先へ反映しています…", "info");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "REGISTER_MESSAGE_EVENT",
        idempotencyKey: createIdempotencyKey(),
        payload: {
          sourceSite: site,
          sourceUrl: location.href,
          messageDigest: currentMessage.messageDigest,
          applicationId,
          companyId,
          companyName,
          position,
          applicationType: getInputValue(overlay, "#af-new-application-type") || "CAREER_CHANGE",
          targetInterviewId,
          eventType,
          stageType: getInputValue(overlay, "#af-stage-type") || "OTHER",
          stageName: getInputValue(overlay, "#af-stage-name") || undefined,
          confirmedSlot: {
            startAt: eventType === "CANCEL" ? null : confirmedStartAt,
            endAt: eventType === "CANCEL" ? null : confirmedEndAt,
            timezone: eventType === "CANCEL" || !confirmedStartAt ? null : timezone
          },
          proposedSlots: eventType === "CANCEL" ? [] : proposedSlots,
          meetingUrl: getInputValue(overlay, "#af-meeting-url") || null,
          interviewerName: getInputValue(overlay, "#af-interviewer-name") || null,
          replaceCurrentSchedule: overlay.querySelector<HTMLInputElement>("#af-replace-schedule")?.checked !== false
        }
      });
      if (!isRecord(response) || response.ok !== true) {
        setApiError(overlay, response, "面接日時を登録できませんでした。");
        return;
      }
      const openButton = overlay.querySelector<HTMLButtonElement>("#af-open-application");
      if (openButton && typeof response.applicationUrl === "string") openButton.dataset.applicationUrl = response.applicationUrl;
      floatingButton.textContent = eventType === "CANCEL" ? "面接取消を反映済み" : "面接日時を反映済み";
      setText(
        overlay,
        "#af-success-title",
        eventType === "CANCEL"
          ? "面接取消を反映しました"
          : isNewApplication
            ? "応募先と面接日時を登録しました"
            : "面接日時を反映しました"
      );
      show(overlay, "#af-message-review-section", false);
      show(overlay, "#af-message-success", true);
      setMessage(overlay, "ダッシュボードと応募先を更新しました。", "success");
    } catch {
      setMessage(overlay, "ネットワークエラーで登録できませんでした。", "error");
    } finally {
      setButtonBusy(button, false, "確認内容を登録");
    }
  }

  function collectProposedSlots(overlay: HTMLElement, timezone: string) {
    const slots: ApplyFlowMessageSlot[] = [];
    for (const row of overlay.querySelectorAll<HTMLElement>(".af-slot-row")) {
      const startAt = localInputToIso(getInputValue(row, ".af-slot-start"));
      const endAt = localInputToIso(getInputValue(row, ".af-slot-end"));
      if (!startAt && !endAt) continue;
      if (!startAt || !endAt || new Date(startAt) >= new Date(endAt)) return null;
      slots.push({ startAt, endAt, timezone });
    }
    return slots;
  }

  function setExistingState(overlay: HTMLElement, response: Record<string, unknown> | null) {
    const form = overlay.querySelector<HTMLElement>("#af-form-section");
    const existing = overlay.querySelector<HTMLElement>("#af-existing");
    if (!form || !existing) return;
    const found = Boolean(response && typeof response.applicationUrl === "string");
    form.hidden = found;
    existing.hidden = !found;
    if (!found || !response) return;
    const openButton = overlay.querySelector<HTMLButtonElement>("#af-open-application");
    if (openButton) openButton.dataset.applicationUrl = String(response.applicationUrl);
    setText(
      overlay,
      "#af-existing-title",
      [response.companyName, response.position].filter((value) => typeof value === "string").join(" / ") || "保存済みの応募先"
    );
    setText(
      overlay,
      "#af-existing-status",
      typeof response.applicationStatus === "string" ? `ステータス: ${applicationStatusLabel(response.applicationStatus)}` : "ApplyFlowで詳細を確認できます。"
    );
  }

  function suspendMessageDrawer(overlay: HTMLElement, trigger: HTMLButtonElement) {
    trigger.dataset.expandedLabel = trigger.textContent || "面接日時を抽出";
    trigger.textContent = "日時抽出を再開";
    trigger.setAttribute("aria-label", "入力内容を保持したまま日時抽出パネルを再開");
    overlay.dataset.suspended = "true";
    closeDrawer(overlay, trigger);
  }

  function closeDrawer(overlay: HTMLElement, trigger?: HTMLButtonElement) {
    overlay.hidden = true;
    trigger?.setAttribute("aria-expanded", "false");
    previouslyFocused?.focus();
  }

  function setMessage(root: ParentNode, message: string, tone: "info" | "success" | "error") {
    const element = root.querySelector<HTMLElement>("#af-message");
    if (element) {
      element.textContent = message;
      element.dataset.tone = tone;
    }
  }

  function setApiError(root: ParentNode, response: unknown, fallback: string) {
    setMessage(root, isRecord(response) && typeof response.message === "string" ? response.message : fallback, "error");
    const options = root.querySelector<HTMLButtonElement>("#af-options");
    if (options) options.hidden = !(isRecord(response) && response.code === "AUTH_REQUIRED");
  }

  function show(root: ParentNode, selector: string, visible: boolean) {
    const element = root.querySelector<HTMLElement>(selector);
    if (element) element.hidden = !visible;
  }

  function setInputValue(root: ParentNode, selector: string, value: string | undefined) {
    const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
    if (input) input.value = value ?? "";
  }

  function getInputValue(root: ParentNode, selector: string) {
    return root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)?.value.trim();
  }

  function setText(root: ParentNode, selector: string, value: string) {
    const element = root.querySelector<HTMLElement>(selector);
    if (element) element.textContent = value;
  }

  function setButtonBusy(button: HTMLButtonElement | null, busy: boolean, label: string) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = label;
  }

  function createOption(value: string, label: string) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }

  function createLabeledInput(text: string, input: HTMLInputElement) {
    const label = document.createElement("label");
    label.textContent = text;
    label.append(input);
    return label;
  }

  function createIdempotencyKey() {
    return crypto.randomUUID().replace(/-/g, "_");
  }

  function isoToLocalInput(value: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }

  function localInputToIso(value: string | undefined) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function formatDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function detectSupportedSite(url: URL): ApplyFlowSourceSite | null {
    const hostname = url.hostname.toLowerCase();
    if (hostname === "green-japan.com" || hostname.endsWith(".green-japan.com")) return "GREEN";
    if (hostname === "doda.jp" || hostname.endsWith(".doda.jp")) return "DODA";
    return null;
  }

  function isMessageResponse(value: unknown): value is ApplyFlowMessageExtractionResponse {
    return Boolean(isRecord(value) && value.ok === true && typeof value.messageDigest === "string" && isRecord(value.extraction) && Array.isArray(value.applications));
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function sourceLabel(site: ApplyFlowSourceSite) {
    return site === "GREEN" ? "Green" : "doda";
  }

  function eventTypeLabel(type: ApplyFlowMessageEventType) {
    return { CREATE_OR_UPDATE: "新規・更新", RESCHEDULE: "日時変更", CANCEL: "取消" }[type];
  }

  function applicationStatusLabel(status: string) {
    const labels: Record<string, string> = { DRAFT: "下書き", APPLIED: "応募済み", DOCUMENT_SCREENING: "書類選考", INTERVIEWING: "面接中", OFFERED: "オファー", ACCEPTED: "承諾", DECLINED: "辞退", REJECTED: "不採用", WITHDRAWN: "取下げ", CLOSED: "終了" };
    return labels[status] ?? status;
  }

  function interviewStatusLabel(status: string) {
    const labels: Record<string, string> = { DRAFT: "下書き", PROPOSED: "候補", WAITING_REPLY: "返信待ち", CONFIRMED: "確定", COMPLETED: "完了", CANCELLED: "取消", EXPIRED: "期限切れ" };
    return labels[status] ?? status;
  }

  function stageTypeLabel(type: string) {
    const labels: Record<string, string> = { DOCUMENT_SCREENING: "書類選考", CASUAL_MEETING: "カジュアル面談", FIRST_INTERVIEW: "一次面接", SECOND_INTERVIEW: "二次面接", FINAL_INTERVIEW: "最終面接", OFFER_MEETING: "オファー面談", CONDITION_MEETING: "条件面談", ASSIGNMENT: "課題", OTHER: "その他" };
    return labels[type] ?? type;
  }

  const captureDrawerMarkup = `
    <section class="af-drawer" role="dialog" aria-modal="false" aria-labelledby="af-title"><header class="af-header"><div><span class="af-eyebrow">APPLYFLOW</span><h2 id="af-title">求人を保存</h2></div><button id="af-close" class="af-icon-button" type="button" aria-label="閉じる">×</button></header><div class="af-body">
      <p id="af-message" class="af-message" data-tone="info" role="status"></p><button id="af-options" class="af-secondary" type="button" hidden>拡張機能の設定を開く</button><p id="af-warnings" class="af-help"></p><p id="af-source" class="af-source"></p>
      <section id="af-existing" class="af-existing" hidden><strong id="af-existing-title"></strong><p id="af-existing-status"></p><button id="af-open-application" class="af-primary" type="button">ApplyFlowで開く</button></section>
      <section id="af-form-section"><form id="af-capture-form"><label>会社名 <span>*</span><input id="af-company-name" maxlength="100" required /></label><label>ポジション <span>*</span><input id="af-position" maxlength="100" required /></label><label>応募種別<select id="af-application-type"><option value="CAREER_CHANGE">転職</option><option value="JOB_HUNTING">就活</option><option value="INTERNSHIP">インターン</option><option value="FREELANCE">業務委託</option><option value="PART_TIME">アルバイト</option><option value="GRADUATE_SCHOOL">大学院</option><option value="OTHER">その他</option></select></label><label>勤務地<input id="af-location" maxlength="500" /></label><label>雇用形態<input id="af-employment" maxlength="300" /></label><label>給与・報酬<input id="af-compensation" maxlength="500" /></label><label>メモ<textarea id="af-note" rows="4" maxlength="5000"></textarea></label><p class="af-privacy">求人本文、画像、Cookie、媒体の認証情報は送信しません。</p><div class="af-actions"><button class="af-secondary af-close-drawer" type="button">キャンセル</button><button id="af-save" class="af-primary" type="submit">ApplyFlowに保存</button></div></form></section>
    </div></section>`;

  const messageDrawerMarkup = `
    <section class="af-drawer" role="dialog" aria-modal="false" aria-labelledby="af-title"><header class="af-header"><div><span class="af-eyebrow">APPLYFLOW</span><h2 id="af-title">企業メッセージから面接登録</h2></div><button id="af-close" class="af-icon-button" type="button" aria-label="入力内容を保持して一時的に隠す" title="入力内容を保持して一時的に隠す">−</button></header><div class="af-body">
      <p id="af-message" class="af-message" data-tone="info" role="status"></p><button id="af-options" class="af-secondary" type="button" hidden>拡張機能の設定を開く</button><p id="af-source" class="af-source"></p>
      <section id="af-message-extract-section"><form id="af-message-extract-form"><div class="af-selection-tools"><p>パネルを開いたまま、左側のメッセージを確認・選択できます。</p><button id="af-use-selection" class="af-secondary" type="button">現在の選択を取り込む</button></div><label>抽出する企業メッセージ <span>*</span><textarea id="af-selected-message" rows="10" maxlength="12000" required></textarea></label><label class="af-check"><input id="af-ai-consent" type="checkbox" required /><span>選択した本文を日時抽出のためApplyFlowからCloudflare Workers AI上の@cf/openai/gpt-oss-120bへ送信することに同意します。</span></label><p class="af-privacy">送信するのは上の本文だけです。本文はCloudflareの保存サービスやApplyFlowのデータベースへ保存しません。</p><div class="af-actions"><button class="af-secondary af-close-drawer" type="button">一時的に隠す</button><button id="af-extract-message" class="af-primary" type="submit">日時を抽出</button></div></form></section>
      <section id="af-message-review-section" hidden><p id="af-extraction-summary" class="af-review-summary"></p><form id="af-message-register-form"><section class="af-destination-section"><h3>応募先</h3><div class="af-grid"><label>抽出した会社名 <span>*</span><input id="af-extracted-company" maxlength="100" required /></label><label>抽出したポジション <span>*</span><input id="af-extracted-position" maxlength="100" required /></label></div><label>登録方法 <span>*</span><select id="af-message-application" required></select></label><p id="af-destination-hint" class="af-destination-hint"></p><label id="af-company-resolution-row">企業の扱い <span>*</span><select id="af-company-resolution"></select></label><label id="af-new-application-type-row">新しい応募先の種別<select id="af-new-application-type"><option value="CAREER_CHANGE">転職</option><option value="JOB_HUNTING">就活</option><option value="INTERNSHIP">インターン</option><option value="FREELANCE">業務委託</option><option value="PART_TIME">アルバイト</option><option value="GRADUATE_SCHOOL">大学院</option><option value="OTHER">その他</option></select></label></section><label>メッセージの内容<select id="af-event-type"><option value="CREATE_OR_UPDATE">新規・更新</option><option value="RESCHEDULE">日時変更</option><option value="CANCEL">取消</option></select></label><label>対象の面接<select id="af-target-interview"></select></label><p id="af-target-hint" class="af-help"></p><div class="af-grid"><label>選考種別<select id="af-stage-type"><option value="CASUAL_MEETING">カジュアル面談</option><option value="FIRST_INTERVIEW">一次面接</option><option value="SECOND_INTERVIEW">二次面接</option><option value="FINAL_INTERVIEW">最終面接</option><option value="OFFER_MEETING">オファー面談</option><option value="CONDITION_MEETING">条件面談</option><option value="DOCUMENT_SCREENING">書類選考</option><option value="ASSIGNMENT">課題</option><option value="OTHER">その他</option></select></label><label>表示名<input id="af-stage-name" maxlength="100" /></label></div>
        <section id="af-schedule-fields" class="af-schedule-fields"><h3>確定日時</h3><div class="af-grid"><label>開始<input id="af-confirmed-start" type="datetime-local" /></label><label>終了<input id="af-confirmed-end" type="datetime-local" /></label></div><div class="af-section-heading"><h3>候補日時</h3><button id="af-add-proposed-slot" class="af-text-button" type="button">候補を追加</button></div><p id="af-no-proposed-slots" class="af-help">候補日時は抽出されませんでした。</p><div id="af-proposed-slots"></div><label>面接URL<input id="af-meeting-url" type="url" maxlength="2000" /></label><label>担当者名<input id="af-interviewer-name" maxlength="200" /></label></section>
        <label id="af-replace-row" class="af-check"><input id="af-replace-schedule" type="checkbox" checked /><span>対象面接の現在の確定・候補日時を置き換える</span></label><p class="af-privacy">登録前に応募先・対象面接・日時を確認してください。終了時刻がない場合は60分として抽出されます。</p><div class="af-actions af-actions-between"><button id="af-back-to-message" class="af-secondary" type="button">本文へ戻る</button><button id="af-register-message" class="af-primary" type="submit">確認内容を登録</button></div></form></section>
      <section id="af-message-success" class="af-existing" hidden><strong id="af-success-title">面接日時を反映しました</strong><p>ダッシュボードと応募先で内容を確認できます。</p><button id="af-open-application" class="af-primary" type="button">応募先を開く</button></section>
    </div></section>`;

  const uiStyles = `
    :host{all:initial;color-scheme:light}*,*::before,*::after{box-sizing:border-box}button,input,select,textarea{font:inherit}.af-floating-button{position:fixed;right:24px;bottom:24px;z-index:2147483646;border:0;border-radius:999px;background:#2563eb;color:#fff;padding:13px 18px;box-shadow:0 10px 30px rgba(15,23,42,.25);font:700 14px Arial,"Yu Gothic",sans-serif;cursor:pointer}.af-floating-button-message{bottom:96px}.af-floating-button:hover{background:#1d4ed8}.af-floating-button:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}.af-overlay{position:fixed;inset:0;z-index:2147483647;pointer-events:none;font:14px/1.5 Arial,"Yu Gothic",sans-serif;color:#152033}.af-overlay[hidden],[hidden]{display:none!important}.af-drawer{position:absolute;inset:0 0 0 auto;width:min(500px,calc(100vw - 48px));overflow:auto;pointer-events:auto;background:#f8fafc;border-left:1px solid #d9dee8;box-shadow:-12px 0 40px rgba(15,23,42,.2)}.af-header{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 22px;border-bottom:1px solid #d9dee8;background:#fff}.af-header h2{margin:2px 0 0;font-size:20px;line-height:1.25}.af-eyebrow{color:#2563eb;font-size:11px;font-weight:800;letter-spacing:.12em}.af-icon-button{width:36px;height:36px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;font-size:24px;cursor:pointer}.af-body{padding:20px 22px 28px}.af-message{margin:0 0 14px;border-radius:8px;padding:10px 12px;background:#eff6ff;color:#1e3a8a}.af-message[data-tone="success"]{background:#ecfdf3;color:#166534}.af-message[data-tone="error"]{background:#fef2f2;color:#b91c1c}.af-help{margin:4px 0;color:#64748b;font-size:12px}.af-source{margin:0 0 18px;color:#64748b;font-size:11px;overflow-wrap:anywhere}form{display:grid;gap:14px}label{display:grid;gap:6px;color:#334155;font-size:12px;font-weight:700}input,select,textarea{width:100%;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;padding:10px 11px;font-size:14px}input:disabled,select:disabled{background:#f1f5f9;color:#475569}textarea{resize:vertical}.af-check{display:flex;align-items:flex-start;gap:9px;font-weight:500;line-height:1.45}.af-check input{width:auto;margin-top:3px}.af-privacy{margin:0;color:#64748b;font-size:11px}.af-selection-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #bfdbfe;border-radius:8px;background:#eff6ff;padding:10px 12px}.af-selection-tools p{margin:0;color:#1e3a8a;font-size:12px}.af-selection-tools button{flex:none}.af-actions{display:flex;justify-content:flex-end;gap:10px;padding-top:4px}.af-actions-between{justify-content:space-between}.af-primary,.af-secondary{border-radius:8px;padding:10px 14px;font-weight:700;cursor:pointer}.af-primary{border:1px solid #2563eb;background:#2563eb;color:#fff}.af-primary:hover{background:#1d4ed8}.af-primary:disabled{cursor:wait;opacity:.6}.af-secondary{border:1px solid #cbd5e1;background:#fff;color:#334155}.af-existing{border:1px solid #bbf7d0;border-radius:10px;background:#f0fdf4;padding:16px}.af-existing p{margin:5px 0 14px;color:#475569}.af-review-summary{margin:0 0 14px;border:1px solid #bfdbfe;border-radius:8px;background:#eff6ff;padding:10px 12px;color:#1e3a8a;font-size:12px}.af-destination-section{display:grid;gap:12px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;padding:14px}.af-destination-section h3{margin:0;font-size:15px}.af-destination-hint{margin:0;border-radius:8px;background:#f8fafc;padding:9px 10px;color:#475569;font-size:12px}.af-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.af-schedule-fields{display:grid;gap:12px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:14px}.af-schedule-fields h3{margin:0;font-size:13px}.af-section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.af-text-button{border:0;background:transparent;color:#2563eb;padding:2px;font-size:12px;font-weight:700;cursor:pointer}#af-proposed-slots{display:grid;gap:10px}.af-slot-row{display:grid;grid-template-columns:1fr 1fr auto;align-items:end;gap:10px;border-bottom:1px solid #e2e8f0;padding-bottom:10px}.af-slot-remove{border:1px solid #fecaca;border-radius:8px;background:#fff;color:#b91c1c;padding:10px 8px;font-size:12px;cursor:pointer}@media(max-width:520px){.af-floating-button{right:12px;bottom:12px}.af-floating-button-message{bottom:88px}.af-drawer{inset:auto 0 0;width:100vw;max-height:72vh;border-top:1px solid #d9dee8;border-left:0;border-radius:16px 16px 0 0}.af-body{padding:16px}.af-grid,.af-slot-row{grid-template-columns:1fr}.af-selection-tools{align-items:stretch;flex-direction:column}.af-slot-remove{justify-self:start}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
  `;

  evaluatePage();
  window.addEventListener("popstate", () => window.setTimeout(evaluatePage, 0));
  window.addEventListener("hashchange", () => window.setTimeout(evaluatePage, 0));
  new MutationObserver(() => {
    window.clearTimeout(navigationTimer);
    navigationTimer = window.setTimeout(evaluatePage, 250);
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(() => {
    if (lastUrl !== location.href) evaluatePage();
  }, 1_000);
})();
