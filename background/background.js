const STORAGE_KEYS = {
  settings: "settings",
  analysisCache: "analysisCache",
};

const MENU_IDS = {
  analyzeText: "kirlia-analyze-text",
  checkLink: "kirlia-check-link",
};

const DEFAULT_SETTINGS = {
  darkMode: true,
  highlightEnabled: true,
  badgeStyle: "score",
};

const tabCache = new Map();

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  console.log("[Kirlia background] Installed:", reason);
  await initializeStorage(reason);
  await createContextMenus();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log("[Kirlia background] Startup");
  await ensureStorageShape();
  await createContextMenus();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Kirlia background] Message:", message?.type, {
    senderTabId: sender.tab?.id,
    requestedTabId: message?.tabId,
  });
  handleMessage(message, sender)
    .then((result) => sendResponse(result))
    .catch((error) => {
      console.error("Kirlia background message error:", error);
      sendResponse({
        ok: false,
        error: error.message || "Unknown background error.",
      });
    });

  return true;
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) {
    return;
  }

  try {
    if (info.menuItemId === MENU_IDS.analyzeText && info.selectionText?.trim()) {
      await chrome.tabs.sendMessage(tab.id, {
        type: "KIRLIA_ANALYZE_SELECTED_TEXT",
        payload: {
          text: info.selectionText.trim(),
        },
      });
    }

    if (info.menuItemId === MENU_IDS.checkLink && info.linkUrl) {
      await chrome.tabs.sendMessage(tab.id, {
        type: "KIRLIA_CHECK_LINK",
        payload: {
          linkUrl: info.linkUrl,
        },
      });
    }
  } catch (error) {
    console.warn("Kirlia context menu action failed:", error);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  tabCache.delete(tabId);
  await removeCachedAnalysis(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "loading") {
    return;
  }

  tabCache.delete(tabId);
  await removeCachedAnalysis(tabId);
  await clearBadge(tabId);
});

async function handleMessage(message, sender) {
  const tabId = sender.tab?.id ?? message?.tabId;

  switch (message?.type) {
    case "KIRLIA_GET_CACHED_ANALYSIS":
      return {
        ok: true,
        analysis: tabId ? await getCachedAnalysis(tabId) : null,
      };

    case "KIRLIA_CACHE_ANALYSIS": {
      if (!tabId || !message.payload) {
        return { ok: false, error: "Missing tab or analysis payload." };
      }

      const cached = {
        ...message.payload,
        cachedAt: Date.now(),
        pageKey: buildPageKey(sender.tab),
      };

      await setCachedAnalysis(tabId, cached);
      await updateBadge(tabId, cached.overallRisk ?? averageScores(cached.scores));

      return {
        ok: true,
        analysis: cached,
      };
    }

    case "KIRLIA_REQUEST_ANALYSIS": {
      if (!tabId) {
        return { ok: false, error: "Missing tab context." };
      }

      const tab = sender.tab ?? (await getTab(tabId));
      const cached = await getCachedAnalysis(tabId);
      const currentPageKey = buildPageKey(tab);

      if (cached && cached.pageKey === currentPageKey) {
        console.log("[Kirlia background] Serving cached analysis for tab:", tabId);
        return {
          ok: true,
          cached: true,
          analysis: cached,
        };
      }

      const analysis = await requestAnalysisFromContent(tabId);
      if (analysis) {
        console.log("[Kirlia background] Fresh analysis received for tab:", tabId);
        const enriched = {
          ...analysis,
          cachedAt: Date.now(),
          pageKey: currentPageKey,
        };
        await setCachedAnalysis(tabId, enriched);
        await updateBadge(tabId, enriched.overallRisk ?? averageScores(enriched.scores));
        return {
          ok: true,
          cached: false,
          analysis: enriched,
        };
      }

      return {
        ok: false,
        error: "Content script did not return analysis.",
      };
    }

    case "KIRLIA_HIGHLIGHT_SUSPICIOUS_TEXT":
      if (!tabId) {
        return { ok: false, error: "Missing tab context." };
      }
      return routeToContent(tabId, {
        type: "KIRLIA_HIGHLIGHT_SUSPICIOUS_TEXT",
      });

    case "KIRLIA_OPEN_REPORT_OVERLAY":
      if (!tabId) {
        return { ok: false, error: "Missing tab context." };
      }
      return routeToContent(tabId, {
        type: "KIRLIA_OPEN_REPORT_OVERLAY",
      });

    case "KIRLIA_CLEAR_TAB_CACHE":
      if (tabId) {
        tabCache.delete(tabId);
        await removeCachedAnalysis(tabId);
        await clearBadge(tabId);
      }
      return { ok: true };

    default:
      return { ok: false, error: "Unknown message type." };
  }
}

