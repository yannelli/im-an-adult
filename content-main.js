(() => {
  const defaults = {
    enabled: true,
    blockHijacking: true,
    disableScrollEffects: true,
    blockAutoplay: false,
  };
  let settings = { ...defaults };
  let userHasInteracted = false;

  const scrollInputEvents = new Set([
    "wheel",
    "mousewheel",
    "touchstart",
    "touchmove",
  ]);

  const nativeAddEventListener = EventTarget.prototype.addEventListener;
  const nativePreventDefault = Event.prototype.preventDefault;

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

  const nativeAnimate = Element.prototype.animate;
  if (typeof nativeAnimate === "function") {
    Element.prototype.animate = function (keyframes, options) {
      const animation = nativeAnimate.call(this, keyframes, options);
      const timelineName = options?.timeline?.constructor?.name;

      if (
        settings.enabled &&
        settings.disableScrollEffects &&
        (timelineName === "ScrollTimeline" || timelineName === "ViewTimeline")
      ) {
        animation.cancel();
      }

      return animation;
    };
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

  nativeAddEventListener.call(window, "__ima_settings__", (event) => {
    const next = event.detail;
    if (!next || typeof next !== "object") return;

    settings = {
      enabled: next.enabled !== false,
      blockHijacking: next.blockHijacking !== false,
      disableScrollEffects: next.disableScrollEffects !== false,
      blockAutoplay: next.blockAutoplay === true,
    };
  });
})();
