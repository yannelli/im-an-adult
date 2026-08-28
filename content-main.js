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
    const matrix2d = /^matrix\(([^)]+)\)$/.exec(transform);
    if (matrix2d) {
      const values = matrix2d[1].split(",").map(Number);
      return (
        values.length === 6 &&
        values.every(Number.isFinite) &&
        Math.abs(values[0] * values[3] - values[1] * values[2]) <= 0.0001
      );
    }

    const matrix3d = /^matrix3d\(([^)]+)\)$/.exec(transform);
    if (!matrix3d) return false;
    const values = matrix3d[1].split(",").map(Number);
    if (values.length !== 16 || !values.every(Number.isFinite)) return false;

    const projectedCorners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ].map(([x, y]) => {
      const divisor = values[3] * x + values[7] * y + values[15];
      if (Math.abs(divisor) <= 0.0001) return null;
      return [
        (values[0] * x + values[4] * y + values[12]) / divisor,
        (values[1] * x + values[5] * y + values[13]) / divisor,
      ];
    });
    if (projectedCorners.some((corner) => !corner)) return false;

    let doubledArea = 0;
    for (let index = 0; index < projectedCorners.length; index += 1) {
      const [x1, y1] = projectedCorners[index];
      const [x2, y2] = projectedCorners[(index + 1) % projectedCorners.length];
      doubledArea += x1 * y2 - y1 * x2;
    }
    return Math.abs(doubledArea) <= 0.0002;
  }

  function hasFullyClippedPath(clipPath) {
    if (/^(?:circle|ellipse)\(\s*0(?:px|%)?(?:\s|at|\))/i.test(clipPath)) {
      return true;
    }

    const inset = /^inset\((.*)\)$/i.exec(clipPath);
    if (!inset) return false;
    const values = inset[1].split(/\s+round\s+/i, 1)[0].trim().split(/\s+/);
    if (values.length < 1 || values.length > 4) return false;

    const expanded =
      values.length === 1
        ? [values[0], values[0], values[0], values[0]]
        : values.length === 2
          ? [values[0], values[1], values[0], values[1]]
          : values.length === 3
            ? [values[0], values[1], values[2], values[1]]
            : values;
    const percentages = expanded.map((value) => {
      if (/^[+-]?0(?:\.0+)?(?:[a-z]+)?$/i.test(value)) return 0;
      const percentage = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))%$/.exec(value);
      return percentage ? Number(percentage[1]) : null;
    });
    const [top, right, bottom, left] = percentages;

    return (
      (top !== null && bottom !== null && top + bottom >= 100) ||
      (right !== null && left !== null && right + left >= 100)
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

  function settleScrollDrivenAnimationGroup(animations, target) {
    for (const animation of animations) {
      nativeAnimationCancel.call(animation);
    }

    if (
      !target ||
      !nativeCSSPercent ||
      typeof nativeAnimationCommitStyles !== "function" ||
      !isVisuallyHidden(target)
    ) {
      return;
    }

    try {
      let sampled = false;
      for (const animation of animations) {
        try {
          animation.currentTime = nativeCSSPercent(100);
          sampled = true;
        } catch {
          // Some animation effects cannot be sampled.
        }
      }

      if (!sampled || isVisuallyHidden(target)) return;

      for (const animation of animations) {
        try {
          nativeAnimationCommitStyles.call(animation);
        } catch {
          // Some animation effects cannot be committed.
        }
      }
    } finally {
      for (const animation of animations) {
        nativeAnimationCancel.call(animation);
      }
    }
  }

  function isScrollDrivenAnimation(animation) {
    const timeline = animation?.timeline;
    return (
      hasNativeTimelineBrand(
        timeline,
        nativeScrollTimeline,
        nativeScrollTimelineSource,
      ) ||
      hasNativeTimelineBrand(
        timeline,
        nativeViewTimeline,
        nativeViewTimelineSubject,
      )
    );
  }

  function cancelScrollDrivenAnimations(animations) {
    if (!scrollEffectBlockingActive()) return false;

    const animationGroups = new Map();
    let found = false;
    for (const animation of animations) {
      if (!isScrollDrivenAnimation(animation)) continue;
      found = true;

      const target = animation.effect?.target ?? null;
      const group = animationGroups.get(target) ?? [];
      group.push(animation);
      animationGroups.set(target, group);
    }

    for (const [target, group] of animationGroups) {
      settleScrollDrivenAnimationGroup(group, target);
    }

    return found;
  }

  function cancelScrollDrivenAnimation(animation) {
    const target = animation?.effect?.target;
    if (target?.getAnimations) {
      try {
        return cancelScrollDrivenAnimations(
          new Set([...target.getAnimations(), animation]),
        );
      } catch {
        // Fall through to the animation supplied by the caller.
      }
    }

    return cancelScrollDrivenAnimations([animation]);
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
    const nativeReplace = CSSStyleSheet.prototype.replace;
    if (typeof nativeReplace === "function") {
      CSSStyleSheet.prototype.replace = function (...args) {
        const result = nativeReplace.apply(this, args);
        result.then(scheduleAllAnimationRootScans, () => {});
        return result;
      };
    }
  }

  if (typeof StyleSheet === "function") {
    patchMutationSetter(StyleSheet.prototype, "disabled");
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

  nativeAddEventListener.call(window, "__ima_settings__", (event) => {
    applySettings(event.detail);
  });
})();
