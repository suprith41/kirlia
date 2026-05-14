import { compareFingerprints } from "../utils/fingerprint.js";

const FINGERPRINT_HISTORY_KEY = "kirliaFingerprintHistory";
const MAX_FINGERPRINT_HISTORY = 5;

const SCORE_CONFIG = {
  ai: {
    ringId: "ai-score-ring",
    valueId: "ai-score-value",
    copyId: "ai-score-copy",
    label: "AI Detection Score",
    fallbackCopy: "No AI content markers detected yet.",
    higherIsBetter: false,
  },
  manipulation: {
    ringId: "manipulation-score-ring",
    valueId: "manipulation-score-value",
    copyId: "manipulation-score-copy",
    label: "Manipulation Score",
    fallbackCopy: "No emotional manipulation signals detected yet.",
    higherIsBetter: false,
  },
  trust: {
    ringId: "trust-score-ring",
    valueId: "trust-score-value",
    copyId: "trust-score-copy",
    label: "Domain Trust Score",
    fallbackCopy: "No domain trust data available yet.",
    higherIsBetter: false,
  },
  sourceTransparency: {
    ringId: "source-transparency-score-ring",
    valueId: "source-transparency-score-value",
    copyId: "source-transparency-score-copy",
    label: "Source Transparency Score",
    fallbackCopy: "No citation transparency data available yet.",
    higherIsBetter: true,
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
  sourceTransparency: {
    safe: "Well-sourced journalism with clear citation signals.",
    caution: "Some sources are present, but citation coverage is incomplete.",
    danger: "No sources or weak citation support for factual claims.",
  },
};

const state = {
  activeTab: null,
  analysis: null,
  isDarkMode: true,
};

let emotionTimelineChart = null;
let fallbackTimelineHoverCleanup = null;

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
  await rememberCurrentFingerprint(state.analysis);
  await updateBadgeForAnalysis(state.analysis);
}

function bindEventListeners() {
  document.querySelectorAll(".mode-toggle, .icon-button, .action-button").forEach((button) => {
    button.addEventListener("pointermove", updateInteractionOrigin);
  });

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

  document
    .getElementById("compare-fingerprint-button")
    ?.addEventListener("click", handleFingerprintCompare);

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
  syncThemeToggle();
}

function applyLoadingState() {
  setStatus("Analyzing active page...", "loading");
  updateHeadline("Scanning page for AI and credibility signals");
  renderIssues(["Loading analysis results..."]);
  renderFingerprintStatus("Preparing writing style fingerprint...");

  Object.entries(SCORE_CONFIG).forEach(([key, config]) => {
    updateScoreCard(key, 0, config.fallbackCopy);
  });
  renderEmotionTimeline(null);
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
    sourceTransparency: clampScore(analysis?.scores?.sourceTransparency ?? 0),
  };

  const issues = Array.isArray(analysis?.issues)
    ? analysis.issues.filter(Boolean)
    : [];

  return {
    headline:
      analysis?.headline ??
      buildHeadline(scores),
    status: analysis?.status ?? "ready",
    title: analysis?.title ?? "",
    url: analysis?.url ?? state.activeTab?.url ?? "",
    domain: analysis?.domain ?? "",
    issues,
    scores,
    citationAnalysis: normalizeCitationAnalysis(analysis?.citationAnalysis),
    emotionTimeline: normalizeEmotionTimeline(analysis?.emotionTimeline),
    writingFingerprint: analysis?.writingFingerprint ?? null,
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
    const copy =
      key === "sourceTransparency"
        ? getCitationScoreCopy(analysis.citationAnalysis, value)
        : getScoreCopy(key, value);
    updateScoreCard(key, value, copy);
    animateScore(key, value);
  });

  if (analysis.issues.length === 0) {
    renderIssues(["No clear issues detected on this page yet."]);
  } else {
    renderIssues(analysis.issues);
  }

  renderEmotionTimeline(analysis.emotionTimeline);
  renderFingerprintStatus("Compare this article against your last 5 local fingerprints.");
}

