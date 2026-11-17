import { useEffect, useRef, useState } from "react";
import type { Character } from "@/lib/character-types";
import { canIllustrateFacingScene, planFacingVisual, renderFacingVisual } from "@/lib/facing-scene-generation";
import { applyFacingVisual, facingCompletedRounds, facingId, facingMediaType, facingVisualMatches,
  findFacingVisualAsset, groupFacingScenes, loadFacingAssets, loadFacingMeeting, loadFacingSettings, saveFacingAsset, shouldCheckFacingVisual,
  type FacingAsset, type FacingMeeting } from "@/lib/facing-storage";

type Check = { meeting: FacingMeeting; character: Character };
type Job = { controller: AbortController; next?: Check };
type Progress = { message?: string; activity?: { id: string; label: string; sceneName: string } };

export function useFacingSceneGeneration(onMeeting: (meeting: FacingMeeting) => void, onAssets: (characterId: string, assets: FacingAsset[]) => void) {
  const jobs = useRef(new Map<string, Job>());
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
    const { meeting, character } = check;
    const anchor = meeting.turns.at(-1);
    const current = loadFacingMeeting(meeting.id);
    const settings = loadFacingSettings().characters[character.id];
    if (!anchor || !current || !settings?.autoVisual?.enabled || !facingVisualMatches(current, anchor, "")) return;
    const job: Job = { controller: new AbortController() };
    jobs.current.set(meeting.id, job);
    const { signal } = job.controller;
    let notice: string | undefined;
    try {
      if (settings.autoVisual.skipNsfw && !await canIllustrateFacingScene(character, meeting, signal)) return;
      const screenedMeeting = loadFacingMeeting(meeting.id);
      if (signal.aborted || !screenedMeeting || !facingVisualMatches(screenedMeeting, anchor, "")) return;
      const assets = loadFacingAssets(character.id);
      const groups = groupFacingScenes(assets, settings.portraitId);
      const plan = await planFacingVisual(character, meeting, groups, signal);
      const latest = loadFacingMeeting(meeting.id);
      if (!plan || signal.aborted || !latest || !facingVisualMatches(latest, anchor, "")) return;
      const options = loadFacingSettings().characters[character.id]?.autoVisual;
      if (!options?.enabled) return;
      const activityId = facingId();
      const currentAssets = loadFacingAssets(character.id);
      let asset = currentAssets.find(item => item.id === plan.asset?.id)
        ?? findFacingVisualAsset(currentAssets, plan.location, plan.name, plan.mode === "scene");
      if (!asset) {
        if (!plan.description) return;
        const group = groups.find(item => item.name === anchor.sceneName);
        const base = group?.portrait?.composition === "full" ? group.portrait : group?.backdrop ?? group?.portrait;
        const activity = plan.mode === "hold" ? { id: activityId, label: plan.name, sceneName: anchor.sceneName } : undefined;
        update(meeting.id, { message: "画面生成中", activity });
        const result = await renderFacingVisual(plan, base, character, options, signal);
        if (signal.aborted) return;
        if (!result) throw new Error("请检查面对面的生图配置。");
        asset = await saveFacingAsset({ id: facingId(), characterId: character.id, category: "portrait", name: plan.name,
          use: plan.mode === "scene" ? "idle" : "reaction", composition: "full", location: plan.location, durationMs: 3500,
        }, result.blob, facingMediaType(result.blob), true);
        if (signal.aborted) return;
        onAssets(character.id, loadFacingAssets(character.id));
      }
      if (!loadFacingSettings().characters[character.id]?.autoVisual?.enabled) return;
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
    if (!shouldCheckFacingVisual(facingCompletedRounds(meeting), settings)) return;
    const job = jobs.current.get(meeting.id);
    const next = { meeting, character };
    if (job) job.next = next;
    else void run(next);
  }

  return { check, progress };
}
