import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const contentScript = readFileSync(new URL("content-main.js", root), "utf8");

function loadContentScript({
  initialSettings = {
    blockHijacking: true,
    disableScrollEffects: true,
    enabled: true,
  },
} = {}) {
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
      this.commitStylesCalls = 0;
      this.currentTimeValue = null;
      this.effect = effect;
      this.nativePlayCalls = 0;
      this.nativeReverseCalls = 0;
      this.playState = "idle";
      this.startTimeValue = null;
      this.timelineValue = timeline;
    }

    get timeline() {
      return this.timelineValue;
    }

    set timeline(value) {
      this.timelineValue = value;
    }

    get currentTime() {
      return this.currentTimeValue;
    }

    set currentTime(value) {
      this.currentTimeValue = value;
      if (
        value?.unit === "percent" &&
        value.value === 100 &&
        this.effect?.target
      ) {
        this.effect.target.animatedStyles.set(this, { ...this.effect.endStyle });
      }
    }

    get startTime() {
      return this.startTimeValue;
    }

    set startTime(value) {
      this.startTimeValue = value;
      this.playState = "running";
    }

    cancel() {
      this.cancelCalls += 1;
      this.playState = "idle";
      this.effect?.target?.animatedStyles.delete(this);
    }

    commitStyles() {
      this.commitStylesCalls += 1;
      if (this.effect?.target && this.effect.target.animatedStyles.has(this)) {
        Object.assign(this.effect.target.computedStyle, this.effect.endStyle);
      }
    }

    play() {
      this.nativePlayCalls += 1;
      this.playState = "running";
    }

    reverse() {
      this.nativeReverseCalls += 1;
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
  const viewTimelineBrand = new WeakSet();

  class ViewTimeline {
    constructor() {
      viewTimelineBrand.add(this);
    }

    get subject() {
      if (!viewTimelineBrand.has(this)) throw new TypeError("Illegal invocation");
      return null;
    }
  }

  function createCrossRealmScrollTimeline() {
    const timeline = {};
    scrollTimelineBrand.add(timeline);
    return timeline;
  }

  class FakeStyleSheet {
    constructor() {
      this.disabledValue = false;
    }

    get disabled() {
      return this.disabledValue;
    }

    set disabled(value) {
      this.disabledValue = value;
    }
  }

  class FakeCSSStyleSheet extends FakeStyleSheet {
    deleteRule() {}

    insertRule() {
      return 0;
    }

    replace() {
      return Promise.resolve(this);
    }

    replaceSync() {}
  }

  class FakeCSSStyleDeclaration {
    constructor() {
      this.animationTimelineValue = "auto";
      this.cssTextValue = "";
      this.parentRule = {};
    }

    get animationTimeline() {
      return this.animationTimelineValue;
    }

    set animationTimeline(value) {
      this.animationTimelineValue = value;
    }

    get cssText() {
      return this.cssTextValue;
    }

    set cssText(value) {
      this.cssTextValue = value;
    }

    removeProperty() {}

    setProperty() {}
  }

  class FakeCSSKeyframesRule {
    appendRule() {}

    deleteRule() {}
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
      this.animatedStyles = new Map();
      this.computedStyle = {
        clipPath: "none",
        contentVisibility: "visible",
        display: "block",
        filter: "none",
        opacity: "1",
        transform: "none",
        visibility: "visible",
      };
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

    observe(target, options) {
      this.target = target;
      this.options = options;
    }
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
    CSS: {
      percent(value) {
        return { unit: "percent", value };
      },
    },
    CSSKeyframesRule: FakeCSSKeyframesRule,
    CSSStyleDeclaration: FakeCSSStyleDeclaration,
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
    StyleSheet: FakeStyleSheet,
    ViewTimeline,
    Window: FakeWindow,
    createCrossRealmScrollTimeline,
    document,
    getComputedStyle(element) {
      return {
        ...element.computedStyle,
        ...Object.assign({}, ...element.animatedStyles.values()),
      };
    },
    queueMicrotask,
    window,
  });

  vm.runInContext(contentScript, context);

  if (initialSettings) {
    window.dispatch("__ima_settings__", { detail: initialSettings });
  }

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

test("scroll reveals settle in their visible end state", () => {
  const { context } = loadContentScript();
  const target = new context.Element();
  target.computedStyle.opacity = "0";
  const animation = new context.Animation(
    { endStyle: { opacity: "1" }, target },
    new context.ViewTimeline(),
  );

  animation.play();

  assert.equal(context.getComputedStyle(target).opacity, "1");
  assert.equal(animation.playState, "idle");
});

