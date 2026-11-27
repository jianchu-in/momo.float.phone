import { useEffect, useRef, useState } from "react";
import { generateStoryIllustrationImage } from "@/lib/story-illustration";
import { loadStoryGlobalSettings, loadStorySessions, saveStoryIllustration, storyReplyVersion,
  type StoryIllustrationDetails, type StoryMessage } from "@/lib/story-storage";

function illustrationKey(message: StoryMessage) {
  return `${message.id}:${message.activeReplyVersionId ?? message.id}`;
}

export function useStoryIllustrations(onChange: (sessionId: string) => void) {
  const jobs = useRef(new Map<string, AbortController>());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => () => { for (const job of jobs.current.values()) job.abort(); }, []);

  async function generate(message: StoryMessage, details: StoryIllustrationDetails, extraPrompt?: string) {
    const key = illustrationKey(message);
    if (jobs.current.has(key)) throw new Error("本轮图片正在生成。");
    const session = loadStorySessions().find(item => item.id === message.sessionId);
    if (!session) throw new Error("找不到这段剧情。");
    details = { ...details, participantIds: [...new Set([session.characterId, ...(session.participantIds ?? [])])] };
    const version = storyReplyVersion(message);
    const job = new AbortController();
    jobs.current.set(key, job);
    setPending(current => new Set(current).add(key));
    try {
      const mediaRef = await generateStoryIllustrationImage(session.characterId, details, extraPrompt, job.signal);
      if (job.signal.aborted) return;
      if (!saveStoryIllustration(message.id, version.id, version.rawContent, { state: "ready", mediaRef, details })) {
        throw new Error("这条剧情已改动，请重新打开图片。");
      }
      onChange(session.id);
    } finally {
      jobs.current.delete(key);
      if (!job.signal.aborted) setPending(current => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  function schedule(message: StoryMessage, extraPrompt?: string) {
    const details = message.illustration?.details;
    if (details) void generate(message, details, extraPrompt).catch(() => {});
  }

  function regenerate(message: StoryMessage, details: StoryIllustrationDetails) {
    return generate(message, details, loadStoryGlobalSettings().illustration?.extraPrompt);
  }

  return { schedule, regenerate, pending: (message: StoryMessage) => pending.has(illustrationKey(message)) };
}
