const SCORE_CONFIG = {
  ai: {
    ringId: "ai-score-ring",
    valueId: "ai-score-value",
    copyId: "ai-score-copy",
    label: "AI Detection Score",
    fallbackCopy: "No AI content markers detected yet.",
  },
  manipulation: {
    ringId: "manipulation-score-ring",
    valueId: "manipulation-score-value",
    copyId: "manipulation-score-copy",
    label: "Manipulation Score",
    fallbackCopy: "No emotional manipulation signals detected yet.",
  },
  trust: {
    ringId: "trust-score-ring",
    valueId: "trust-score-value",
    copyId: "trust-score-copy",
    label: "Domain Trust Score",
    fallbackCopy: "No domain trust data available yet.",
  },
};

const STATUS_COPY = {
  loading: "Analyzing page",
  ready: "Analysis complete",
  unavailable: "Analysis unavailable",
  unsupported: "Unsupported page",
  error: "Analysis failed",
};

const COPY_BY_SCORE = {
  ai: {
    safe: "Low likelihood of synthetic phrasing patterns.",
    caution: "Some language markers resemble generated text.",
    danger: "Strong AI-generation signals detected in the content.",
  },
  manipulation: {
    safe: "Language appears measured and low on emotional pressure.",
    caution: "Some persuasive or rage-bait patterns are present.",
    danger: "High emotional manipulation and outrage cues detected.",
  },
  trust: {
    safe: "Domain credibility signals look consistent and reliable.",
    caution: "Domain trust indicators are mixed or incomplete.",
    danger: "Historical reliability indicators are below threshold.",
  },
};

const state = {
  activeTab: null,
  analysis: null,
  isDarkMode: true,
};

document.addEventListener("DOMContentLoaded", () => {
  initializePopup().catch((error) => {
    console.error("Kirlia popup initialization failed:", error);
    renderErrorState("Kirlia could not load page analysis.");
  });
});

async function initializePopup() {
  bindEventListeners();
  applyLoadingState();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.activeTab = tab ?? null;
  console.log("[Kirlia popup] Active tab:", state.activeTab);

  if (!tab?.id || isUnsupportedUrl(tab.url)) {
    renderUnsupportedState(tab?.url);
    await updateBadge("N/A", "#64748b");
    return;
  }

  const analysis = await requestAnalysis(tab.id);
  if (!analysis) {
    renderUnavailableState();
    await updateBadge("WAIT", "#64748b");
    return;
  }

  state.analysis = normalizeAnalysis(analysis);
  renderAnalysis(state.analysis);
  await updateBadgeForAnalysis(state.analysis);
}

function bindEventListeners() {
  document.getElementById("highlight-button")?.addEventListener("click", async () => {
    if (!state.activeTab?.id || isUnsupportedUrl(state.activeTab.url)) {
      renderUnsupportedState(state.activeTab?.url);
      return;
    }

    try {
      console.log("[Kirlia popup] Highlight request sent for tab:", state.activeTab.id);
      const response = await sendRuntimeMessage({
        type: "KIRLIA_HIGHLIGHT_SUSPICIOUS_TEXT",
        tabId: state.activeTab.id,
      });
      if (!response?.ok) {
        throw new Error(response?.error || "Highlight failed.");
      }
      setStatus("Highlighted suspicious text on page.", "ready");
    } catch (error) {
      console.error("Kirlia highlight request failed:", error);
      setStatus("Unable to highlight text on this page.", "error");
    }
  });

  document.getElementById("report-button")?.addEventListener("click", async () => {
    const analysis = state.analysis ?? buildFallbackAnalysis();
    try {
      if (state.activeTab?.id && !isUnsupportedUrl(state.activeTab.url)) {
        console.log("[Kirlia popup] Report overlay request sent for tab:", state.activeTab.id);
        const response = await sendRuntimeMessage({
          type: "KIRLIA_OPEN_REPORT_OVERLAY",
          tabId: state.activeTab.id,
        });
        if (!response?.ok) {
          throw new Error(response?.error || "Report overlay failed.");
        }
        setStatus("Opened report overlay on page.", "ready");
        return;
      }
    } catch (error) {
      console.warn("Kirlia page overlay unavailable, using popup overlay instead.", error);
    }

    openOverlay({
      title: "Full Report",
      body: createReportMarkup(analysis),
    });
  });

  document.getElementById("settings-button")?.addEventListener("click", () => {
    openOverlay({
      title: "Settings",
      body: `
        <div class="kirlia-overlay-section">
          <label class="kirlia-toggle-row">
            <span>Dark mode</span>
            <input id="kirlia-overlay-theme-toggle" type="checkbox" ${state.isDarkMode ? "checked" : ""} />
          </label>
          <p>Kirlia keeps analysis local to the browser and does not upload page text.</p>
        </div>
      `,
      onOpen: () => {
        document
          .getElementById("kirlia-overlay-theme-toggle")
          ?.addEventListener("change", toggleTheme);
      },
    });
  });

  document.getElementById("info-button")?.addEventListener("click", () => {
    openOverlay({
      title: "About Kirlia",
      body: `
        <div class="kirlia-overlay-section">
          <p>Kirlia evaluates AI-generated writing patterns, emotional manipulation, and domain trust signals directly in the browser.</p>
          <p>Unsupported pages such as <code>chrome://</code> or extension pages cannot be analyzed by content scripts.</p>
        </div>
      `,
    });
  });

  document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);
}