test("visible scroll effects cancel without committing an end state", () => {
  const { context } = loadContentScript();
  const target = new context.Element();
  const animation = new context.Animation(
    { endStyle: { opacity: "0.5" }, target },
    new context.ScrollTimeline(),
  );

  animation.play();

  assert.equal(context.getComputedStyle(target).opacity, "1");
  assert.equal(animation.commitStylesCalls, 0);
});

test("scale reveals settle in their visible end state", () => {
  const { context } = loadContentScript();
  const target = new context.Element();
  target.computedStyle.transform = "matrix(0, 0, 0, 0, 0, 0)";
  const animation = new context.Animation(
    { endStyle: { transform: "none" }, target },
    new context.ViewTimeline(),
  );

  animation.play();

  assert.equal(context.getComputedStyle(target).transform, "none");
});

test("single-axis scale reveals settle in their visible end state", () => {
  const { context } = loadContentScript();
  const target = new context.Element();
  target.computedStyle.transform = "matrix(0, 0, 0, 1, 0, 0)";
  const animation = new context.Animation(
    { endStyle: { transform: "none" }, target },
    new context.ViewTimeline(),
  );

  animation.play();

  assert.equal(context.getComputedStyle(target).transform, "none");
});

test("collapsed 3D scale reveals settle in their visible end state", () => {
  const { context } = loadContentScript();
  const target = new context.Element();
  target.computedStyle.transform =
    "matrix3d(0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)";
  const animation = new context.Animation(
    { endStyle: { transform: "none" }, target },
    new context.ViewTimeline(),
  );

  animation.play();

  assert.equal(context.getComputedStyle(target).transform, "none");
});

test("scaleZ does not make a flat element visually hidden", () => {
  const { context } = loadContentScript();
  const target = new context.Element();
  target.computedStyle.transform =
    "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1)";
  const animation = new context.Animation(
    { endStyle: { opacity: "0.5", transform: "none" }, target },
    new context.ViewTimeline(),
  );

  animation.play();

  assert.equal(context.getComputedStyle(target).opacity, "1");
  assert.equal(animation.commitStylesCalls, 0);
});

test("edge-on 3D rotation reveals settle in their visible end state", () => {
  const { context } = loadContentScript();
  const target = new context.Element();
  target.computedStyle.transform =
    "matrix3d(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1)";
  const animation = new context.Animation(
    { endStyle: { transform: "none" }, target },
    new context.ViewTimeline(),
  );

  animation.play();

  assert.equal(context.getComputedStyle(target).transform, "none");
});

test("separate reveal animations settle together", () => {
  const { context, document, window } = loadContentScript({
    initialSettings: null,
  });
  const target = new context.Element();
  target.computedStyle.opacity = "0";
  target.computedStyle.transform = "matrix(0, 0, 0, 0, 0, 0)";
  const fade = new context.Animation(
    { endStyle: { opacity: "1" }, target },
    new context.ViewTimeline(),
  );
  const scale = new context.Animation(
    { endStyle: { transform: "none" }, target },
    new context.ViewTimeline(),
  );
  document.animations.push(fade, scale);

  window.dispatch("__ima_settings__", {
    detail: { disableScrollEffects: true, enabled: true },
  });

  assert.equal(context.getComputedStyle(target).opacity, "1");
  assert.equal(context.getComputedStyle(target).transform, "none");
  assert.equal(fade.playState, "idle");
  assert.equal(scale.playState, "idle");
});

test("clipped reveals settle in their visible end state", () => {
  const { context } = loadContentScript();
  const target = new context.Element();
  target.computedStyle.clipPath = "inset(100%)";
  const animation = new context.Animation(
    { endStyle: { clipPath: "none" }, target },
    new context.ScrollTimeline(),
  );

  animation.play();

  assert.equal(context.getComputedStyle(target).clipPath, "none");
});

test("directional clip reveals settle in their visible end state", () => {
  const { context } = loadContentScript();
  const target = new context.Element();
  target.computedStyle.clipPath = "inset(0px 100% 0px 0px)";
  const animation = new context.Animation(
    { endStyle: { clipPath: "none" }, target },
    new context.ScrollTimeline(),
  );

  animation.play();

  assert.equal(context.getComputedStyle(target).clipPath, "none");
});

test("scroll animations wait for settings before making irreversible changes", () => {
  const { context, window } = loadContentScript({ initialSettings: null });
  const element = new context.Element();
  const animation = element.animate([], {
    timeline: new context.ScrollTimeline(),
  });

  assert.equal(animation.cancelCalls, 0);
  assert.equal(animation.playState, "running");

  window.dispatch("__ima_settings__", {
    detail: { disableScrollEffects: true, enabled: false },
  });

  assert.equal(animation.cancelCalls, 0);
  assert.equal(animation.playState, "running");
});

