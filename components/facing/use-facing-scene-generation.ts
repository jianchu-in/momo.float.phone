import { useEffect, useRef, useState } from "react";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { planFacingVisual, renderFacingVisual } from "@/lib/facing-scene-generation";
import { applyFacingVisual, facingCompletedRounds, facingId, facingMediaType, facingVisualMatches,
  findFacingVisualAsset, groupFacingScenes, loadFacingAssets, loadFacingMeeting, loadFacingSettings, saveFacingAsset, shouldCheckFacingVisual,
  type FacingAsset, type FacingMeeting } from "@/lib/facing-storage";

type Check = { meeting: FacingMeeting; character: Character };
type Job = { controller: AbortController; next?: Check };
type Progress = { message?: string; activity?: { id: string; label: string; sceneName: string } };

export function useFacingSceneGeneration(onMeeting: (meeting: FacingMeeting) => void, onAssets: (characterId: string, assets: FacingAsset[]) => void) {
  const jobs = useRef(new Map<string, Job>());
  const startedRounds = useRef(new Set<string>());
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  useEffect(() => () => { for (const job of jobs.current.values()) job.controller.abort(); }, []);

  function update(meetingId: string, value?: Progress) {
    setProgress(current => {
      const next = { ...current };
      if (value) next[meetingId] = value;
      else delete next[meetingId];
      return next;
    });
  }

  async function run(check: Check) {
    const { meeting } = check;
    const character = loadCharacters().find(item => item.id === meeting.turns.at(-1)?.speakerId) ?? check.character;
    const anchor = meeting.turns.at(-1);
    const current = loadFacingMeeting(meeting.id);
    const own = loadFacingSettings().characters[character.id];
    const primary = loadFacingSettings().characters[meeting.characterId];
    const settings = { ...own, autoVisual: { ...primary?.autoVisual, ...own?.autoVisual, enabled: primary?.autoVisual?.enabled } };
    if (!anchor || !current || !settings?.autoVisual?.enabled || !facingVisualMatches(current, anchor, "")) return;
    const job: Job = { controller: new AbortController() };
    jobs.current.set(meeting.id, job);
    const { signal } = job.controller;
    let notice: string | undefined;
    try {
      const screenedMeeting = loadFacingMeeting(meeting.id);
      if (signal.aborted || !screenedMeeting || !facingVisualMatches(screenedMeeting, anchor, "")) return;
      const assets = loadFacingAssets(character.id);
      const groups = groupFacingScenes(assets, settings.portraitId);
      const plan = await planFacingVisual(character, meeting, groups, signal);
      const latest = loadFacingMeeting(meeting.id);
      if (!plan || signal.aborted || !latest || !facingVisualMatches(latest, anchor, "")) return;
      const options = { ...loadFacingSettings().characters[meeting.characterId]?.autoVisual, ...loadFacingSettings().characters[character.id]?.autoVisual,
        enabled: loadFacingSettings().characters[meeting.characterId]?.autoVisual?.enabled };
      if (!options?.enabled) return;
      const activityId = facingId();
      const currentAssets = loadFacingAssets(character.id);
      const group = groups.find(item => item.name === anchor.sceneName);
      const sharedGroup = groupFacingScenes(loadFacingAssets(meeting.characterId)).find(item => item.name === anchor.sceneName);
      const recorded = [...currentAssets, ...loadFacingAssets(meeting.characterId)].find(item => item.id === anchor.sceneId && item.category === "scene");
      const base = recorded ?? group?.backdrop ?? sharedGroup?.backdrop
        ?? (group?.portrait?.composition === "full" ? group.portrait : sharedGroup?.portrait?.composition === "full" ? sharedGroup.portrait : undefined);
      update(meeting.id, { message: "正在生成本轮新画面…" });
      const result = await renderFacingVisual(plan, base, character, options, signal);
      if (signal.aborted) return;
      if (!result) throw new Error("请检查面对面的生图配置。");
      const asset = await saveFacingAsset({ id: facingId(), characterId: character.id, category: "portrait", name: plan.name,
        use: "reaction", composition: "full", location: plan.location, durationMs: 3500, generated: true,
      }, result.blob, facingMediaType(result.blob));
      if (signal.aborted) return;
      onAssets(character.id, loadFacingAssets(character.id));
      if (!loadFacingSettings().characters[meeting.characterId]?.autoVisual?.enabled) return;
      const saved = await applyFacingVisual(meeting.id, anchor, activityId, plan.location, asset, plan.mode);
      if (saved && !signal.aborted) onMeeting(saved);
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : "";
      const displayable = /^(?:请先为面对面启用生图配置|请检查面对面的生图配置|自动补图需要支持参考图的生图配置|请先给当前场景添加基础图|请在自动补图设置里选择一张角色参考图|场景图或角色参考图读取失败)。$/;
      notice = displayable.test(error) ? error : "本轮画面生成未完成";
    } finally {
      jobs.current.delete(meeting.id);
      if (!signal.aborted) {
        update(meeting.id, notice ? { message: notice } : undefined);
        if (job.next) void run(job.next);
      }
    }
  }

  function check(meeting: FacingMeeting, character: Character) {
    const settings = loadFacingSettings().characters[character.id]?.autoVisual;
    const round = facingCompletedRounds(meeting), key = `${meeting.id}:${round}`;
    if (!shouldCheckFacingVisual(round, settings) || meeting.visual?.round === round || startedRounds.current.has(key)) return;
    startedRounds.current.add(key);
    const job = jobs.current.get(meeting.id);
    const next = { meeting, character };
    if (job) job.next = next;
    else void run(next);
  }

  return { check, progress };
}