function applyLoadingState() {
  setStatus("Analyzing active page...", "loading");
  updateHeadline("Scanning page for AI and credibility signals");
  renderIssues(["Loading analysis results..."]);

  Object.entries(SCORE_CONFIG).forEach(([key, config]) => {
    updateScoreCard(key, 0, config.fallbackCopy);
  });
}

async function requestAnalysis(tabId) {
  try {
    console.log("[Kirlia popup] Requesting analysis via background for tab:", tabId);
    const response = await sendRuntimeMessage({
      type: "KIRLIA_REQUEST_ANALYSIS",
      tabId,
    });
    return response?.ok ? response.analysis : null;
  } catch (error) {
    console.warn("Kirlia analysis request failed:", error);
    return null;
  }
}

function normalizeAnalysis(analysis) {
  const scores = {
    ai: clampScore(analysis?.scores?.ai ?? analysis?.aiScore ?? 0),
    manipulation: clampScore(
      analysis?.scores?.manipulation ?? analysis?.manipulationScore ?? 0,
    ),
    trust: clampScore(analysis?.scores?.trust ?? analysis?.domainTrustScore ?? 0),
  };

  const issues = Array.isArray(analysis?.issues)
    ? analysis.issues.filter(Boolean)
    : [];

  return {
    headline:
      analysis?.headline ??
      buildHeadline(scores),
    status: analysis?.status ?? "ready",
    issues,
    scores,
    overallRisk:
      typeof analysis?.overallRisk === "number"
        ? clampScore(analysis.overallRisk)
        : calculateOverallRisk(scores),
  };
}

function renderAnalysis(analysis) {
  setStatus(STATUS_COPY.ready, "ready");
  updateHeadline(analysis.headline);

  Object.entries(analysis.scores).forEach(([key, value]) => {
    updateScoreCard(key, value, getScoreCopy(key, value));
    animateScore(key, value);
  });

  if (analysis.issues.length === 0) {
    renderIssues(["No clear issues detected on this page yet."]);
  } else {
    renderIssues(analysis.issues);
  }
}

function renderUnavailableState() {
  setStatus("No saved analysis was returned for this page.", "unavailable");
  updateHeadline("Analysis not available yet");
  renderIssues([
    "The content script did not return analysis data.",
    "Open a standard webpage and try again after the page finishes loading.",
  ]);
}

function renderUnsupportedState(url) {
  setStatus("This page cannot be analyzed by Chrome extensions.", "unsupported");
  updateHeadline("Analysis is disabled on this page");
  renderIssues([
    "Chrome blocks content scripts on internal browser pages.",
    `Unsupported URL: ${url ?? "Unknown page"}`,
  ]);
}

function renderErrorState(message) {
  setStatus(message, "error");
  updateHeadline("Kirlia hit an unexpected error");
  renderIssues([
    "Reload the page and reopen the popup.",
    "If the problem persists, inspect the extension console for details.",
  ]);
}

function updateScoreCard(key, score, copy) {
  const config = SCORE_CONFIG[key];
  const ring = document.getElementById(config.ringId);
  const valueNode = document.getElementById(config.valueId);
  const copyNode = document.getElementById(config.copyId);
  const card = document.querySelector(`[data-score-card="${key}"]`);
  const level = getLevel(score);
  const color = getColor(score);

  if (ring) {
    ring.style.setProperty("--score", String(score));
    ring.style.setProperty("--ring-color", color);
    ring.setAttribute("aria-label", `${config.label} ${score} percent`);
  }

  if (valueNode) {
    valueNode.textContent = `${score}%`;
    valueNode.style.color = color;
  }

  if (copyNode) {
    copyNode.textContent = copy;
  }

  if (card) {
    card.classList.remove("safe", "caution", "danger");
    card.classList.add(level);
  }
}

function animateScore(key, target) {
  const config = SCORE_CONFIG[key];
  const ring = document.getElementById(config.ringId);
  const valueNode = document.getElementById(config.valueId);
  if (!ring || !valueNode) {
    return;
  }

  const duration = 900;
  const start = performance.now();
  const color = getColor(target);

  const step = (timestamp) => {
    const progress = Math.min((timestamp - start) / duration, 1);
    const currentValue = Math.round(progress * target);
    ring.style.setProperty("--score", String(currentValue));
    ring.style.setProperty("--ring-color", color);
    valueNode.textContent = `${currentValue}%`;
    valueNode.style.color = color;

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  };

  requestAnimationFrame(step);
}