function renderUnavailableState() {
  setStatus("No saved analysis was returned for this page.", "unavailable");
  updateHeadline("Analysis not available yet");
  renderIssues([
    "The content script did not return analysis data.",
    "Open a standard webpage and try again after the page finishes loading.",
  ]);
  renderEmotionTimeline(null);
  renderFingerprintStatus("No writing fingerprint is available for this page.");
}

function renderUnsupportedState(url) {
  setStatus("This page cannot be analyzed by Chrome extensions.", "unsupported");
  updateHeadline("Analysis is disabled on this page");
  renderIssues([
    "Chrome blocks content scripts on internal browser pages.",
    `Unsupported URL: ${url ?? "Unknown page"}`,
  ]);
  renderEmotionTimeline(null);
  renderFingerprintStatus("Writing style comparison is unavailable on this page.");
}

function renderErrorState(message) {
  setStatus(message, "error");
  updateHeadline("Kirlia hit an unexpected error");
  renderIssues([
    "Reload the page and reopen the popup.",
    "If the problem persists, inspect the extension console for details.",
  ]);
  renderEmotionTimeline(null);
  renderFingerprintStatus("Writing style comparison could not load.");
}

function updateScoreCard(key, score, copy) {
  const config = SCORE_CONFIG[key];
  const ring = document.getElementById(config.ringId);
  const valueNode = document.getElementById(config.valueId);
  const copyNode = document.getElementById(config.copyId);
  const card = document.querySelector(`[data-score-card="${key}"]`);
  const level = getLevel(score, config.higherIsBetter);
  const color = getColor(score, config.higherIsBetter);

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
  const color = getColor(target, SCORE_CONFIG[key]?.higherIsBetter);

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

function normalizeCitationAnalysis(citationAnalysis) {
  const metrics = citationAnalysis?.metrics ?? {};
  return {
    score: clampScore(citationAnalysis?.score ?? 0),
    summary:
      citationAnalysis?.summary ??
      "No citation transparency data is available for this article.",
    citedSentences: Array.isArray(citationAnalysis?.citedSentences)
      ? citationAnalysis.citedSentences
      : [],
    uncitedClaimSentences: Array.isArray(citationAnalysis?.uncitedClaimSentences)
      ? citationAnalysis.uncitedClaimSentences
      : [],
    metrics: {
      externalLinkCount: Number(metrics.externalLinkCount ?? 0),
      credibleSourceCount: Number(metrics.credibleSourceCount ?? 0),
      suspiciousLinkCount: Number(metrics.suspiciousLinkCount ?? 0),
      uncitedClaimCount: Number(metrics.uncitedClaimCount ?? 0),
      citationPatternCount: Number(metrics.citationPatternCount ?? 0),
    },
  };
}

function getCitationScoreCopy(citationAnalysis, score) {
  const metrics = citationAnalysis?.metrics ?? {};
  const sourceCount = metrics.externalLinkCount ?? 0;
  const suspiciousCount = metrics.suspiciousLinkCount ?? 0;
  const sourceLabel = `${sourceCount} external source${sourceCount === 1 ? "" : "s"}`;
  const suspiciousLabel = `${suspiciousCount} suspicious link${suspiciousCount === 1 ? "" : "s"}`;
  if (score <= 33) {
    return `${sourceLabel}, ${suspiciousLabel}. No sources, trust-me-bro article.`;
  }
  if (score <= 66) {
    return `${sourceLabel}, ${suspiciousLabel}. Some sources but incomplete.`;
  }
  return `${sourceLabel}, ${suspiciousLabel}. Well-sourced journalism.`;
}

async function handleFingerprintCompare() {
  const current = state.analysis;
  if (!current?.writingFingerprint) {
    renderFingerprintStatus("No writing fingerprint is available for this article.");
    return;
  }

  const history = await loadFingerprintHistory();
  const currentId = getFingerprintEntryId(current);
  const previousEntries = history.filter((entry) => entry.id !== currentId);

  if (!previousEntries.length) {
    renderFingerprintStatus(
      "No previous article fingerprints yet. Kirlia will compare after you read more pages.",
    );
    return;
  }

  const bestMatch = previousEntries
    .map((entry) => ({
      ...entry,
      similarity: compareFingerprints(current.writingFingerprint, entry.fingerprint),
    }))
    .sort((a, b) => b.similarity - a.similarity)[0];

  if (!bestMatch || bestMatch.similarity < 68) {
    renderFingerprintStatus(
      "No strong writing-style match found in your last 5 analyzed articles.",
    );
    return;
  }

  renderFingerprintStatus(
    `This writing style matches article you read ${formatRelativeTime(bestMatch.analyzedAt)} (${bestMatch.similarity}% similarity).`,
    true,
  );
}

async function rememberCurrentFingerprint(analysis) {
  if (!analysis?.writingFingerprint) {
    return;
  }

  const history = await loadFingerprintHistory();
  const entry = buildFingerprintHistoryEntry(analysis);
  const nextHistory = [
    entry,
    ...history.filter((item) => item.id !== entry.id),
  ].slice(0, MAX_FINGERPRINT_HISTORY);

  await chrome.storage.local.set({
    [FINGERPRINT_HISTORY_KEY]: nextHistory,
  });
}

async function loadFingerprintHistory() {
  try {
    const stored = await chrome.storage.local.get(FINGERPRINT_HISTORY_KEY);
    return Array.isArray(stored[FINGERPRINT_HISTORY_KEY])
      ? stored[FINGERPRINT_HISTORY_KEY].filter((entry) => entry?.fingerprint)
      : [];
  } catch (error) {
    console.warn("Kirlia fingerprint history load failed:", error);
    return [];
  }
}

function buildFingerprintHistoryEntry(analysis) {
  return {
    id: getFingerprintEntryId(analysis),
    title: analysis.title,
    url: analysis.url,
    domain: analysis.domain,
    analyzedAt: Date.now(),
    fingerprint: analysis.writingFingerprint,
  };
}

function getFingerprintEntryId(analysis) {
  return `${analysis.url || "unknown"}:${analysis.writingFingerprint?.signature || "none"}`;
}

function renderFingerprintStatus(message, isMatch = false) {
  const summary = document.getElementById("fingerprint-summary");
  if (!summary) {
    return;
  }

  summary.textContent = message;
  summary.classList.toggle("is-match", isMatch);
}

function formatRelativeTime(timestamp) {
  const elapsedMs = Math.max(0, Date.now() - Number(timestamp || 0));
  const minutes = Math.max(1, Math.round(elapsedMs / 60000));
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function renderEmotionTimeline(timeline) {
  const canvas = document.getElementById("emotion-timeline-chart");
  const summary = document.getElementById("timeline-summary");
  const pattern = document.getElementById("timeline-pattern");
  if (!canvas || !summary || !pattern) {
    return;
  }

  destroyEmotionTimelineChart();
  clearTimelineTooltip();

  if (!timeline?.scores?.length) {
    pattern.textContent = "No data";
    pattern.classList.remove("is-danger");
    summary.textContent = "Not enough article text to build an emotion timeline.";
    drawEmptyTimeline(canvas);
    return;
  }

  pattern.textContent = timeline.hasManipulationPattern ? "Pattern detected" : "Stable";
  pattern.classList.toggle("is-danger", timeline.hasManipulationPattern);
  summary.textContent = timeline.summary;

  if (window.Chart) {
    drawEmotionTimelineWithChartJs(canvas, timeline);
    return;
  }

  drawEmotionTimelineFallback(canvas, timeline);
}

function drawEmotionTimelineWithChartJs(canvas, timeline) {
  const context = canvas.getContext("2d");
  const labels = timeline.scores.map((_, index) => `Sentence ${index + 1}`);

  emotionTimelineChart = new window.Chart(context, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Emotion intensity",
          data: timeline.scores,
          borderColor(chartContext) {
            const { chart } = chartContext;
            const { ctx, chartArea } = chart;
            return chartArea ? createEmotionGradient(ctx, chartArea) : getCssVar("--accent");
          },
          backgroundColor(chartContext) {
            const { chart } = chartContext;
            const { ctx, chartArea } = chart;
            return chartArea
              ? createEmotionFillGradient(ctx, chartArea)
              : "rgba(98, 230, 255, 0.12)";
          },
          borderWidth: 3,
          cubicInterpolationMode: "monotone",
          fill: true,
          tension: 0.42,
          pointRadius: timeline.scores.map((score, index) =>
            timeline.spikeIndexes.includes(index) || score >= 8 ? 5 : 3,
          ),
          pointHoverRadius: 7,
          pointBackgroundColor: timeline.scores.map(scoreToEmotionColor),
          pointBorderColor: "rgba(255, 255, 255, 0.86)",
          pointBorderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: "index",
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Sentence number",
            color: getCssVar("--muted"),
          },
          grid: {
            color: "rgba(255, 255, 255, 0.08)",
          },
          ticks: {
            color: getCssVar("--muted"),
            maxTicksLimit: 6,
          },
        },
        y: {
          min: 0,
          max: 10,
          title: {
            display: true,
            text: "Emotion intensity",
            color: getCssVar("--muted"),
          },
          grid: {
            color: "rgba(255, 255, 255, 0.09)",
          },
          ticks: {
            stepSize: 2,
            color: getCssVar("--muted"),
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: false,
          external(context) {
            const point = context.tooltip?.dataPoints?.[0];
            if (!point) {
              clearTimelineTooltip();
              return;
            }

            const index = point.dataIndex;
            showTimelineTooltip({
              title: `Sentence ${index + 1}: ${timeline.scores[index]}/10`,
              sentence: timeline.sentences[index] ?? "Sentence text unavailable.",
              isSpike: timeline.spikeIndexes.includes(index),
            });
          },
        },
      },
    },
  });
}

