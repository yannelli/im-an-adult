const DEFAULT_SETTINGS = {
  blockHijacking: true,
  disableScrollEffects: true,
  disableAnimatedCursors: false,
  blockAutoplay: false,
};

const CURSOR_CANDIDATE_SELECTOR = [
  '[id*="cursor" i]',
  '[class*="cursor" i]',
  '[id*="mouse-follower" i]',
  '[class*="mouse-follower" i]',
  '[id*="pointer-follower" i]',
  '[class*="pointer-follower" i]',
  "[data-cursor]",
  "[data-cursor-element]",
  "[data-mouse-follower]",
].join(",");
const CURSOR_NAME_PATTERN =
  /(?:^|[\s_-])(?:cursor|mouse[\s_-]?(?:follower|trail)|pointer[\s_-]?(?:follower|trail))(?:$|[\s_-])/i;
const cursorOverlays = new Set();
let cursorObserver;
const settingsChannel = new MessageChannel();
window.postMessage("__ima_settings_port__", "*", [settingsChannel.port2]);

function isCursorOverlay(element) {
  const identifiers = [
    element.getAttribute?.("id"),
    element.getAttribute?.("class"),
    element.hasAttribute?.("data-cursor") ? "data-cursor" : "",
    element.hasAttribute?.("data-cursor-element") ? "data-cursor-element" : "",
    element.hasAttribute?.("data-mouse-follower") ? "data-mouse-follower" : "",
  ].join(" ");
  if (!CURSOR_NAME_PATTERN.test(identifiers)) return false;

  const style = getComputedStyle(element);
  return (
    (style.position === "fixed" || style.position === "absolute") &&
    style.pointerEvents === "none"
  );
}

function updateCursorCandidate(element) {
  if (element?.nodeType !== 1) return;

  if (isCursorOverlay(element)) {
    element.dataset.imaCursorOverlay = "true";
    cursorOverlays.add(element);
  } else if (cursorOverlays.delete(element)) {
    delete element.dataset.imaCursorOverlay;
  }
}

function scanCursorCandidates(root = document) {
  if (root.nodeType === 1 && root.matches(CURSOR_CANDIDATE_SELECTOR)) {
    updateCursorCandidate(root);
  }

  for (const element of root.querySelectorAll?.(CURSOR_CANDIDATE_SELECTOR) ?? []) {
    updateCursorCandidate(element);
  }
}

function setAnimatedCursorBlocking(active) {
  cursorObserver?.disconnect();

  if (!active) {
    for (const element of cursorOverlays) {
      delete element.dataset.imaCursorOverlay;
    }
    cursorOverlays.clear();
    return;
  }

  scanCursorCandidates();

  cursorObserver ??= new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        updateCursorCandidate(mutation.target);
        continue;
      }

      for (const node of mutation.addedNodes) {
        scanCursorCandidates(node);
      }
    }
  });
  cursorObserver.observe(document, {
    attributes: true,
    attributeFilter: [
      "class",
      "data-cursor",
      "data-cursor-element",
      "data-mouse-follower",
      "id",
      "style",
    ],
    childList: true,
    subtree: true,
  });
}

function applyRootSettings(enabled, disableScrollEffects, disableAnimatedCursors) {
  const updateRoot = () => {
    const root = document.documentElement;
    if (!root) return false;

    root.dataset.imaEnabled = String(enabled);
    root.dataset.imaDisableScrollEffects = String(disableScrollEffects);
    root.dataset.imaDisableAnimatedCursors = String(disableAnimatedCursors);
    return true;
  };

  if (updateRoot()) return;

  const observer = new MutationObserver(() => {
    if (updateRoot()) observer.disconnect();
  });
  observer.observe(document, { childList: true });
}

async function applySettings() {
  const stored = await chrome.storage.sync.get(["settings", "disabledSites"]);
  const settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  const hostname = location.hostname;
  const enabled = !stored.disabledSites?.[hostname];

  applyRootSettings(
    enabled,
    settings.disableScrollEffects,
    settings.disableAnimatedCursors,
  );
  setAnimatedCursorBlocking(enabled && settings.disableAnimatedCursors);

  settingsChannel.port1.postMessage({ ...settings, enabled });
}

applySettings();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "sync" &&
    (changes.settings || changes.disabledSites)
  ) {
    applySettings();
  }
});