function renderIssues(issues) {
  const list = document.getElementById("issues-list");
  const count = document.getElementById("issue-count");
  if (!list || !count) {
    return;
  }

  list.innerHTML = "";
  issues.forEach((issue) => {
    const item = document.createElement("li");
    item.textContent = issue;
    list.appendChild(item);
  });

  count.textContent = String(issues.length);
}

function setStatus(message, statusKey) {
  const statusNode = document.getElementById("page-status-text");
  const statusWrap = document.getElementById("page-status");
  if (statusNode) {
    statusNode.textContent = message;
  }
  if (statusWrap) {
    statusWrap.dataset.state = statusKey;
  }
}

function updateHeadline(text) {
  const headline = document.getElementById("headline");
  if (headline) {
    headline.textContent = text;
  }
}

function toggleTheme() {
  state.isDarkMode = !state.isDarkMode;
  const popup = document.querySelector(".popup");
  popup?.classList.toggle("theme-dark", state.isDarkMode);
  popup?.classList.toggle("theme-light", !state.isDarkMode);
}

function getLevel(score) {
  if (score <= 33) {
    return "safe";
  }
  if (score <= 66) {
    return "caution";
  }
  return "danger";
}

function getColor(score) {
  if (score <= 33) {
    return "var(--safe)";
  }
  if (score <= 66) {
    return "var(--caution)";
  }
  return "var(--danger)";
}

function getScoreCopy(key, score) {
  return COPY_BY_SCORE[key]?.[getLevel(score)] ?? SCORE_CONFIG[key].fallbackCopy;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function calculateOverallRisk(scores) {
  const values = Object.values(scores);
  return clampScore(values.reduce((sum, value) => sum + value, 0) / values.length);
}

async function updateBadgeForAnalysis(analysis) {
  const risk = clampScore(analysis.overallRisk);
  const text = risk <= 33 ? "LOW" : risk <= 66 ? "MED" : "HIGH";
  await updateBadge(text, scoreToBadgeColor(risk));
}

async function updateBadge(text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
  } catch (error) {
    console.warn("Kirlia badge update failed:", error);
  }
}

function scoreToBadgeColor(score) {
  if (score <= 33) {
    return "#16a34a";
  }
  if (score <= 66) {
    return "#ea580c";
  }
  return "#dc2626";
}

function isUnsupportedUrl(url = "") {
  return /^(chrome|chrome-extension|edge|about|brave):\/\//.test(url);
}

function buildHeadline(scores) {
  const risk = calculateOverallRisk(scores);
  if (risk <= 33) {
    return "Low-risk content profile detected";
  }
  if (risk <= 66) {
    return "Mixed credibility signals detected";
  }
  return "High-risk content signals detected";
}

function buildFallbackAnalysis() {
  return (
    state.analysis ?? {
      headline: "No detailed analysis is available yet",
      issues: ["Kirlia has not received page analysis results from the content script."],
      scores: {
        ai: 0,
        manipulation: 0,
        trust: 0,
      },
      overallRisk: 0,
    }
  );
}

function createReportMarkup(analysis) {
  return `
    <div class="kirlia-overlay-section">
      <p><strong>Status:</strong> ${escapeHtml(analysis.headline)}</p>
      <p><strong>AI Detection:</strong> ${analysis.scores.ai}%</p>
      <p><strong>Manipulation:</strong> ${analysis.scores.manipulation}%</p>
      <p><strong>Domain Trust:</strong> ${analysis.scores.trust}%</p>
      <p><strong>Overall Risk:</strong> ${analysis.overallRisk}%</p>
    </div>
    <div class="kirlia-overlay-section">
      <p><strong>Issues</strong></p>
      <ul>
        ${analysis.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function openOverlay({ title, body, onOpen }) {
  closeOverlay();

  const overlay = document.createElement("div");
  overlay.id = "kirlia-overlay";
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:999",
    "display:flex",
    "align-items:flex-end",
    "justify-content:center",
    "background:rgba(2,6,23,0.72)",
    "backdrop-filter:blur(8px)",
    "padding:16px",
  ].join(";");

  overlay.innerHTML = `
    <section style="width:100%; border:1px solid rgba(148,163,184,0.18); border-radius:20px; background:#0f172a; color:#eef4ff; box-shadow:0 20px 50px rgba(0,0,0,0.35); overflow:hidden;">
      <header style="display:flex; align-items:center; justify-content:space-between; padding:16px 18px; border-bottom:1px solid rgba(148,163,184,0.16);">
        <strong>${escapeHtml(title)}</strong>
        <button id="kirlia-overlay-close" type="button" style="border:0; background:transparent; color:#eef4ff; font-size:1.2rem; cursor:pointer;">✕</button>
      </header>
      <div style="padding:16px 18px; max-height:300px; overflow:auto; line-height:1.55;">
        ${body}
      </div>
    </section>
  `;

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeOverlay();
    }
  });

  document.body.appendChild(overlay);
  document.getElementById("kirlia-overlay-close")?.addEventListener("click", closeOverlay);
  onOpen?.();
}

function closeOverlay() {
  document.getElementById("kirlia-overlay")?.remove();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}