function drawEmotionTimelineFallback(canvas, timeline) {
  const context = canvas.getContext("2d");
  const bounds = resizeCanvasForDpr(canvas, context);
  const plot = {
    left: 34,
    right: bounds.width - 14,
    top: 16,
    bottom: bounds.height - 26,
  };

  context.clearRect(0, 0, bounds.width, bounds.height);
  drawTimelineGrid(context, plot);
  drawTimelineLine(context, plot, timeline);
  bindFallbackTimelineHover(canvas, plot, timeline);
}

function drawEmptyTimeline(canvas) {
  const context = canvas.getContext("2d");
  const bounds = resizeCanvasForDpr(canvas, context);
  context.clearRect(0, 0, bounds.width, bounds.height);
  context.fillStyle = getCssVar("--muted");
  context.font = "13px Avenir Next, sans-serif";
  context.textAlign = "center";
  context.fillText("No timeline data yet", bounds.width / 2, bounds.height / 2);
}

function destroyEmotionTimelineChart() {
  if (emotionTimelineChart) {
    emotionTimelineChart.destroy();
    emotionTimelineChart = null;
  }

  fallbackTimelineHoverCleanup?.();
  fallbackTimelineHoverCleanup = null;
}

function normalizeEmotionTimeline(timeline) {
  const rawScores = Array.isArray(timeline) ? timeline : timeline?.scores;
  const scores = Array.isArray(rawScores)
    ? rawScores.map((score) => Math.max(0, Math.min(10, Number(score) || 0)))
    : [];
  const sentences = Array.isArray(timeline?.sentences)
    ? timeline.sentences.map((sentence) => String(sentence ?? ""))
    : scores.map((_, index) => `Sentence ${index + 1}`);
  const spikeIndexes = Array.isArray(timeline?.spikeIndexes)
    ? timeline.spikeIndexes.filter((index) => Number.isInteger(index))
    : detectTimelineSpikes(scores);
  const hasRisingPattern = detectRisingEmotionPattern(scores);

  return {
    scores,
    sentences,
    spikeIndexes,
    hasManipulationPattern:
      Boolean(timeline?.hasManipulationPattern) ||
      spikeIndexes.length >= 2 ||
      hasRisingPattern,
    summary:
      timeline?.summary ??
      buildTimelineSummary(scores, spikeIndexes, hasRisingPattern),
  };
}

