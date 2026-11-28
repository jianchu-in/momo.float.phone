import { useEffect, useRef, useState } from "react";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { planFacingVisual, renderFacingVisual } from "@/lib/facing-scene-generation";
import { applyFacingVisual, facingCompletedRounds, facingId, facingMediaType, facingVisualMatches,
  facingEffectiveSettings, facingParticipantIds, groupFacingScenes, loadFacingUsableAssets, loadFacingMeeting, saveFacingAsset, shouldCheckFacingVisual,
  type FacingAsset, type FacingMeeting } from "@/lib/facing-storage";

type VisualOverride = { description:string; depictedCharacterIds:string[]; userVisible:boolean; referenceMode:"text"|"depicted" };
type Check = { meeting: FacingMeeting; character: Character; override?:VisualOverride };
type Job = { controller: AbortController; next?: Check };
type Progress = { message?: string; activity?: { id: string; label: string; sceneName: string } };

export function useFacingSceneGeneration(onMeeting: (meeting: FacingMeeting) => void, onAssets: (characterId: string, assets: FacingAsset[]) => void) {
  const jobs = useRef(new Map<string, Job>());
  const failed=useRef(new Map<string,Check>());
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
    const character = loadCharacters().find(item => item.id === meeting.characterId) ?? check.character;
    const anchor = meeting.turns.at(-1);
    const current = loadFacingMeeting(meeting.id);
    const settings = facingEffectiveSettings(meeting.characterId, undefined, meeting);
    if (!anchor || !current || !settings?.autoVisual?.enabled || !facingVisualMatches(current, anchor, "", meeting.sceneRevision ?? 0)) return;
    const job: Job = { controller: new AbortController() };
    jobs.current.set(meeting.id, job);
    const { signal } = job.controller;
    let notice: string | undefined;
    try {
      const screenedMeeting = loadFacingMeeting(meeting.id);
      if (signal.aborted || !screenedMeeting || !facingVisualMatches(screenedMeeting, anchor, "", meeting.sceneRevision ?? 0)) return;
      const assets = loadFacingUsableAssets(character.id);
      const groups = groupFacingScenes(assets, settings.portraitId);
      const planned = await planFacingVisual(character, meeting, groups, signal);
      const plan = planned && check.override ? {...planned,...check.override} : planned;
      const latest = loadFacingMeeting(meeting.id);
      if (!plan || signal.aborted || !latest || !facingVisualMatches(latest, anchor, "", meeting.sceneRevision ?? 0)) return;
      const configured = facingEffectiveSettings(meeting.characterId, undefined, meeting).autoVisual;
      const options = configured ? {...configured,referenceMode:check.override?.referenceMode??plan.referenceMode??configured.referenceMode,referenceSource:plan.referenceSource??configured.referenceSource} : undefined;
      if (!options?.enabled) return;
      const activityId = facingId();
      const currentAssets = facingParticipantIds(meeting).flatMap(loadFacingUsableAssets);
      const group = groups.find(item => item.name === anchor.sceneName || item.backdrop?.id === anchor.sceneId);
      const sharedGroup = groupFacingScenes(loadFacingUsableAssets(meeting.characterId)).find(item => item.name === anchor.sceneName);
      const recorded = currentAssets.find(item => item.id === anchor.sceneId && item.category === "scene");
      const base = recorded ?? group?.backdrop ?? sharedGroup?.backdrop
        ?? (group?.portrait?.composition === "full" ? group.portrait : sharedGroup?.portrait?.composition === "full" ? sharedGroup.portrait : undefined);
      update(meeting.id, { message: "正在生成 CG 图…" });
      const result = await renderFacingVisual(plan, base, character, options, signal);
      if (signal.aborted) return;
      if (!result) throw new Error("请检查面对面的生图配置。");
      const asset = await saveFacingAsset({ id: facingId(), characterId: character.id, category: "portrait", name: plan.name,
        use: "reaction", composition: "full", location: plan.location, durationMs: 3500, generated: true, userIdentityId: meeting.identityId, description: plan.description, participantIds: plan.participantIds, depictedCharacterIds: plan.depictedCharacterIds, userVisible: plan.userVisible, referenceSource: options.referenceSource, referenceMode: options.referenceMode === "text" ? "none" : "character",
      }, result.blob, facingMediaType(result.blob));
      if (signal.aborted) return;
      onAssets(character.id, loadFacingUsableAssets(character.id));
      if (!facingEffectiveSettings(meeting.characterId, undefined, meeting).autoVisual?.enabled) return;
      const saved = await applyFacingVisual(meeting.id, anchor, activityId, plan.location, asset, plan.mode, meeting.sceneRevision ?? 0, facingCompletedRounds(meeting));
      if (saved && !signal.aborted) {
        if(check.override) {
          const {changeFacingTurns,facingReplyVersion}=await import("@/lib/facing-storage");
          const changed=await changeFacingTurns(saved,turns=>turns.map(turn=>{
            if(turn.id!==anchor.id)return turn;
            const next={...turn,visualDescription:plan.description,visualReferenceMode:options.referenceMode,visualReferenceSource:options.referenceSource,depictedCharacterIds:plan.depictedCharacterIds,userVisible:plan.userVisible};
            return next.versions?{...next,versions:next.versions.map((version,index)=>index===(next.versionIndex??next.versions!.length-1)?facingReplyVersion(next):version)}:next;
          }));onMeeting(changed);
        } else onMeeting(saved);
      }
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : "";
      notice = error || "本轮 CG 生成未完成，可重试";
    } finally {
      jobs.current.delete(meeting.id);
      if(notice)failed.current.set(meeting.id,check);else failed.current.delete(meeting.id);
      if (notice) startedRounds.current.delete(`${meeting.id}:${facingCompletedRounds(meeting)}`);
      if (!signal.aborted) {
        update(meeting.id, notice ? { message: notice } : undefined);
        if (job.next) void run(job.next);
      }
    }
    if(check.override && notice)throw new Error(notice);
  }

  function check(meeting: FacingMeeting, character: Character) {
    const settings = facingEffectiveSettings(character.id, undefined, meeting).autoVisual;
    const round = facingCompletedRounds(meeting), key = `${meeting.id}:${round}`;
    if (!shouldCheckFacingVisual(round, settings) || meeting.visual?.round === round || startedRounds.current.has(key)) return;
    startedRounds.current.add(key);
    const job = jobs.current.get(meeting.id);
    const next = { meeting, character };
    if (job) job.next = next;
    else void run(next);
  }

  return { check, progress, retry:async(id:string,override?:VisualOverride)=>{const prior=failed.current.get(id);if(!prior||jobs.current.has(id))throw new Error("当前没有可以重试的CG任务。");const current=loadFacingMeeting(id);if(!current)throw new Error("见面记录已移除。");await run({...prior,meeting:current,override});} };
}
