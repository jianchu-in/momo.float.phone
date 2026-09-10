"use client";

import { StoryApp as StoryAppBase } from "./story-app-base";
import { StoryScrollFix } from "./story-scroll-fix";

export function StoryApp(props: React.ComponentProps<typeof StoryAppBase>) {
  return (
    <>
      <StoryScrollFix />
      <StoryAppBase {...props} />
    </>
  );
}