function detectTimelineSpikes(scores) {
  return scores.reduce((spikes, score, index) => {
    if (index > 0 && score >= 6 && score - scores[index - 1] >= 3) {
      spikes.push(index);
    }
    return spikes;
  }, []);
}

function detectRisingEmotionPattern(scores) {
  if (scores.length < 5) {
    return false;
  }

  const segmentSize = Math.max(2, Math.floor(scores.length / 3));
  const earlyAverage = average(scores.slice(0, segmentSize));
  const lateAverage = average(scores.slice(-segmentSize));
  return lateAverage - earlyAverage >= 2;
}

function buildTimelineSummary(scores, spikeIndexes, hasRisingPattern) {
  if (!scores.length) {
    return "Not enough article text to build an emotion timeline.";
  }
  if (hasRisingPattern) {
    return "Emotional intensity rises through the article, which can indicate manipulation.";
  }
  if (spikeIndexes.length) {
    return `${spikeIndexes.length} sudden emotional spike(s) detected.`;
  }
  return "Emotional intensity stays relatively steady across the article.";
}

function createEmotionGradient(context, chartArea) {
  const gradient = context.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
  gradient.addColorStop(0, getCssVar("--safe"));
  gradient.addColorStop(0.5, getCssVar("--caution"));
  gradient.addColorStop(1, getCssVar("--danger"));
  return gradient;
}

