import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const contentScript = readFileSync(new URL("content-main.js", root), "utf8");

function loadContentScript() {
  const observerInstances = [];

  class FakeEventTarget {
    constructor() {
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    dispatch(type, init = {}) {
      const event = { type, ...init };
      for (const listener of this.listeners.get(type) ?? []) {
        listener.call(this, event);
      }
    }
  }

  class FakeEvent {
    preventDefault() {
      this.defaultPrevented = true;
    }
  }

  class FakeAnimation {
    constructor(effect = null, timeline = null) {
      this.cancelCalls = 0;
      this.effect = effect;
      this.nativePlayCalls = 0;
      this.playState = "idle";
      this.timelineValue = timeline;
    }

    get timeline() {
      return this.timelineValue;
    }

    set timeline(value) {
      this.timelineValue = value;
    }

    cancel() {
      this.cancelCalls += 1;
      this.playState = "idle";
    }

    play() {
      this.nativePlayCalls += 1;
      this.playState = "running";
    }
  }

  const scrollTimelineBrand = new WeakSet();

  class DocumentTimeline {}
  class ScrollTimeline {
    constructor() {
      scrollTimelineBrand.add(this);
    }

    get source() {
      if (!scrollTimelineBrand.has(this)) throw new TypeError("Illegal invocation");
      return null;
    }
  }
  class ViewTimeline {}

  function createCrossRealmScrollTimeline() {
    const timeline = {};
    scrollTimelineBrand.add(timeline);
    return timeline;
  }

  class FakeCSSStyleSheet {
    insertRule() {
      return 0;
    }

    replaceSync() {}
  }

  class FakeWindow extends FakeEventTarget {
    scroll() {}
    scrollBy() {}
    scrollTo() {}
  }

  class FakeElement extends FakeEventTarget {
    constructor() {
      super();
      this.animations = [];
    }

    animate(_keyframes, options = {}) {
      const animation = new FakeAnimation(null, options.timeline ?? document.timeline);
      animation.nativePlayCalls = 1;
      animation.playState = "running";
      this.animations.push(animation);
      return animation;
    }

    getAnimations() {
      return this.animations;
    }

    attachShadow() {
      return new FakeShadowRoot();
    }

    scroll() {}
    scrollBy() {}
    scrollIntoView() {}
    scrollTo() {}
  }

  class FakeMediaElement extends FakeElement {
    pause() {}
  }

  class FakeShadowRoot extends FakeEventTarget {
    constructor() {
      super();
      this.animations = [];
      this.getAnimationsCalls = 0;
      this.stylesheets = [];
    }

    getAnimations() {
      this.getAnimationsCalls += 1;
      return this.animations;
    }

    get adoptedStyleSheets() {
      return this.stylesheets;
    }

    set adoptedStyleSheets(value) {
      this.stylesheets = value;
    }
  }

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      observerInstances.push(this);
    }

    observe() {}
  }

  class FakeDocument extends FakeEventTarget {
    constructor() {
      super();
      this.animations = [];
      this.getAnimationsCalls = 0;
      this.stylesheets = [];
      this.timeline = new DocumentTimeline();
    }

    getAnimations() {
      this.getAnimationsCalls += 1;
      return this.animations;
    }

    get adoptedStyleSheets() {
      return this.stylesheets;
    }

    set adoptedStyleSheets(value) {
      this.stylesheets = value;
    }
  }

  const document = new FakeDocument();
  const window = new FakeWindow();
  const context = vm.createContext({
    Animation: FakeAnimation,
    CSSStyleSheet: FakeCSSStyleSheet,
    Document: FakeDocument,
    DocumentTimeline,
    Element: FakeElement,
    Event: FakeEvent,
    EventTarget: FakeEventTarget,
    HTMLMediaElement: FakeMediaElement,
    MutationObserver: FakeMutationObserver,
    ScrollTimeline,
    ShadowRoot: FakeShadowRoot,
    ViewTimeline,
    Window: FakeWindow,
    createCrossRealmScrollTimeline,
    document,
    queueMicrotask,
    window,
  });

  vm.runInContext(contentScript, context);

  return { context, document, observerInstances, window };
}

test("the stylesheet leaves animation timelines intact for selective cancellation", () => {
  const stylesheet = readFileSync(new URL("content.css", root), "utf8");
  assert.doesNotMatch(stylesheet, /animation-timeline\s*:/);
});

test("Element.animate cancels only native scroll-driven animations", () => {
  const { context } = loadContentScript();
  const element = new context.Element();

  const ordinary = element.animate([], {});
  const scrollDriven = element.animate([], {
    timeline: new context.ScrollTimeline(),
  });

  assert.equal(ordinary.cancelCalls, 0);
  assert.equal(ordinary.playState, "running");
  assert.equal(scrollDriven.cancelCalls, 1);
  assert.equal(scrollDriven.playState, "idle");
});

test("Animation.play blocks animations created directly with a scroll timeline", () => {
  const { context } = loadContentScript();
  const animation = new context.Animation(null, new context.ViewTimeline());

  animation.play();

  assert.equal(animation.nativePlayCalls, 0);
  assert.equal(animation.cancelCalls, 1);
});

