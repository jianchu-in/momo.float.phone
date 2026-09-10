"use client";

import type { ComponentProps } from "react";
import { StoryApp as StoryAppBase } from "./story-app-base";
import { StoryScrollFix } from "./story-scroll-fix";

export function StoryApp(props: ComponentProps<typeof StoryAppBase>) {
  return (
    <>
      <StoryScrollFix />
      <StoryAppBase {...props} />
    </>
  );
}