function createEmotionFillGradient(context, chartArea) {
  const gradient = context.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
  gradient.addColorStop(0, "rgba(53, 246, 164, 0.05)");
  gradient.addColorStop(0.56, "rgba(255, 209, 102, 0.12)");
  gradient.addColorStop(1, "rgba(255, 59, 104, 0.28)");
  return gradient;
}

function drawTimelineGrid(context, plot) {
  context.strokeStyle = "rgba(255, 255, 255, 0.1)";
  context.lineWidth = 1;
  context.font = "11px Avenir Next, sans-serif";
  context.fillStyle = getCssVar("--muted");

  for (let value = 0; value <= 10; value += 2) {
    const y = mapTimelineY(value, plot);
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.right, y);
    context.stroke();
    context.fillText(String(value), 10, y + 4);
  }
}

function drawTimelineLine(context, plot, timeline) {
  if (!timeline.scores.length) {
    return;
  }

  const gradient = context.createLinearGradient(plot.left, 0, plot.right, 0);
  gradient.addColorStop(0, getCssVar("--safe"));
  gradient.addColorStop(0.55, getCssVar("--caution"));
  gradient.addColorStop(1, getCssVar("--danger"));

  context.lineWidth = 3;
  context.strokeStyle = gradient;
  context.beginPath();
  timeline.scores.forEach((score, index) => {
    const point = getTimelinePoint(index, score, timeline.scores.length, plot);
    if (index === 0) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });
  context.stroke();

  timeline.scores.forEach((score, index) => {
    const point = getTimelinePoint(index, score, timeline.scores.length, plot);
    const isSpike = timeline.spikeIndexes.includes(index) || score >= 8;
    context.beginPath();
    context.fillStyle = scoreToEmotionColor(score);
    context.shadowColor = isSpike
      ? "rgba(255, 23, 77, 0.7)"
      : "rgba(98, 230, 255, 0.25)";
    context.shadowBlur = isSpike ? 14 : 5;
    context.arc(point.x, point.y, isSpike ? 5 : 3.5, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
  });
}

function bindFallbackTimelineHover(canvas, plot, timeline) {
  const ratio = window.devicePixelRatio || 1;
  const cssPlot = {
    ...plot,
    left: plot.left / ratio,
    right: plot.right / ratio,
  };
  const handlePointerMove = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const index = getNearestTimelineIndex(x, timeline.scores.length, cssPlot);

    if (index < 0) {
      clearTimelineTooltip();
      return;
    }

    showTimelineTooltip({
      title: `Sentence ${index + 1}: ${timeline.scores[index]}/10`,
      sentence: timeline.sentences[index] ?? "Sentence text unavailable.",
      isSpike: timeline.spikeIndexes.includes(index),
    });
  };
  const handlePointerLeave = () => clearTimelineTooltip();

  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerleave", handlePointerLeave);
  fallbackTimelineHoverCleanup = () => {
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerleave", handlePointerLeave);
  };
}

function showTimelineTooltip({ title, sentence, isSpike }) {
  const tooltip = document.getElementById("timeline-tooltip");
  if (!tooltip) {
    return;
  }

  tooltip.innerHTML = `
    <strong>${escapeHtml(title)}${isSpike ? " · spike" : ""}</strong><br />
    ${escapeHtml(truncateText(sentence, 150))}
  `;
  tooltip.classList.add("is-visible");
}

