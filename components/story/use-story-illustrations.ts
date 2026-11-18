import { useEffect, useRef, useState } from "react";
import { generateStoryIllustration } from "@/lib/story-illustration";
import { loadStoryGlobalSettings, loadStoryMessages, loadStorySessions, saveStoryIllustration, storyReplyVersion,
  STORY_ILLUSTRATION_INTERVAL, type StoryMessage } from "@/lib/story-storage";

function illustrationKey(message: StoryMessage) {
  return `${message.id}:${message.activeReplyVersionId ?? message.id}`;
}

export type StoryIllustrationPhase = "planning" | "generating";

export function useStoryIllustrations(onChange: (sessionId: string) => void) {
  const jobs = useRef(new Map<string, AbortController>());
  const [pending, setPending] = useState<ReadonlyMap<string, StoryIllustrationPhase>>(new Map());
  useEffect(() => () => { for (const job of jobs.current.values()) job.abort(); }, []);

  async function start(message: StoryMessage) {
    const key = illustrationKey(message);
    if (jobs.current.has(key)) return;
    const session = loadStorySessions().find(item => item.id === message.sessionId);
    if (!session) return;
    const messages = loadStoryMessages(session.id);
    const index = messages.findIndex(item => item.id === message.id);
    if (index === -1) return;
    const version = storyReplyVersion(message);
    const settings = loadStoryGlobalSettings().illustration ?? {};
    const job = new AbortController();
    const { signal } = job;
    jobs.current.set(key, job);
    let started = false;
    setPending(current => new Map(current).set(key, "planning"));
    try {
      const mediaRef = await generateStoryIllustration({ session, history: messages.slice(Math.max(0, index - 6), index), version, settings, signal,
        onImageStart: () => { started = true; setPending(current => new Map(current).set(key, "generating")); },
      });
      if (!signal.aborted && saveStoryIllustration(message.id, version.id, version.rawContent, mediaRef ? { state: "ready", mediaRef } : undefined)) {
        onChange(session.id);
      }
    } catch {
      if ((!signal.aborted || started) && saveStoryIllustration(message.id, version.id, version.rawContent, { state: "failed" }) && !signal.aborted) onChange(session.id);
    } finally {
      jobs.current.delete(key);
      if (!signal.aborted) setPending(current => {
        if (!current.has(key)) return current;
        const next = new Map(current);
        next.delete(key);
        return next;
      });
    }
  }

  function schedule(message: StoryMessage) {
    const settings = loadStoryGlobalSettings().illustration;
    const interval = settings?.interval ?? STORY_ILLUSTRATION_INTERVAL;
    if (settings?.enabled && message.round && message.round % interval === 0) void start(message);
  }

  return { schedule, retry: start, pending: (message: StoryMessage) => pending.get(illustrationKey(message)) };
}
