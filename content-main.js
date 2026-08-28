(() => {
  const defaults = {
    enabled: true,
    blockHijacking: true,
    disableScrollEffects: true,
    blockAutoplay: false,
  };
  let settings = { ...defaults };
  let settingsReceived = false;
  let userHasInteracted = false;

  const scrollInputEvents = new Set([
    "wheel",
    "mousewheel",
    "touchstart",
    "touchmove",
  ]);

  const nativeAddEventListener = EventTarget.prototype.addEventListener;
  const nativeAnimationCancel = Animation.prototype.cancel;
  const nativeAnimationCommitStyles = Animation.prototype.commitStyles;
  const nativeAnimationReverse = Animation.prototype.reverse;
  const nativeAnimationStartTimeDescriptor = Object.getOwnPropertyDescriptor(
    Animation.prototype,
    "startTime",
  );
  const nativeCSSPercent =
    typeof CSS === "object" && typeof CSS.percent === "function"
      ? CSS.percent.bind(CSS)
      : null;
  const nativeFinalizationRegistry = FinalizationRegistry;
  const nativeGetComputedStyle = getComputedStyle;
  const nativePreventDefault = Event.prototype.preventDefault;
  const nativeMutationObserver = MutationObserver;
  const nativeQueueMicrotask = queueMicrotask;
  const nativeScrollTimeline =
    typeof ScrollTimeline === "function" ? ScrollTimeline : null;
  const nativeViewTimeline =
    typeof ViewTimeline === "function" ? ViewTimeline : null;
  const nativeWeakRef = WeakRef;
  const nativeScrollTimelineSource = nativeScrollTimeline
    ? Object.getOwnPropertyDescriptor(nativeScrollTimeline.prototype, "source")
        ?.get
    : null;
  const nativeViewTimelineSubject = nativeViewTimeline
    ? Object.getOwnPropertyDescriptor(nativeViewTimeline.prototype, "subject")
        ?.get
    : null;

  Event.prototype.preventDefault = function () {
    if (
      settings.enabled &&
      settings.blockHijacking &&
      scrollInputEvents.has(this.type)
    ) {
      return;
    }

    return nativePreventDefault.call(this);
  };

  function withInstantBehavior(value) {
    if (
      settings.enabled &&
      settings.disableScrollEffects &&
      value &&
      typeof value === "object"
    ) {
      return { ...value, behavior: "auto" };
    }
    return value;
  }

  function patchScrollMethod(prototype, name) {
    const nativeMethod = prototype?.[name];
    if (typeof nativeMethod !== "function") return;

    prototype[name] = function (...args) {
      if (args.length > 0) args[0] = withInstantBehavior(args[0]);
      return nativeMethod.apply(this, args);
    };
  }

  for (const name of ["scroll", "scrollTo", "scrollBy"]) {
    patchScrollMethod(Window.prototype, name);
    patchScrollMethod(Element.prototype, name);
  }
  patchScrollMethod(Element.prototype, "scrollIntoView");

  function hasNativeTimelineBrand(timeline, constructor, brandGetter) {
    if (!timeline) return false;
    if (typeof brandGetter === "function") {
      try {
        brandGetter.call(timeline);
        return true;
      } catch {
        return false;
      }
    }

    try {
      return Boolean(constructor && timeline instanceof constructor);
    } catch {
      return false;
    }
  }

  function hasCollapsedTransform(transform) {
    const match = /^matrix\(([^)]+)\)$/.exec(transform);
    if (!match) return false;
    const values = match[1].split(",").map(Number);
    return (
      values.length === 6 &&
      Math.hypot(values[0], values[1]) <= 0.01 &&
      Math.hypot(values[2], values[3]) <= 0.01
    );
  }

  function hasFullyClippedPath(clipPath) {
    return (
      /^inset\(\s*100(?:\.0+)?%\s*\)$/i.test(clipPath) ||
      /^(?:circle|ellipse)\(\s*0(?:px|%)?(?:\s|at|\))/i.test(clipPath)
    );
  }

  function hasTransparentFilter(filter) {
    return /(?:^|\s)opacity\(\s*0(?:\.0+)?%?\s*\)/i.test(filter);
  }

  function isVisuallyHidden(target) {
    try {
      const style = nativeGetComputedStyle(target);
      const opacity = Number.parseFloat(style.opacity);
      return (
        style.display === "none" ||
        style.contentVisibility === "hidden" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        hasCollapsedTransform(style.transform) ||
        hasFullyClippedPath(style.clipPath) ||
        hasTransparentFilter(style.filter) ||
        (!Number.isNaN(opacity) && opacity <= 0.01)
      );
    } catch {
      return false;
    }
  }

  function settleScrollDrivenAnimation(animation) {
    const target = animation.effect?.target;
    nativeAnimationCancel.call(animation);

    if (
      !target ||
      !nativeCSSPercent ||
      typeof nativeAnimationCommitStyles !== "function" ||
      !isVisuallyHidden(target)
    ) {
      return;
    }

    try {
      animation.currentTime = nativeCSSPercent(100);
      if (!isVisuallyHidden(target)) {
        nativeAnimationCommitStyles.call(animation);
      }
    } catch {
      // Some animation effects cannot be sampled or committed.
    } finally {
      nativeAnimationCancel.call(animation);
    }
  }

  function cancelScrollDrivenAnimation(animation) {
    const timeline = animation?.timeline;
    const scrollDriven =
      hasNativeTimelineBrand(
        timeline,
        nativeScrollTimeline,
        nativeScrollTimelineSource,
      ) ||
      hasNativeTimelineBrand(
        timeline,
        nativeViewTimeline,
        nativeViewTimelineSubject,
      );

    if (
      settingsReceived &&
      settings.enabled &&
      settings.disableScrollEffects &&
      scrollDriven
    ) {
      settleScrollDrivenAnimation(animation);
      return true;
    }

    return false;
  }

  function cancelScrollDrivenAnimations(animations) {
    for (const animation of animations) {
      cancelScrollDrivenAnimation(animation);
    }
  }

  const animationRootReferences = new Set();
  const observedAnimationRoots = new WeakSet();
  const pendingAnimationRoots = new Set();
  let animationScanScheduled = false;
  const animationRootFinalizer = new nativeFinalizationRegistry((reference) => {
    animationRootReferences.delete(reference);
  });

  function scrollEffectBlockingActive() {
    return (
      settingsReceived && settings.enabled && settings.disableScrollEffects
    );
  }

  function cancelAnimationRoot(root) {
    if (!scrollEffectBlockingActive()) return;
    cancelScrollDrivenAnimations(root.getAnimations?.() ?? []);
  }

  function cancelRootScrollDrivenAnimations() {
    if (!scrollEffectBlockingActive()) return;

    for (const reference of animationRootReferences) {
      const root = reference.deref();
      if (root) {
        cancelAnimationRoot(root);
      } else {
        animationRootReferences.delete(reference);
      }
    }
  }

  function scheduleAnimationRootScan(root) {
    if (!scrollEffectBlockingActive() || !root) return;
    pendingAnimationRoots.add(root);
    if (animationScanScheduled) return;

    animationScanScheduled = true;
    nativeQueueMicrotask(() => {
      animationScanScheduled = false;
      for (const pendingRoot of pendingAnimationRoots) {
        cancelAnimationRoot(pendingRoot);
      }
      pendingAnimationRoots.clear();
    });
  }

  function scheduleAllAnimationRootScans() {
    if (!scrollEffectBlockingActive()) return;

    for (const reference of animationRootReferences) {
      const root = reference.deref();
      if (root) {
        scheduleAnimationRootScan(root);
      } else {
        animationRootReferences.delete(reference);
      }
    }
  }

  function observeShadowRoots(node) {
    if (node?.nodeType !== 1) return;

    if (node.shadowRoot) observeAnimationRoot(node.shadowRoot);
    for (const element of node.querySelectorAll?.("*") ?? []) {
      if (element.shadowRoot) observeAnimationRoot(element.shadowRoot);
    }
  }

  function observeAnimationRoot(root) {
    if (!root || observedAnimationRoots.has(root)) return;
    observedAnimationRoots.add(root);

    const reference = new nativeWeakRef(root);
    animationRootReferences.add(reference);
    animationRootFinalizer.register(root, reference);

    nativeAddEventListener.call(
      root,
      "animationstart",
      (event) => {
        cancelScrollDrivenAnimations(event.target?.getAnimations?.() ?? []);
      },
      true,
    );
    nativeAddEventListener.call(
      root,
      "load",
      () => scheduleAnimationRootScan(root),
      true,
    );

    const observer = new nativeMutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes ?? []) {
          observeShadowRoots(node);
        }
      }
      scheduleAnimationRootScan(root);
    });
    observer.observe(root, {
      attributeFilter: ["class", "id", "style"],
      childList: true,
      subtree: true,
    });
    cancelAnimationRoot(root);
  }

  observeAnimationRoot(document);

  const nativeAttachShadow = Element.prototype.attachShadow;
  if (typeof nativeAttachShadow === "function") {
    Element.prototype.attachShadow = function (...args) {
      const root = nativeAttachShadow.apply(this, args);
      observeAnimationRoot(root);
      return root;
    };
  }

  const patchedAdoptedStyleSheetLists = new WeakSet();

  function patchAdoptedStyleSheetList(root, list) {
    if (!list || patchedAdoptedStyleSheetLists.has(list)) return list;
    patchedAdoptedStyleSheetLists.add(list);

    for (const name of [
      "copyWithin",
      "fill",
      "pop",
      "push",
      "reverse",
      "shift",
      "sort",
      "splice",
      "unshift",
    ]) {
      const nativeMethod = list[name];
      if (typeof nativeMethod !== "function") continue;

      try {
        Object.defineProperty(list, name, {
          configurable: true,
          value(...args) {
            const result = nativeMethod.apply(this, args);
            scheduleAnimationRootScan(root);
            return result;
          },
          writable: true,
        });
      } catch {
        // Older FrozenArray implementations only support full reassignment.
      }
    }

    return list;
  }

  function patchAdoptedStyleSheets(prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(
      prototype,
      "adoptedStyleSheets",
    );
    if (
      typeof descriptor?.get !== "function" ||
      typeof descriptor.set !== "function"
    ) {
      return;
    }

    Object.defineProperty(prototype, "adoptedStyleSheets", {
      ...descriptor,
      get() {
        return patchAdoptedStyleSheetList(this, descriptor.get.call(this));
      },
      set(value) {
        descriptor.set.call(this, value);
        patchAdoptedStyleSheetList(this, descriptor.get.call(this));
        scheduleAnimationRootScan(this);
      },
    });
  }

  patchAdoptedStyleSheets(Document.prototype);
  patchAdoptedStyleSheets(ShadowRoot.prototype);

  function patchMutationMethods(prototype, names, shouldSchedule = () => true) {
    if (!prototype) return;

    for (const name of names) {
      const nativeMethod = prototype[name];
      if (typeof nativeMethod !== "function") continue;

      prototype[name] = function (...args) {
        const result = nativeMethod.apply(this, args);
        if (shouldSchedule(this)) scheduleAllAnimationRootScans();
        return result;
      };
    }
  }

  function patchMutationSetter(prototype, name, shouldSchedule = () => true) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (typeof descriptor?.set !== "function") return;

    Object.defineProperty(prototype, name, {
      ...descriptor,
      set(value) {
        descriptor.set.call(this, value);
        if (shouldSchedule(this)) scheduleAllAnimationRootScans();
      },
    });
  }

  if (typeof CSSStyleSheet === "function") {
    patchMutationMethods(CSSStyleSheet.prototype, [
      "deleteRule",
      "insertRule",
      "replaceSync",
    ]);
    patchMutationSetter(CSSStyleSheet.prototype, "disabled");

    const nativeReplace = CSSStyleSheet.prototype.replace;
    if (typeof nativeReplace === "function") {
      CSSStyleSheet.prototype.replace = function (...args) {
        const result = nativeReplace.apply(this, args);
        result.then(scheduleAllAnimationRootScans, () => {});
        return result;
      };
    }
  }

  if (typeof CSSGroupingRule === "function") {
    patchMutationMethods(CSSGroupingRule.prototype, ["deleteRule", "insertRule"]);
  }

  if (typeof CSSKeyframesRule === "function") {
    patchMutationMethods(CSSKeyframesRule.prototype, ["appendRule", "deleteRule"]);
  }

  if (typeof CSSStyleDeclaration === "function") {
    const belongsToRule = (declaration) => Boolean(declaration.parentRule);
    patchMutationMethods(
      CSSStyleDeclaration.prototype,
      ["removeProperty", "setProperty"],
      belongsToRule,
    );
    for (const name of [
      "animation",
      "animationName",
      "animationRange",
      "animationRangeEnd",
      "animationRangeStart",
      "animationTimeline",
      "cssText",
    ]) {
      patchMutationSetter(CSSStyleDeclaration.prototype, name, belongsToRule);
    }
  }

  const nativeAnimate = Element.prototype.animate;
  if (typeof nativeAnimate === "function") {
    Element.prototype.animate = function (keyframes, options) {
      const animation = nativeAnimate.call(this, keyframes, options);
      cancelScrollDrivenAnimation(animation);

      return animation;
    };
  }

  const nativeAnimationPlay = Animation.prototype.play;
  if (typeof nativeAnimationPlay === "function") {
    Animation.prototype.play = function (...args) {
      if (cancelScrollDrivenAnimation(this)) return;
      return nativeAnimationPlay.apply(this, args);
    };
  }

  if (typeof nativeAnimationReverse === "function") {
    Animation.prototype.reverse = function (...args) {
      if (cancelScrollDrivenAnimation(this)) return;
      return nativeAnimationReverse.apply(this, args);
    };
  }

  if (typeof nativeAnimationStartTimeDescriptor?.set === "function") {
    Object.defineProperty(Animation.prototype, "startTime", {
      ...nativeAnimationStartTimeDescriptor,
      set(value) {
        nativeAnimationStartTimeDescriptor.set.call(this, value);
        cancelScrollDrivenAnimation(this);
      },
    });
  }

  const nativeTimelineDescriptor = Object.getOwnPropertyDescriptor(
    Animation.prototype,
    "timeline",
  );
  if (typeof nativeTimelineDescriptor?.set === "function") {
    Object.defineProperty(Animation.prototype, "timeline", {
      ...nativeTimelineDescriptor,
      set(value) {
        nativeTimelineDescriptor.set.call(this, value);
        cancelScrollDrivenAnimation(this);
      },
    });
  }

  for (const eventName of ["pointerdown", "mousedown", "touchstart", "keydown"]) {
    nativeAddEventListener.call(
      window,
      eventName,
      (event) => {
        if (event.isTrusted) userHasInteracted = true;
      },
      { capture: true, passive: true },
    );
  }

  nativeAddEventListener.call(
    document,
    "play",
    (event) => {
      if (
        settings.enabled &&
        settings.blockAutoplay &&
        !userHasInteracted &&
        event.target instanceof HTMLMediaElement
      ) {
        event.target.pause();
      }
    },
    true,
  );

  function applySettings(next) {
    if (!next || typeof next !== "object") return;

    settings = {
      enabled: next.enabled !== false,
      blockHijacking: next.blockHijacking !== false,
      disableScrollEffects: next.disableScrollEffects !== false,
      blockAutoplay: next.blockAutoplay === true,
    };
    settingsReceived = true;

    if (settings.enabled && settings.disableScrollEffects) {
      cancelRootScrollDrivenAnimations();
    }
  }

  let settingsPortConnected = false;
  nativeAddEventListener.call(
    window,
    "message",
    (event) => {
      if (
        settingsPortConnected ||
        event.source !== window ||
        event.data !== "__ima_settings_port__"
      ) {
        return;
      }

      const port = event.ports?.[0];
      if (!port) return;
      settingsPortConnected = true;
      nativeAddEventListener.call(port, "message", (messageEvent) => {
        applySettings(messageEvent.data);
      });
      port.start();
    },
    true,
  );
})();