test("timeline detection does not depend on mutable constructor names", () => {
  const { context } = loadContentScript();
  Object.defineProperty(context.ScrollTimeline, "name", {
    value: "RenamedTimeline",
  });
  const animation = new context.Animation(null, new context.ScrollTimeline());

  animation.play();

  assert.equal(animation.nativePlayCalls, 0);
  assert.equal(animation.cancelCalls, 1);
});

test("native timeline brand checks work across realms", () => {
  const { context } = loadContentScript();
  const animation = new context.Animation(
    null,
    context.createCrossRealmScrollTimeline(),
  );

  animation.play();

  assert.equal(animation.nativePlayCalls, 0);
  assert.equal(animation.cancelCalls, 1);
});

test("assigning a scroll timeline cancels an animation that is already running", () => {
  const { context } = loadContentScript();
  const animation = new context.Animation(null, new context.DocumentTimeline());
  animation.play();

  animation.timeline = new context.ScrollTimeline();

  assert.equal(animation.nativePlayCalls, 1);
  assert.equal(animation.cancelCalls, 1);
  assert.equal(animation.playState, "idle");
});

test("CSS animation events cancel only animations backed by scroll timelines", () => {
  const { context, document } = loadContentScript();
  const element = new context.Element();
  const ordinary = new context.Animation(null, new context.DocumentTimeline());
  const scrollDriven = new context.Animation(null, new context.ScrollTimeline());
  element.animations.push(ordinary, scrollDriven);

  document.dispatch("animationstart", { target: element });

  assert.equal(ordinary.cancelCalls, 0);
  assert.equal(scrollDriven.cancelCalls, 1);
});

test("DOM mutations cancel pre-active CSS scroll animations", async () => {
  const { context, document, observerInstances } = loadContentScript();
  const scrollDriven = new context.Animation(null, new context.ScrollTimeline());
  document.animations.push(scrollDriven);

  assert.equal(observerInstances.length, 1);
  observerInstances[0].callback([{ addedNodes: [] }]);
  await Promise.resolve();

  assert.equal(scrollDriven.cancelCalls, 1);
});

test("a mutation scans only its own animation root", async () => {
  const { context, document, observerInstances } = loadContentScript();
  const root = new context.Element().attachShadow({ mode: "closed" });
  const documentCalls = document.getAnimationsCalls;
  const rootCalls = root.getAnimationsCalls;

  observerInstances[0].callback([{ addedNodes: [] }]);
  await Promise.resolve();

  assert.equal(document.getAnimationsCalls, documentCalls + 1);
  assert.equal(root.getAnimationsCalls, rootCalls);
});

test("shadow-root mutations cancel pre-active CSS scroll animations", async () => {
  const { context, observerInstances } = loadContentScript();
  const root = new context.Element().attachShadow({ mode: "closed" });
  const scrollDriven = new context.Animation(null, new context.ViewTimeline());
  root.animations.push(scrollDriven);

  assert.equal(observerInstances.length, 2);
  observerInstances[1].callback([{ addedNodes: [] }]);
  await Promise.resolve();

  assert.equal(scrollDriven.cancelCalls, 1);
});

test("CSS discovery leaves scroll animations running when blocking is disabled", async () => {
  const { context, document, observerInstances, window } = loadContentScript();
  window.dispatch("__ima_settings__", {
    detail: {
      blockHijacking: true,
      disableScrollEffects: false,
      enabled: true,
    },
  });
  const scrollDriven = new context.Animation(null, new context.ScrollTimeline());
  document.animations.push(scrollDriven);

  const getAnimationsCalls = document.getAnimationsCalls;
  assert.equal(observerInstances.length, 1);
  observerInstances[0].callback([{ addedNodes: [] }]);
  await Promise.resolve();

  assert.equal(scrollDriven.cancelCalls, 0);
  assert.equal(document.getAnimationsCalls, getAnimationsCalls);
});

test("CSSStyleSheet mutations discover pre-active scroll animations", () => {
  const { context, document } = loadContentScript();
  const scrollDriven = new context.Animation(null, new context.ScrollTimeline());
  document.animations.push(scrollDriven);

  new context.CSSStyleSheet().insertRule(".subject { animation-timeline: scroll(); }");

  assert.equal(scrollDriven.cancelCalls, 1);
});

test("adopting a stylesheet discovers pre-active scroll animations", () => {
  const { context, document } = loadContentScript();
  const scrollDriven = new context.Animation(null, new context.ViewTimeline());
  document.animations.push(scrollDriven);

  document.adoptedStyleSheets = [new context.CSSStyleSheet()];

  assert.equal(scrollDriven.cancelCalls, 1);
});

test("enabling scroll-effect blocking cancels existing scroll-driven animations", () => {
  const { context, document, window } = loadContentScript();
  const ordinary = new context.Animation(null, new context.DocumentTimeline());
  const scrollDriven = new context.Animation(null, new context.ViewTimeline());
  document.animations.push(ordinary, scrollDriven);

  window.dispatch("__ima_settings__", {
    detail: {
      blockHijacking: true,
      disableScrollEffects: true,
      enabled: true,
    },
  });

  assert.equal(ordinary.cancelCalls, 0);
  assert.equal(scrollDriven.cancelCalls, 1);
});
