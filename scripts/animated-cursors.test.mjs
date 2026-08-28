import assert from "node:assert/strict";
import test from "node:test";

function createControl() {
  const listeners = new Map();

  return {
    checked: false,
    dataset: {},
    disabled: false,
    textContent: "",
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    async dispatch(type) {
      await listeners.get(type)?.();
    },
  };
}

function createElement({ id = "", className = "", position = "static", pointerEvents = "auto" } = {}) {
  return {
    nodeType: 1,
    id,
    className,
    dataset: {},
    computedStyle: { position, pointerEvents },
    getAttribute(name) {
      if (name === "id") return id;
      if (name === "class") return className;
      return null;
    },
    matches() {
      return true;
    },
    querySelectorAll() {
      return [];
    },
  };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("the popup persists the animated-cursor preference", async () => {
  const selectors = [
    "#block-hijacking",
    "#disable-scroll-effects",
    "#block-autoplay",
    "#disable-animated-cursors",
    "#site-enabled",
    "#site-name",
    "#site-panel",
    "#site-status",
  ];
  const controls = new Map(selectors.map((selector) => [selector, createControl()]));
  const writes = [];

  globalThis.document = {
    querySelector(selector) {
      return controls.get(selector);
    },
  };
  globalThis.chrome = {
    tabs: {
      async query() {
        return [{ url: "https://example.com/page" }];
      },
    },
    storage: {
      sync: {
        async get() {
          return {};
        },
        async set(value) {
          writes.push(structuredClone(value));
        },
      },
    },
  };

  try {
    await import(`../popup.js?test=${Date.now()}`);

    const animatedCursorControl = controls.get("#disable-animated-cursors");
    assert.equal(animatedCursorControl.checked, false);

    animatedCursorControl.checked = true;
    await animatedCursorControl.dispatch("change");

    assert.equal(writes.at(-1).settings.disableAnimatedCursors, true);
  } finally {
    delete globalThis.chrome;
    delete globalThis.document;
  }
});

test("the content script hides cursor overlays and restores them when disabled", async () => {
  const customCursor = createElement({
    id: "custom-cursor",
    position: "fixed",
    pointerEvents: "none",
  });
  const ordinaryElement = createElement({
    className: "cursor-pointer",
    position: "static",
    pointerEvents: "auto",
  });
  const root = createElement();
  const observerInstances = [];
  let storedSettings = { disableAnimatedCursors: true };
  let storageListener;

  globalThis.document = {
    documentElement: root,
    readyState: "complete",
    querySelectorAll() {
      return [customCursor, ordinaryElement];
    },
  };
  globalThis.location = { hostname: "example.com" };
  globalThis.window = {
    dispatchEvent() {},
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  globalThis.getComputedStyle = (element) => element.computedStyle;
  globalThis.MutationObserver = class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      observerInstances.push(this);
    }
    observe() {}
    disconnect() {}
  };
  globalThis.chrome = {
    storage: {
      sync: {
        async get() {
          return { settings: storedSettings, disabledSites: {} };
        },
      },
      onChanged: {
        addListener(listener) {
          storageListener = listener;
        },
      },
    },
  };

  try {
    await import(`../content-isolated.js?test=${Date.now()}`);
    await nextTurn();

    assert.equal(root.dataset.imaDisableAnimatedCursors, "true");
    assert.equal(customCursor.dataset.imaCursorOverlay, "true");
    assert.equal(ordinaryElement.dataset.imaCursorOverlay, undefined);

    const dynamicCursor = createElement({
      className: "mouse-follower",
      position: "absolute",
      pointerEvents: "none",
    });
    observerInstances.at(-1).callback([
      { type: "childList", addedNodes: [dynamicCursor] },
    ]);
    assert.equal(dynamicCursor.dataset.imaCursorOverlay, "true");

    storedSettings = { disableAnimatedCursors: false };
    storageListener({ settings: {} }, "sync");
    await nextTurn();

    assert.equal(root.dataset.imaDisableAnimatedCursors, "false");
    assert.equal(customCursor.dataset.imaCursorOverlay, undefined);
    assert.equal(dynamicCursor.dataset.imaCursorOverlay, undefined);
  } finally {
    for (const name of [
      "chrome",
      "CustomEvent",
      "document",
      "getComputedStyle",
      "location",
      "MutationObserver",
      "window",
    ]) {
      delete globalThis[name];
    }
  }
});
