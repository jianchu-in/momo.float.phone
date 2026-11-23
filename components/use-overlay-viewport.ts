"use client";
import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";
import { measureOverlayViewport } from "@/lib/overlay-viewport";

/** Local overlays follow the visible viewport without scrolling the page or its shell. */
export function useOverlayViewport(anchor: RefObject<HTMLElement | null>, enabled = true, parent = false) {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    const node = parent ? anchor.current?.parentElement : anchor.current;
    if (!enabled || !node) { setStyle(undefined); return; }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const bounds = measureOverlayViewport(node);
      if (!bounds) return;
      setStyle(previous => previous?.left === bounds.left && previous.top === bounds.top && previous.width === bounds.width && previous.height === bounds.height
        ? previous : { ...bounds, right: "auto", bottom: "auto" });
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };
    const viewport = window.visualViewport;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(node);
    for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) observer?.observe(ancestor);
    measure();
    window.addEventListener("resize", schedule);window.addEventListener("scroll", schedule, true);
    window.addEventListener("orientationchange", schedule);window.addEventListener("pageshow", schedule);
    viewport?.addEventListener("resize", schedule);viewport?.addEventListener("scroll", schedule);
    return () => {
      window.cancelAnimationFrame(frame);observer?.disconnect();
      window.removeEventListener("resize", schedule);window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("orientationchange", schedule);window.removeEventListener("pageshow", schedule);
      viewport?.removeEventListener("resize", schedule);viewport?.removeEventListener("scroll", schedule);
    };
  }, [anchor, enabled, parent]);
  return enabled ? style : undefined;
}
