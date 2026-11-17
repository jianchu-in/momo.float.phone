import { useLayoutEffect, useState, type RefObject } from "react";

export function useFacingViewportInset(room: RefObject<HTMLElement | null>) {
  const [inset, setInset] = useState(0);
  useLayoutEffect(() => {
    const element = room.current;
    if (!element) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      if (!rect.height || !element.offsetHeight) return;
      const visibleBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const scale = rect.height / element.offsetHeight;
      setInset(Math.max(0, Math.ceil((rect.bottom - visibleBottom) / scale)));
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    measure();
    return () => {
      window.cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, [room]);
  return inset;
}
