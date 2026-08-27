const DEFAULT_SETTINGS = {
  blockHijacking: true,
  disableScrollEffects: true,
  blockAutoplay: false,
};

const controls = {
  blockHijacking: document.querySelector("#block-hijacking"),
  disableScrollEffects: document.querySelector("#disable-scroll-effects"),
  blockAutoplay: document.querySelector("#block-autoplay"),
};
const siteEnabled = document.querySelector("#site-enabled");
const siteName = document.querySelector("#site-name");
const sitePanel = document.querySelector("#site-panel");
const siteStatus = document.querySelector("#site-status");

const SITE_STATES = {
  active: "Under your control.",
  paused: "Doing whatever it wants.",
  unavailable: "Chrome keeps its own pages off-limits.",
};

function renderSiteState(state) {
  sitePanel.dataset.state = state;
  siteStatus.textContent = SITE_STATES[state];
}

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let hostname = "";

try {
  const url = new URL(tab.url);
  if (url.protocol === "http:" || url.protocol === "https:") {
    hostname = url.hostname;
  }
} catch {}

const stored = await chrome.storage.sync.get(["settings", "disabledSites"]);
let settings = { ...DEFAULT_SETTINGS, ...stored.settings };
let disabledSites = stored.disabledSites ?? {};

for (const [key, control] of Object.entries(controls)) {
  control.checked = settings[key];
  control.addEventListener("change", async () => {
    settings = { ...settings, [key]: control.checked };
    await chrome.storage.sync.set({ settings });
  });
}

if (hostname) {
  siteName.textContent = hostname;
  siteEnabled.checked = !disabledSites[hostname];
  renderSiteState(siteEnabled.checked ? "active" : "paused");
  siteEnabled.addEventListener("change", async () => {
    renderSiteState(siteEnabled.checked ? "active" : "paused");
    disabledSites = { ...disabledSites };
    if (siteEnabled.checked) {
      delete disabledSites[hostname];
    } else {
      disabledSites[hostname] = true;
    }
    await chrome.storage.sync.set({ disabledSites });
  });
} else {
  siteName.textContent = "Not a website";
  siteEnabled.checked = false;
  siteEnabled.disabled = true;
  renderSiteState("unavailable");
}
