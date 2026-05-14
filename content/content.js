let detectorsPromise = null;
let analysisState = {
  pageKey: getPageKey(),
  analysis: null,
  highlighted: false,
};

console.log("[Kirlia content] Loaded:", window.location.href);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Kirlia content] Message:", message?.type, { senderId: sender.id });

  handleMessage(message)
    .then((result) => sendResponse(result))
    .catch((error) => {
      console.error("[Kirlia content] Handler failed:", error);
      sendResponse({
        ok: false,
        error: error.message || "Content script error.",
      });
    });

  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "KIRLIA_GET_ANALYSIS":
      return {
        ok: true,
        analysis: await getOrRunAnalysis(),
      };

    case "KIRLIA_HIGHLIGHT_SUSPICIOUS_TEXT": {
      const analysis = await getOrRunAnalysis();
      const highlightedCount = highlightSuspiciousText(analysis.flaggedSentences ?? []);
      return {
        ok: true,
        highlightedCount,
      };
    }

    case "KIRLIA_OPEN_REPORT_OVERLAY":
      renderReportOverlay(await getOrRunAnalysis());
      return { ok: true };

    case "KIRLIA_ANALYZE_SELECTED_TEXT": {
      const { runFullAnalysis } = await loadDetectors();
      const analysis = runFullAnalysis({
        text: message?.payload?.text ?? "",
        url: window.location.href,
        title: document.title,
        domain: window.location.hostname,
      });
      renderMiniToast(`Selection risk score: ${analysis.overallRisk}`);
      return { ok: true, analysis };
    }

    case "KIRLIA_CHECK_LINK": {
      const { analyzeDomain } = await loadDetectors();
      const analysis = analyzeDomain(extractDomain(message?.payload?.linkUrl ?? ""));
      renderMiniToast(`Link risk score: ${analysis.score}`);
      return { ok: true, analysis };
    }

    default:
      return {
        ok: false,
        error: "Unknown content message type.",
      };
  }
}

async function getOrRunAnalysis() {
  const currentPageKey = getPageKey();
  if (analysisState.analysis && analysisState.pageKey === currentPageKey) {
    console.log("[Kirlia content] Returning existing page analysis.");
    return analysisState.analysis;
  }

  const { runFullAnalysis } = await loadDetectors();
  const analysis = runFullAnalysis({
    text: getPageText(),
    url: window.location.href,
    title: document.title,
    domain: window.location.hostname,
  });

  analysisState = {
    pageKey: currentPageKey,
    analysis,
    highlighted: false,
  };

  console.log("[Kirlia content] Analysis completed:", analysis);

  try {
    await sendRuntimeMessage({
      type: "KIRLIA_CACHE_ANALYSIS",
      payload: analysis,
    });
  } catch (error) {
    console.warn("[Kirlia content] Background cache update failed:", error);
  }

  return analysis;
}

async function loadDetectors() {
  if (!detectorsPromise) {
    console.log("[Kirlia content] Importing detectors module.");
    detectorsPromise = import(chrome.runtime.getURL("utils/detectors.js"));
  }
  return detectorsPromise;
}

function getPageText() {
  return (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 50000);
}

function highlightSuspiciousText(flaggedSentences) {
  clearHighlights();
  const snippets = flaggedSentences
    .map((item) => item?.sentence?.trim())
    .filter((sentence) => sentence && sentence.length > 24)
    .slice(0, 8);

  let highlightedCount = 0;
  snippets.forEach((snippet) => {
    highlightedCount += highlightSnippet(snippet);
  });

  analysisState.highlighted = highlightedCount > 0;
  renderMiniToast(
    highlightedCount
      ? `Highlighted ${highlightedCount} suspicious passage(s).`
      : "No matching suspicious text found to highlight.",
  );
  console.log("[Kirlia content] Highlight result:", highlightedCount);
  return highlightedCount;
}

function highlightSnippet(snippet) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      if (node.parentElement?.closest("[data-kirlia-overlay-root]")) {
        return NodeFilter.FILTER_REJECT;
      }
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"].includes(node.parentElement?.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const target = snippet.toLowerCase();
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.nodeValue || "";
    const index = text.toLowerCase().indexOf(target);
    if (index === -1) {
      continue;
    }

    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, Math.min(text.length, index + snippet.length));
    const mark = document.createElement("mark");
    mark.dataset.kirliaHighlight = "true";
    mark.style.background = "rgba(239, 68, 68, 0.3)";
    mark.style.color = "inherit";
    mark.style.padding = "0 0.08em";
    range.surroundContents(mark);
    return 1;
  }

  return 0;
}

function clearHighlights() {
  document.querySelectorAll("mark[data-kirlia-highlight='true']").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) {
      return;
    }
    parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
    parent.normalize();
  });
}

function renderReportOverlay(analysis) {
  closeOverlay();

  const overlay = document.createElement("div");
  overlay.dataset.kirliaOverlayRoot = "true";
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    "display:flex",
    "align-items:flex-end",
    "justify-content:center",
    "padding:20px",
    "background:rgba(2,6,23,0.64)",
    "backdrop-filter:blur(6px)",
  ].join(";");

  overlay.innerHTML = `
    <section style="width:min(720px,100%); max-height:80vh; overflow:auto; border-radius:20px; background:#0f172a; color:#eef4ff; border:1px solid rgba(148,163,184,0.18); box-shadow:0 24px 60px rgba(0,0,0,0.35); font:14px/1.5 Arial,sans-serif;">
      <header style="display:flex; align-items:center; justify-content:space-between; padding:16px 18px; border-bottom:1px solid rgba(148,163,184,0.16);">
        <strong>Kirlia Report</strong>
        <button id="kirlia-page-overlay-close" type="button" style="border:0; background:transparent; color:#eef4ff; font-size:20px; cursor:pointer;">✕</button>
      </header>
      <div style="padding:18px;">
        <p><strong>Overall risk:</strong> ${analysis.overallRisk}%</p>
        <p><strong>AI detection:</strong> ${analysis.scores.ai}%</p>
        <p><strong>Manipulation:</strong> ${analysis.scores.manipulation}%</p>
        <p><strong>Domain trust risk:</strong> ${analysis.scores.trust}%</p>
        <h3>Issues</h3>
        <ul>${(analysis.issues || []).map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>
      </div>
    </section>
  `;

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeOverlay();
    }
  });

  document.body.appendChild(overlay);
  document.getElementById("kirlia-page-overlay-close")?.addEventListener("click", closeOverlay);
  console.log("[Kirlia content] Report overlay opened.");
}

function closeOverlay() {
  document.querySelector("[data-kirlia-overlay-root='true']")?.remove();
}

function renderMiniToast(message) {
  document.getElementById("kirlia-mini-toast")?.remove();
  const toast = document.createElement("div");
  toast.id = "kirlia-mini-toast";
  toast.dataset.kirliaOverlayRoot = "true";
  toast.textContent = message;
  toast.style.cssText = [
    "position:fixed",
    "right:20px",
    "bottom:20px",
    "z-index:2147483647",
    "padding:10px 14px",
    "border-radius:12px",
    "background:#0f172a",
    "color:#eef4ff",
    "border:1px solid rgba(148,163,184,0.18)",
    "box-shadow:0 16px 40px rgba(0,0,0,0.28)",
    "font:13px/1.4 Arial,sans-serif",
  ].join(";");
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2600);
}

function getPageKey() {
  return `${window.location.href}::${document.title}`;
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
