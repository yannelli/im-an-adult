const DEFAULT_SETTINGS = {
  blockHijacking: true,
  disableScrollEffects: true,
  blockAutoplay: false,
};

function applyRootSettings(enabled, disableScrollEffects) {
  const updateRoot = () => {
    const root = document.documentElement;
    if (!root) return false;

    root.dataset.imaEnabled = String(enabled);
    root.dataset.imaDisableScrollEffects = String(disableScrollEffects);
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

  applyRootSettings(enabled, settings.disableScrollEffects);

  window.dispatchEvent(
    new CustomEvent("__ima_settings__", {
      detail: { ...settings, enabled },
    }),
  );
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
