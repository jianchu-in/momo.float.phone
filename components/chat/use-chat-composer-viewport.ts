"use client";
import { useLayoutEffect, type RefObject } from "react";
import { measureOverlayViewport } from "@/lib/overlay-viewport";

/** Bound the entire composer, including plugins, in its scaled phone's visible area. */
export function useChatComposerViewport(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const composer = ref.current, room = composer?.closest<HTMLElement>(".chat-room-wrapper");
    if (!enabled || !composer || !room) return;
    let frame = 0;
    const set = (key: string, value: number) => {
      const next = `${Math.max(0, Math.round(value))}px`;
      if (composer.style.getPropertyValue(key) !== next) composer.style.setProperty(key, next);
    };
    const measure = () => {
      frame = 0;
      const visible = measureOverlayViewport(room);
      if (!visible) return;
      const header = room.querySelector<HTMLElement>(":scope > .page-header");
      const scale = room.getBoundingClientRect().height / room.clientHeight || 1;
      const headerHeight = header ? header.getBoundingClientRect().height / scale : 0;
      set("--chat-composer-limit", Math.min(visible.height * .5, Math.max(0, visible.top + visible.height - headerHeight)));
      set("--chat-composer-bottom", room.clientHeight - visible.top - visible.height);
      if (headerHeight > 0) room.style.setProperty("--chat-composer-header-height", `${Math.round(headerHeight)}px`);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    for (let node: HTMLElement | null = room; node; node = node.parentElement) observer?.observe(node);
    const header = room.querySelector<HTMLElement>(":scope > .page-header");
    if (header) observer?.observe(header);
    const viewport = window.visualViewport;
    measure();
    window.addEventListener("resize", schedule); window.addEventListener("orientationchange", schedule);window.addEventListener("pageshow", schedule);
    window.addEventListener("scroll", schedule, true);
    viewport?.addEventListener("resize", schedule); viewport?.addEventListener("scroll", schedule);
    return () => {
      window.cancelAnimationFrame(frame); observer?.disconnect();
      window.removeEventListener("resize", schedule);window.removeEventListener("orientationchange", schedule);window.removeEventListener("pageshow", schedule);window.removeEventListener("scroll", schedule, true);
      viewport?.removeEventListener("resize", schedule);viewport?.removeEventListener("scroll", schedule);
      composer.style.removeProperty("--chat-composer-limit");composer.style.removeProperty("--chat-composer-bottom");room.style.removeProperty("--chat-composer-header-height");
    };
  }, [ref, enabled]);
}