async function initializeStorage(reason) {
  const current = await chrome.storage.local.get([
    STORAGE_KEYS.settings,
    STORAGE_KEYS.analysisCache,
  ]);

  const patch = {};

  if (reason === "install" || !current[STORAGE_KEYS.settings]) {
    patch[STORAGE_KEYS.settings] = DEFAULT_SETTINGS;
  }

  if (reason === "install" || !current[STORAGE_KEYS.analysisCache]) {
    patch[STORAGE_KEYS.analysisCache] = {};
  }

  if (Object.keys(patch).length) {
    await chrome.storage.local.set(patch);
  }
}

async function ensureStorageShape() {
  await initializeStorage("startup");
}

async function createContextMenus() {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: MENU_IDS.analyzeText,
    title: "Analyze this text",
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id: MENU_IDS.checkLink,
    title: "Check this link",
    contexts: ["link"],
  });
}

async function requestAnalysisFromContent(tabId) {
  try {
    console.log("[Kirlia background] Forwarding analysis request to content:", tabId);
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "KIRLIA_GET_ANALYSIS",
    });
    return response?.ok ? response.analysis : response;
  } catch (error) {
    console.warn("Kirlia content analysis request failed:", error);
    return null;
  }
}

async function routeToContent(tabId, message) {
  try {
    console.log("[Kirlia background] Routing message to content:", message.type, tabId);
    const response = await chrome.tabs.sendMessage(tabId, message);
    return response?.ok === false ? response : { ok: true, ...response };
  } catch (error) {
    console.warn("Kirlia routeToContent failed:", error);
    return {
      ok: false,
      error: error.message || "Failed to communicate with page.",
    };
  }
}

async function getCachedAnalysis(tabId) {
  if (tabCache.has(tabId)) {
    return tabCache.get(tabId);
  }

  const cache = await loadPersistentCache();
  const analysis = cache[String(tabId)] ?? null;
  if (analysis) {
    tabCache.set(tabId, analysis);
  }
  return analysis;
}

async function setCachedAnalysis(tabId, analysis) {
  tabCache.set(tabId, analysis);
  const cache = await loadPersistentCache();
  const nextCache = {
    ...cache,
    [String(tabId)]: analysis,
  };
  await chrome.storage.local.set({
    [STORAGE_KEYS.analysisCache]: nextCache,
  });
}

async function removeCachedAnalysis(tabId) {
  const cache = await loadPersistentCache();
  if (!(String(tabId) in cache)) {
    return;
  }

  const nextCache = { ...cache };
  delete nextCache[String(tabId)];

  await chrome.storage.local.set({
    [STORAGE_KEYS.analysisCache]: nextCache,
  });
}

async function loadPersistentCache() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.analysisCache);
  return stored[STORAGE_KEYS.analysisCache] ?? {};
}

async function updateBadge(tabId, riskScore) {
  const score = clampScore(riskScore);
  console.log("[Kirlia background] Updating badge:", { tabId, score });

  await chrome.action.setBadgeText({
    tabId,
    text: String(score),
  });

  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: getBadgeColor(score),
  });
}

async function clearBadge(tabId) {
  try {
    await chrome.action.setBadgeText({ tabId, text: "" });
  } catch (error) {
    console.warn("Kirlia badge clear failed:", error);
  }
}

async function getTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch (error) {
    console.warn("Kirlia getTab failed:", error);
    return null;
  }
}

function getBadgeColor(score) {
  if (score <= 33) {
    return "#16a34a";
  }
  if (score <= 66) {
    return "#ea580c";
  }
  return "#dc2626";
}

function averageScores(scores = {}) {
  const values = [
    scores.ai,
    scores.manipulation,
    scores.trust,
    typeof scores.sourceTransparency === "number"
      ? 100 - scores.sourceTransparency
      : undefined,
  ]
    .filter((value) => typeof value !== "undefined")
    .map((value) => Number(value) || 0);
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function buildPageKey(tab) {
  const url = tab?.url ?? "";
  return `${tab?.id ?? "unknown"}:${url}`;
}
