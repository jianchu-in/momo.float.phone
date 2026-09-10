"use client";

import { useEffect } from "react";

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
`;

export function StoryScrollFix() {
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-story-scroll-fix", "true");
    style.textContent = STORY_SCROLL_FIX;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  return null;
}
