"use client";

import { useEffect } from "react";

const DEFAULT_AUTO_READING_SPEED = 36;

const STORY_SCROLL_FIX = `
.story-app-shell .story-stage {
  flex: 1 1 auto !important;
  min-height: 0 !important;
  overflow-y: auto !important;
  overflow-x: hidden !important;
  touch-action: pan-y !important;
  overscroll-behavior-y: auto !important;
  -webkit-overflow-scrolling: touch;
  scroll-behavior: auto !important;
}

.story-app-shell .story-stage-inner {
  min-height: 100%;
}

.story-app-shell .story-stage[data-story-auto-transform="true"] .story-stage-inner {
  will-change: transform;
}
`;

function StoryTransformAutoReader() {
  useEffect(() => {
    let frame = 0;
    let running = false;
    let virtualPosition = 0;
    let previousTime = 0;
    let stage: HTMLElement | null = null;
    let inner: HTMLElement | null = null;
    let button: HTMLButtonElement | null = null;
    let observer: MutationObserver | null = null;

    const clearTransform = () => {
      if (inner) inner.style.removeProperty("transform");
      if (stage) stage.removeAttribute("data-story-auto-transform");
    };

    const stopFromUser = () => {
      if (!button || button.dataset.reading !== "true") return;
      button.click();
    };

    const finish = () => {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      clearTransform();
      if (button && button.dataset.reading === "true") button.click();
    };

    const tick = (time: number) => {
      if (!running || !stage || !inner || !button || button.dataset.reading !== "true") {
        running = false;
        clearTransform();
        return;
      }

      const elapsed = Math.min(64, Math.max(0, time - previousTime));
      previousTime = time;

      const maxPosition = Math.max(0, stage.scrollHeight - stage.clientHeight);
      virtualPosition = Math.min(maxPosition, virtualPosition + (DEFAULT_AUTO_READING_SPEED * elapsed) / 1000);

      // Native scrollTop may work on Chrome but fail to advance on iOS/PWA.
      // The transform compensates for whatever native scrolling actually did,
      // so the visible story position follows the same virtual position everywhere.
      const nativePosition = stage.scrollTop;
      const transformY = virtualPosition - nativePosition;
      inner.style.setProperty("transform", `translate3d(0, ${transformY * -1}px, 0)`, "important");

      if (virtualPosition >= maxPosition - 0.5) {
        finish();
        return;
      }

      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      stage = document.querySelector<HTMLElement>(".story-app-shell .story-stage");
      inner = stage?.querySelector<HTMLElement>(":scope > .story-stage-inner") || null;
      button = document.querySelector<HTMLButtonElement>(".story-app-shell .story-auto-read-btn");
      if (!stage || !inner || !button || button.dataset.reading !== "true") return;

      if (running) return;
      running = true;
      virtualPosition = Math.max(0, stage.scrollTop);
      previousTime = performance.now();
      stage.setAttribute("data-story-auto-transform", "true");
      frame = requestAnimationFrame(tick);
    };

    const handleStageTouchStart = () => stopFromUser();

    const watch = () => {
      button = document.querySelector<HTMLButtonElement>(".story-app-shell .story-auto-read-btn");
      if (!button) return;
      if (button.dataset.reading === "true") start();
      else if (running) {
        running = false;
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        clearTransform();
      }
    };

    observer = new MutationObserver(watch);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-reading"] });
    document.addEventListener("click", watch, true);

    const attachTouch = () => {
      stage = document.querySelector<HTMLElement>(".story-app-shell .story-stage");
      stage?.addEventListener("touchstart", handleStageTouchStart, { passive: true });
    };
    attachTouch();

    watch();

    return () => {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("click", watch, true);
      stage?.removeEventListener("touchstart", handleStageTouchStart);
      clearTransform();
    };
  }, []);

  return null;
}

export function StoryScrollFix() {
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-story-scroll-fix", "true");
    style.textContent = STORY_SCROLL_FIX;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  return <StoryTransformAutoReader />;
}
