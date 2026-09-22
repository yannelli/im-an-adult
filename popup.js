const DEFAULT_SETTINGS = {
  blockHijacking: true,
  disableScrollEffects: true,
  disableAnimatedCursors: false,
  blockAutoplay: false,
};

const controls = {
  blockHijacking: document.querySelector("#block-hijacking"),
  disableScrollEffects: document.querySelector("#disable-scroll-effects"),
  disableAnimatedCursors: document.querySelector("#disable-animated-cursors"),
  blockAutoplay: document.querySelector("#block-autoplay"),
};
const siteEnabled = document.querySelector("#site-enabled");
const siteName = document.querySelector("#site-name");
const sitePanel = document.querySelector("#site-panel");
const siteState = document.querySelector("#site-state");
const siteStatus = document.querySelector("#site-status");
const saveStatus = document.querySelector("#save-status");
const resetSettings = document.querySelector("#reset-settings");

const SITE_STATES = {
  active: {
    label: "Protection on",
    detail: "This site can’t interfere with scrolling.",
  },
  paused: {
    label: "Protection paused",
    detail: "This site can control scrolling.",
  },
  unavailable: {
    label: "Unavailable here",
    detail: "Chrome keeps its own pages off-limits.",
  },
};

function renderSiteState(state) {
  sitePanel.dataset.state = state;
  siteState.textContent = SITE_STATES[state].label;
  siteStatus.textContent = SITE_STATES[state].detail;
}

let statusTimer;

function showSaveStatus(message, state = "saved") {
  clearTimeout(statusTimer);
  saveStatus.textContent = message;
  saveStatus.dataset.state = state;
  if (state === "saved") {
    statusTimer = setTimeout(() => {
      saveStatus.textContent = "Up to date";
      delete saveStatus.dataset.state;
    }, 1400);
  }
}

function renderSettings() {
  for (const [key, control] of Object.entries(controls)) {
    control.checked = settings[key];
  }

  for (const group of document.querySelectorAll(".group")) {
    const enabled = group.querySelectorAll('input[role="switch"]:checked').length;
    group.querySelector(".group-count").textContent = `${enabled} on`;
  }

  resetSettings.disabled = Object.entries(DEFAULT_SETTINGS).every(
    ([key, value]) => settings[key] === value,
  );
}

let tab;

try {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
} catch {
  showSaveStatus("Couldn’t read this tab", "error");
}

let hostname = "";

try {
  const url = new URL(tab?.url);
  if (url.protocol === "http:" || url.protocol === "https:") {
    hostname = url.hostname;
  }
} catch {}

let stored = {};

try {
  stored = await chrome.storage.sync.get(["settings", "disabledSites"]);
} catch {
  showSaveStatus("Couldn’t load settings", "error");
}

let settings = { ...DEFAULT_SETTINGS, ...stored.settings };
let disabledSites = stored.disabledSites ?? {};

for (const [key, control] of Object.entries(controls)) {
  control.addEventListener("change", async () => {
    const previousSettings = settings;
    settings = { ...settings, [key]: control.checked };
    renderSettings();
    showSaveStatus("Saving…", "saving");

    try {
      await chrome.storage.sync.set({ settings });
      showSaveStatus("Saved");
    } catch {
      settings = previousSettings;
      renderSettings();
      showSaveStatus("Change wasn’t saved", "error");
    }
  });
}

resetSettings.addEventListener("click", async () => {
  const previousSettings = settings;
  settings = { ...DEFAULT_SETTINGS };
  renderSettings();
  showSaveStatus("Saving…", "saving");

  try {
    await chrome.storage.sync.set({ settings });
    showSaveStatus("Defaults restored");
  } catch {
    settings = previousSettings;
    renderSettings();
    showSaveStatus("Defaults weren’t restored", "error");
  }
});

renderSettings();

if (hostname) {
  siteName.textContent = hostname;
  siteEnabled.checked = !disabledSites[hostname];
  renderSiteState(siteEnabled.checked ? "active" : "paused");
  siteEnabled.addEventListener("change", async () => {
    const previousDisabledSites = disabledSites;
    renderSiteState(siteEnabled.checked ? "active" : "paused");
    disabledSites = { ...disabledSites };
    if (siteEnabled.checked) {
      delete disabledSites[hostname];
    } else {
      disabledSites[hostname] = true;
    }
    showSaveStatus("Saving…", "saving");

    try {
      await chrome.storage.sync.set({ disabledSites });
      showSaveStatus("Saved");
    } catch {
      disabledSites = previousDisabledSites;
      siteEnabled.checked = !disabledSites[hostname];
      renderSiteState(siteEnabled.checked ? "active" : "paused");
      showSaveStatus("Change wasn’t saved", "error");
    }
  });
} else {
  siteName.textContent = "Not a website";
  siteEnabled.checked = false;
  siteEnabled.disabled = true;
  renderSiteState("unavailable");
}
