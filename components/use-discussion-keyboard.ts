"use client";

import { useLayoutEffect, type RefObject } from "react";

/** Keep WebKit's delayed input reveal from scrolling the phone shell off screen. */
export function useDiscussionKeyboard(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const positions: { node: HTMLElement; top: number; left: number }[] = [];
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      positions.push({ node: parent, top: parent.scrollTop, left: parent.scrollLeft });
    }
    const pageX = window.scrollX, pageY = window.scrollY;
    let frame = 0;
    const restore = () => {
      frame = 0;
      if (!node.contains(document.activeElement)) return;
      for (const saved of positions) {
        if (saved.node.scrollTop !== saved.top) saved.node.scrollTop = saved.top;
        if (saved.node.scrollLeft !== saved.left) saved.node.scrollLeft = saved.left;
      }
      if (window.scrollX !== pageX || window.scrollY !== pageY) window.scrollTo(pageX, pageY);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(restore); };
    // Input focus remains native so iOS can open its keyboard; only ancestors are restored.
    node.addEventListener("focusin", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      node.removeEventListener("focusin", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      for (const saved of positions) { saved.node.scrollTop = saved.top; saved.node.scrollLeft = saved.left; }
    };
  }, [ref]);
}