test("the first enabled setting flushes animations created while settings load", () => {
  const { context, document, window } = loadContentScript({
    initialSettings: null,
  });
  const animation = new context.Animation(
    null,
    new context.ScrollTimeline(),
  );
  document.animations.push(animation);

  window.dispatch("__ima_settings__", {
    detail: { disableScrollEffects: true, enabled: true },
  });

  assert.equal(animation.cancelCalls, 1);
});

test("animation discovery observes only style-affecting attributes", () => {
  const { observerInstances } = loadContentScript();

  assert.deepEqual(observerInstances[0].options.attributeFilter, [
    "class",
    "id",
    "style",
  ]);
});

test("Animation.play blocks animations created directly with a scroll timeline", () => {
  const { context } = loadContentScript();
  const animation = new context.Animation(null, new context.ViewTimeline());

  animation.play();

  assert.equal(animation.nativePlayCalls, 0);
  assert.equal(animation.cancelCalls, 1);
});

test("Animation.reverse cannot restart a scroll-driven animation", () => {
  const { context } = loadContentScript();
  const animation = new context.Animation(null, new context.ViewTimeline());

  animation.reverse();

  assert.equal(animation.nativeReverseCalls, 0);
  assert.equal(animation.cancelCalls, 1);
  assert.equal(animation.playState, "idle");
});

test("assigning startTime cannot start a scroll-driven animation", () => {
  const { context } = loadContentScript();
  const animation = new context.Animation(null, new context.ScrollTimeline());

  animation.startTime = context.CSS.percent(0);

  assert.equal(animation.cancelCalls, 1);
  assert.equal(animation.playState, "idle");
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

test("shadow-root animation events discover scroll-driven animations", () => {
  const { context } = loadContentScript();
  const root = new context.Element().attachShadow({ mode: "closed" });
  const target = new context.Element();
  const animation = new context.Animation(null, new context.ViewTimeline());
  target.animations.push(animation);

  root.dispatch("animationstart", { target });

  assert.equal(animation.cancelCalls, 1);
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

test("CSSStyleSheet mutations discover pre-active scroll animations", async () => {
  const { context, document } = loadContentScript();
  const scrollDriven = new context.Animation(null, new context.ScrollTimeline());
  document.animations.push(scrollDriven);

  new context.CSSStyleSheet().insertRule(".subject { animation-timeline: scroll(); }");
  await Promise.resolve();

  assert.equal(scrollDriven.cancelCalls, 1);
});

test("CSSStyleSheet mutations coalesce animation discovery", async () => {
  const { context, document } = loadContentScript();
  const callsBefore = document.getAnimationsCalls;
  const sheet = new context.CSSStyleSheet();

  sheet.insertRule(".one { animation-timeline: scroll(); }");
  sheet.insertRule(".two { animation-timeline: view(); }");

  assert.equal(document.getAnimationsCalls, callsBefore);
  await Promise.resolve();
  assert.equal(document.getAnimationsCalls, callsBefore + 1);
});

test("toggling StyleSheet.disabled discovers scroll animations", async () => {
  const { context, document } = loadContentScript();
  const animation = new context.Animation(null, new context.ScrollTimeline());
  document.animations.push(animation);
  const sheet = new context.CSSStyleSheet();

  sheet.disabled = true;
  await Promise.resolve();

  assert.equal(animation.cancelCalls, 1);
});

test("CSS declarations discover pre-active scroll animations", async () => {
  const { context, document } = loadContentScript();
  const animation = new context.Animation(null, new context.ScrollTimeline());
  document.animations.push(animation);

  new context.CSSStyleDeclaration().setProperty(
    "animation-timeline",
    "scroll()",
  );
  await Promise.resolve();

  assert.equal(animation.cancelCalls, 1);
});

test("CSS keyframe mutations discover pre-active scroll animations", async () => {
  const { context, document } = loadContentScript();
  const animation = new context.Animation(null, new context.ViewTimeline());
  document.animations.push(animation);

  new context.CSSKeyframesRule().appendRule("to { opacity: 1 }");
  await Promise.resolve();

  assert.equal(animation.cancelCalls, 1);
});

test("adopting a stylesheet discovers pre-active scroll animations", async () => {
  const { context, document } = loadContentScript();
  const scrollDriven = new context.Animation(null, new context.ViewTimeline());
  document.animations.push(scrollDriven);

  document.adoptedStyleSheets = [new context.CSSStyleSheet()];
  await Promise.resolve();

  assert.equal(scrollDriven.cancelCalls, 1);
});

test("mutating adoptedStyleSheets in place discovers scroll animations", async () => {
  const { context, document } = loadContentScript();
  const animation = new context.Animation(null, new context.ScrollTimeline());
  document.animations.push(animation);

  document.adoptedStyleSheets.push(new context.CSSStyleSheet());
  await Promise.resolve();

  assert.equal(animation.cancelCalls, 1);
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