function clearTimelineTooltip() {
  const tooltip = document.getElementById("timeline-tooltip");
  if (!tooltip) {
    return;
  }

  tooltip.textContent = "";
  tooltip.classList.remove("is-visible");
}

function resizeCanvasForDpr(canvas, context) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  canvas.width = width;
  canvas.height = height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  return { width, height };
}

function getTimelinePoint(index, score, count, plot) {
  const denominator = Math.max(count - 1, 1);
  return {
    x: plot.left + ((plot.right - plot.left) * index) / denominator,
    y: mapTimelineY(score, plot),
  };
}

function getNearestTimelineIndex(x, count, plot) {
  if (!count || x < plot.left - 14 || x > plot.right + 14) {
    return -1;
  }

  const ratio = (x - plot.left) / Math.max(plot.right - plot.left, 1);
  return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
}

function mapTimelineY(value, plot) {
  return plot.bottom - ((plot.bottom - plot.top) * value) / 10;
}

function scoreToEmotionColor(score) {
  if (score >= 7) {
    return getCssVar("--danger");
  }
  if (score >= 4) {
    return getCssVar("--caution");
  }
  return getCssVar("--safe");
}

function getCssVar(name) {
  const source = document.querySelector(".popup") ?? document.documentElement;
  return getComputedStyle(source).getPropertyValue(name).trim();
}

function truncateText(text, maxLength) {
  const value = String(text ?? "");
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
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
  syncThemeToggle();
  renderEmotionTimeline(state.analysis?.emotionTimeline ?? null);
}

function syncThemeToggle() {
  const toggle = document.getElementById("theme-toggle");
  if (!toggle) {
    return;
  }

  toggle.setAttribute("aria-pressed", String(state.isDarkMode));
  toggle.setAttribute(
    "aria-label",
    state.isDarkMode ? "Switch to light mode" : "Switch to dark mode",
  );
}

function updateInteractionOrigin(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;
  event.currentTarget.style.setProperty("--x", `${x}%`);
  event.currentTarget.style.setProperty("--y", `${y}%`);
}

function getLevel(score, higherIsBetter = false) {
  if (higherIsBetter) {
    if (score >= 67) {
      return "safe";
    }
    if (score >= 34) {
      return "caution";
    }
    return "danger";
  }

  if (score <= 33) {
    return "safe";
  }
  if (score <= 66) {
    return "caution";
  }
  return "danger";
}

function getColor(score, higherIsBetter = false) {
  return `var(--${getLevel(score, higherIsBetter)})`;
}

function getScoreCopy(key, score) {
  return (
    COPY_BY_SCORE[key]?.[getLevel(score, SCORE_CONFIG[key]?.higherIsBetter)] ??
    SCORE_CONFIG[key].fallbackCopy
  );
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function calculateOverallRisk(scores) {
  const riskValues = [
    scores.ai ?? 0,
    scores.manipulation ?? 0,
    scores.trust ?? 0,
    100 - (scores.sourceTransparency ?? 0),
  ];
  return clampScore(
    riskValues.reduce((sum, value) => sum + value, 0) / riskValues.length,
  );
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
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
        sourceTransparency: 0,
      },
      citationAnalysis: {
        score: 0,
        summary: "No citation transparency data is available for this article.",
        citedSentences: [],
        uncitedClaimSentences: [],
        metrics: {
          externalLinkCount: 0,
          credibleSourceCount: 0,
          suspiciousLinkCount: 0,
          uncitedClaimCount: 0,
          citationPatternCount: 0,
        },
      },
      emotionTimeline: {
        scores: [],
        sentences: [],
        spikeIndexes: [],
        hasManipulationPattern: false,
        summary: "Not enough article text to build an emotion timeline.",
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
      <p><strong>Source Transparency:</strong> ${analysis.scores.sourceTransparency}%</p>
      <p><strong>Overall Risk:</strong> ${analysis.overallRisk}%</p>
      <p><strong>Sources:</strong> ${escapeHtml(analysis.citationAnalysis?.summary ?? "No citation data.")}</p>
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
