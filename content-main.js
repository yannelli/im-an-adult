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
    if (constructor && timeline instanceof constructor) return true;
    if (typeof brandGetter !== "function") return false;

    try {
      brandGetter.call(timeline);
      return true;
    } catch {
      return false;
    }
  }

  function isVisuallyHidden(target) {
    try {
      const style = nativeGetComputedStyle(target);
      const opacity = Number.parseFloat(style.opacity);
      return (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
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

  function patchAdoptedStyleSheets(prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(
      prototype,
      "adoptedStyleSheets",
    );
    if (typeof descriptor?.set !== "function") return;

    Object.defineProperty(prototype, "adoptedStyleSheets", {
      ...descriptor,
      set(value) {
        descriptor.set.call(this, value);
        cancelRootScrollDrivenAnimations();
      },
    });
  }

  patchAdoptedStyleSheets(Document.prototype);
  patchAdoptedStyleSheets(ShadowRoot.prototype);

  if (typeof CSSStyleSheet === "function") {
    for (const name of ["deleteRule", "insertRule", "replaceSync"]) {
      const nativeMethod = CSSStyleSheet.prototype[name];
      if (typeof nativeMethod !== "function") continue;

      CSSStyleSheet.prototype[name] = function (...args) {
        const result = nativeMethod.apply(this, args);
        cancelRootScrollDrivenAnimations();
        return result;
      };
    }

    const nativeReplace = CSSStyleSheet.prototype.replace;
    if (typeof nativeReplace === "function") {
      CSSStyleSheet.prototype.replace = function (...args) {
        const result = nativeReplace.apply(this, args);
        result.then(cancelRootScrollDrivenAnimations, () => {});
        return result;
      };
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

  nativeAddEventListener.call(
    document,
    "animationstart",
    (event) => {
      cancelScrollDrivenAnimations(event.target?.getAnimations?.() ?? []);
    },
    true,
  );

  nativeAddEventListener.call(
    document,
    "load",
    (event) => {
      scheduleAnimationRootScan(event.target?.getRootNode?.() ?? document);
    },
    true,
  );

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

  nativeAddEventListener.call(window, "__ima_settings__", (event) => {
    const next = event.detail;
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
  });
})();
