import { kvGet, kvKeysWithPrefix, kvUpdatePersisted, kvUpdatePersistedEntries, registerKvMigration } from "./kv-db";
import { deleteThemeAsset, saveThemeAssetFromBlob } from "./theme-storage";
import type { VnAssetLayout } from "./vn-asset-storage";

export const FACING_SETTINGS_KEY = "ai_phone_facing_settings_v1";
export const FACING_ASSETS_KEY = "ai_phone_facing_assets_v1";
export const FACING_MEETING_PREFIX = "ai_phone_facing_meeting_v1:";
registerKvMigration(FACING_SETTINGS_KEY);
registerKvMigration(FACING_ASSETS_KEY);

export const FACING_REACTIONS = ["微笑", "开心", "生气", "吃醋", "脸红", "坏笑"];
export const FACING_PARTS = ["脸颊", "眼睛", "嘴巴", "耳朵", "胸口", "小腹", "手"];
export const FACING_IMAGE_LOCATIONS = ["客厅", "阳台", "卧室", "书房", "厨房", "户外"] as const;
export const FACING_DEFAULT_SCENE = "默认场景";
export const FACING_DEFAULT_APPEARANCE = { bubbleColor: "#21192d", opacity: 44, textColor: "#fcf7ff", textSize: 14 } as const;
export const FACING_REPLY_LENGTHS = {
  short: { label: "简短", characters: 50 },
  normal: { label: "自然", characters: 150 },
  expanded: { label: "展开", characters: 300 },
} as const;
export const FACING_MEDIA_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/apng,image/avif,video/mp4,video/webm,video/quicktime,.apng";
const MEDIA_TYPES = new Set(FACING_MEDIA_ACCEPT.split(",").filter(value => !value.startsWith(".")));

export type FacingAsset = {
  id: string;
  characterId: string;
  category: "portrait" | "scene";
  name: string;
  use: "idle" | "reaction" | "scene";
  mediaId: string;
  mediaType: string;
  durationMs: number;
  motionMediaId?: string;
  motionMediaType?: string;
  layout?: VnAssetLayout;
  composition?: "full";
  folder?: string;
  portraitIds?: string[];
  generated?: boolean;
  description?: string;
  referenceMode?: "none" | "character" | "avatar";
  npcGender?: "male" | "female";
  location?: string;
};

export type FacingScenePosition = Pick<FacingTurn, "sceneName" | "portraitId" | "sceneId">;
export type FacingSceneGroup = {
  name: string;
  assets: FacingAsset[];
  portrait?: FacingAsset;
  backdrop?: FacingAsset;
  reactions: FacingAsset[];
};

export function facingAssetLocation(asset: FacingAsset) {
  return asset.location?.trim() || (asset.category === "scene" ? asset.name : FACING_DEFAULT_SCENE);
}

export function facingAssetMood(asset: FacingAsset) {
  return asset.use === "reaction" ? asset.name : "默认";
}

export function groupFacingScenes(assets: FacingAsset[], legacyPortraitId?: string): FacingSceneGroup[] {
  const library = assets.filter(asset => asset.category === "portrait" && asset.composition !== "full" && !asset.generated);
  const places = new Map<string, FacingAsset[]>();
  for (const asset of assets.filter(item => !item.generated && (item.category === "scene" || item.composition === "full" || item.location))) {
    const name = facingAssetLocation(asset);
    if (!places.has(name)) places.set(name, []);
    places.get(name)!.push(asset);
  }
  if (!places.size && library.length) places.set(FACING_DEFAULT_SCENE, []);
  return Array.from(places, ([name, groupAssets]) => {
    const backdrop = groupAssets.find(asset => asset.category === "scene");
    const legacy = !backdrop ? groupAssets.find(asset => asset.composition === "full" && asset.use === "idle") : undefined;
    const eligible = backdrop?.portraitIds !== undefined ? library.filter(asset => backdrop.portraitIds!.includes(asset.id))
      : library.filter(asset => !asset.location || facingAssetLocation(asset) === name || facingAssetLocation(asset) === FACING_DEFAULT_SCENE);
    const portrait = legacy ?? eligible.find(asset => asset.id === legacyPortraitId) ?? eligible.find(asset => asset.use === "idle") ?? eligible[0];
    const reactions = legacy ? groupAssets.filter(asset => asset.composition === "full" && asset.use === "reaction") : eligible.filter(asset => asset.use === "reaction");
    return { name, assets: groupAssets, portrait, backdrop, reactions };
  });
}

export async function setFacingScenePortraits(characterId: string, location: string, ids: string[]) {
  await kvUpdatePersisted(FACING_ASSETS_KEY, raw => {
    const assets = readJson<FacingAsset[]>(raw, []);
    const valid = [...new Set(ids)].filter(id => assets.some(asset => asset.id === id && asset.characterId === characterId && asset.category === "portrait" && asset.composition !== "full" && !asset.generated));
    return JSON.stringify(assets.map(asset => asset.characterId === characterId && asset.category === "scene" && facingAssetLocation(asset) === location ? { ...asset, portraitIds: valid } : asset));
  });
}

export function facingScenePosition(group?: FacingSceneGroup): FacingScenePosition {
  return { sceneName: group?.name ?? FACING_DEFAULT_SCENE, portraitId: group?.portrait?.id, sceneId: group?.backdrop?.id };
}

export function facingMeetingPosition(meeting: FacingMeeting): FacingScenePosition {
  return meeting.scene ?? meeting.turns.at(-1) ?? facingScenePosition();
}

export function resolveFacingScene(position: FacingScenePosition, groups: FacingSceneGroup[], assets: FacingAsset[]) {
  const group = groups.find(item => item.name === position.sceneName);
  const recordedPortrait = assets.find(asset => asset.id === position.portraitId);
  const recordedBackdrop = assets.find(asset => asset.id === position.sceneId && asset.category === "scene") ?? readJson<FacingAsset[]>(kvGet(FACING_ASSETS_KEY), []).find(asset=>asset.id===position.sceneId&&asset.category==="scene");
  const allowed = !group?.backdrop?.portraitIds || group.backdrop.portraitIds.includes(recordedPortrait?.id ?? "");
  const portrait = recordedPortrait && allowed && (!group?.backdrop || recordedPortrait.composition !== "full") && (recordedPortrait.composition !== "full" || !recordedPortrait.location || facingAssetLocation(recordedPortrait) === position.sceneName)
    ? recordedPortrait : group?.portrait;
  const backdrop = portrait?.composition === "full" ? undefined : recordedBackdrop ?? group?.backdrop;
  return { portrait, backdrop, position: { sceneName: position.sceneName, portraitId: portrait?.id, sceneId: backdrop?.id } };
}

export type FacingHotspot = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FacingCharacterSettings = {
  portraitLayouts?: Record<string, VnAssetLayout>;
  fallbackNpcGender?: "male" | "female";
  portraitId?: string;
  fullPortraitId?: string;
  sceneId?: string;
  useScene?: boolean;
  length?: keyof typeof FACING_REPLY_LENGTHS | "custom";
  customReplyLength?: number;
  extraPrompt?: string;
  voice?: boolean;
  speechInput?: "browser" | "cloud";
  touch?: boolean;
  touchMode?: "instant" | "collect" | "double";
  appearance?: { bubbleColor?: string; opacity?: number; textColor?: string; textSize?: number };
  memory?: boolean;
  autoVisual?: FacingAutoVisualSettings;
  hotspots?: Record<string, FacingHotspot[]>;
};

export function facingReplyLength(settings: FacingCharacterSettings): number {
  if (settings.length === "custom") {
    const value = settings.customReplyLength;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.max(1, Math.min(10000, Math.round(value))) : 150;
  }
  return FACING_REPLY_LENGTHS[settings.length ?? "short"]?.characters ?? FACING_REPLY_LENGTHS.short.characters;
}

export type FacingAutoVisualSettings = {
  enabled?: boolean;
  interval?: number;
  skipNsfw?: boolean;
  referenceSource?: "character" | "avatar" | "upload";
  referenceMediaRef?: string;
  extraPrompt?: string;
  displayRounds?: number;
};

export const FACING_VISUAL_INTERVAL = 5;

export function shouldCheckFacingVisual(round: number, settings?: FacingAutoVisualSettings) {
  const interval = settings?.interval;
  const step = interval && Number.isSafeInteger(interval) && interval > 0 ? interval : FACING_VISUAL_INTERVAL;
  return settings?.enabled === true && round > 0 && round % step === 0;
}

export function facingCgDisplayRounds(settings?: FacingAutoVisualSettings) {
  const interval = Number.isSafeInteger(settings?.interval) && settings!.interval! > 0 ? settings!.interval! : FACING_VISUAL_INTERVAL;
  const value = Number.isSafeInteger(settings?.displayRounds) ? settings!.displayRounds! : 2;
  return Math.max(0, Math.min(interval - 1, value));
}
export function isFacingCgVisible(meeting: FacingMeeting, settings?: FacingAutoVisualSettings) {
  const visual = meeting.visual;
  if (!visual?.replacement || (!visual.manual && visual.sceneName !== facingMeetingPosition(meeting).sceneName) || visual.hidden) return false;
  return visual.manual === true || settings?.enabled === true && facingCgDisplayRounds(settings)>0 && (visual.displayStarted === false || facingCompletedRounds(meeting) - (visual.shownAtRound ?? visual.round ?? 0) < facingCgDisplayRounds(settings));
}
export async function markFacingCgShown(meetingId:string,assetId:string):Promise<FacingMeeting|undefined>{
  let saved:FacingMeeting|undefined;
  await kvUpdatePersisted(FACING_MEETING_PREFIX+meetingId,raw=>{
    const current=readJson<FacingMeeting|null>(raw,null);
    if(!current||current.deletedAt||current.visual?.assetId!==assetId||current.visual.displayStarted!==false)return raw??"null";
    saved={...current,visual:{...current.visual,displayStarted:true,shownAtRound:facingCompletedRounds(current)}};
    return JSON.stringify(saved);
  });
  return saved;
}
export async function toggleFacingCg(meetingId: string, show: boolean): Promise<FacingMeeting> {
  let saved!: FacingMeeting;
  await kvUpdatePersisted(FACING_MEETING_PREFIX + meetingId, raw => {
    const current = readJson<FacingMeeting | null>(raw, null);
    if (!current || current.deletedAt) throw new Error("见面记录不存在。");
    const cg=current.visual?.replacement?current.visual:current.lastCg;
    saved = {...current, visual: cg ? {...cg, manual: show, hidden: !show} : undefined};
    return JSON.stringify(saved);
  });
  return saved;
}

export type FacingSettings = { characterId?: string; participantIds?: string[]; characters: Record<string, FacingCharacterSettings> };

export type FacingTurn = {
  participantIds?:string[];
  id: string;
  role: "user" | "assistant";
  kind: "text" | "voice" | "touch" | "reply";
  text: string;
  speakerId?: string;
  speakerName?: string;
  audioRef?: string;
  action?: string;
  imageRef?: string;
  touches?: string[];
  at: string;
  sceneId?: string;
  sceneName: string;
  useScene?: boolean;
  portraitId?: string;
  reactionId?: string;
  reactionName?: string;
  visualContinuityId?: string;
  visualDescription?: string;
  visualRating?: string;
  replyTo?: string;
  versions?: FacingReplyVersion[];
  versionIndex?: number;
};

export type FacingReplyVersion = FacingScenePosition & Pick<FacingTurn, "text" | "action" | "reactionId" | "reactionName" | "visualContinuityId" | "visualDescription" | "visualRating" | "speakerId" | "speakerName" | "audioRef">;

export function facingReplyVersion(turn: FacingTurn): FacingReplyVersion {
  const { text, action, sceneName, sceneId, portraitId, reactionId, reactionName, visualContinuityId, visualDescription, visualRating, speakerId, speakerName, audioRef } = turn;
  return { text, action, sceneName, sceneId, portraitId, reactionId, reactionName, visualContinuityId, visualDescription, visualRating, speakerId, speakerName, audioRef };
}

export function facingTurnText(turn: FacingTurn): string {
  return [turn.speakerName ? `【${turn.speakerName}】` : "", turn.kind === "touch" && !turn.touches?.length ? `（触碰了${turn.text}）` : turn.text,
    ...(turn.touches ?? []).map(part => `（触碰了${part}）`), turn.imageRef ? "（场景参考图）" : "", turn.action,
    turn.reactionName && !turn.text && !turn.action ? `（${turn.reactionName}）` : ""].filter(Boolean).join("\n");
}

export type FacingMeeting = {
  participantHistoryIds?:string[];
  id: string;
  type: "main" | "branch" | "independent";
  characterId: string;
  identityId: string | null;
  participantIds?: string[];
  parentId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  scene?: FacingScenePosition;
  turns: FacingTurn[];
  completedRounds?: number;
  sceneRevision?: number;
  pausedAt?: string;
  deletedAt?: string;
  mergedFrom?: string[];
  mapContext?: { atlasId: string; placeId: string; participantIds: string[]; secret: boolean; description: string; sceneName?: string };
  lastCg?: FacingMeeting["visual"];
  visual?: { assetId: string; activityId: string; sceneName: string; expiresAt?: number; replacement?: boolean; round?: number; shownAtRound?: number; manual?: boolean; hidden?: boolean; displayStarted?: boolean; characterId?: string };
};

export function facingCompletedRounds(meeting: FacingMeeting) {
  return meeting.completedRounds ?? new Set(meeting.turns.filter(turn => turn.role === "assistant").map(turn => turn.replyTo ?? turn.id)).size;
}

export function facingId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function readJson<T>(raw: string | null, fallback: T): T {
  try { return raw ? JSON.parse(raw) ?? fallback : fallback; } catch { return fallback; }
}

export function loadFacingSettings(): FacingSettings {
  return readJson(kvGet(FACING_SETTINGS_KEY), { characters: {} });
}

export async function saveFacingSettings(characterId: string, patch?: Partial<FacingCharacterSettings>): Promise<FacingSettings> {
  let saved: FacingSettings = { characters: {} };
  await kvUpdatePersisted(FACING_SETTINGS_KEY, raw => {
    const current = readJson<FacingSettings>(raw, { characters: {} });
    const previous = current.characters[characterId];
    const next = { ...previous, ...patch };
    if (patch?.autoVisual) next.autoVisual = { ...previous?.autoVisual, ...patch.autoVisual };
    saved = patch
      ? { ...current, characters: { ...current.characters, [characterId]: next } }
      : { ...current, characterId };
    return JSON.stringify(saved);
  });
  return saved;
}

export async function saveFacingParticipants(ids: string[]): Promise<FacingSettings> {
  const participantIds = [...new Set(ids.filter(Boolean))];
  if (!participantIds.length) throw new Error("请至少选择一位见面角色。");
  let saved: FacingSettings;
  await kvUpdatePersisted(FACING_SETTINGS_KEY, raw => {
    saved = { ...readJson<FacingSettings>(raw, { characters: {} }), characterId: participantIds[0], participantIds };
    return JSON.stringify(saved);
  });
  return saved!;
}

export function loadFacingAssets(characterId: string): FacingAsset[] {
  return readJson<FacingAsset[]>(kvGet(FACING_ASSETS_KEY), []).filter(asset => asset.characterId === characterId);
}

export function facingMediaType(blob: Blob, name = ""): string {
  if (MEDIA_TYPES.has(blob.type)) return blob.type;
  const extension = name.split(".").at(-1)?.toLowerCase();
  const aliases: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", apng: "image/apng", gif: "image/gif", webp: "image/webp", avif: "image/avif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
  return extension && aliases[extension] ? aliases[extension] : "";
}

export async function saveFacingAsset(
  asset: Omit<FacingAsset, "mediaId" | "mediaType">,
  blob: Blob,
  mediaType: string,
  reuseMatching = false,
): Promise<FacingAsset> {
  if (!MEDIA_TYPES.has(mediaType) || !blob.size) throw new Error("请选择支持的图片、动图或视频。");
  if (blob.size > 30 * 1024 * 1024) throw new Error("单个素材最大 30 MB。");
  const mediaId = await saveThemeAssetFromBlob(blob.slice(0, blob.size, mediaType), "facing_media");
  const result = { ...asset, mediaId, mediaType };
  let saved = result;
  try {
    await kvUpdatePersisted(FACING_ASSETS_KEY, raw => {
      const assets = readJson<FacingAsset[]>(raw, []);
      const match = reuseMatching ? findFacingVisualAsset(assets.filter(item => item.characterId === asset.characterId), facingAssetLocation(result), asset.name, asset.use === "idle") : undefined;
      saved = match ?? result;
      return JSON.stringify(match ? assets : [...assets, result]);
    });
  } catch (error) {
    await deleteThemeAsset(mediaId).catch(() => {});
    throw error;
  }
  if (saved.mediaId !== mediaId) await deleteThemeAsset(mediaId).catch(() => {});
  return saved;
}

export function findFacingVisualAsset(assets: FacingAsset[], location: string, name: string, idle: boolean) {
  const key = (value: string) => value.normalize("NFKC").replace(/\s/g, "").toLowerCase();
  const group = groupFacingScenes(assets).find(item => key(item.name) === key(location));
  return idle ? group?.portrait ?? group?.backdrop : group?.reactions.find(asset => key(asset.name) === key(name));
}

export async function updateFacingAsset(asset: FacingAsset) {
  await kvUpdatePersisted(FACING_ASSETS_KEY, raw => JSON.stringify(
    readJson<FacingAsset[]>(raw, []).map(item => item.id === asset.id ? asset : item),
  ));
}

export async function setFacingAssetMotion(asset: FacingAsset, file: File | null) {
  const type = file ? facingMediaType(file, file.name) : undefined;
  if (file && (!type || !/^(?:video\/|image\/(?:gif|webp|apng|png))/.test(type) || !file.size || file.size > 30 * 1024 * 1024)) {
    throw new Error("请选择不超过 30 MB 的 GIF、动图或视频。");
  }
  const id = file ? await saveThemeAssetFromBlob(file.slice(0, file.size, type), "facing_media") : undefined;
  const updated = { ...asset, motionMediaId: id, motionMediaType: type };
  try {
    await updateFacingAsset(updated);
  } catch (error) {
    if (id) await deleteThemeAsset(id).catch(() => {});
    throw error;
  }
  if (asset.motionMediaId) await deleteThemeAsset(asset.motionMediaId).catch(() => {});
  return updated;
}

export async function deleteFacingAssets(characterId: string, assetIds: readonly string[]): Promise<void> {
  const requestedIds = new Set(assetIds);
  if (!requestedIds.size) return;
  const removedIds = new Set<string>();
  const unusedMediaIds = new Set<string>();
  await kvUpdatePersistedEntries({
    [FACING_ASSETS_KEY]: raw => {
      const assets = readJson<FacingAsset[]>(raw, []);
      const remaining = assets.filter(asset => {
        if (asset.characterId !== characterId || !requestedIds.has(asset.id)) return true;
        removedIds.add(asset.id);
        unusedMediaIds.add(asset.mediaId);
        if (asset.motionMediaId) unusedMediaIds.add(asset.motionMediaId);
        return false;
      });
      for (const asset of remaining) {
        unusedMediaIds.delete(asset.mediaId);
        if (asset.motionMediaId) unusedMediaIds.delete(asset.motionMediaId);
      }
      return JSON.stringify(remaining.map(asset => asset.portraitIds ? { ...asset, portraitIds: asset.portraitIds.filter(id => !removedIds.has(id)) } : asset));
    },
    [FACING_SETTINGS_KEY]: raw => {
      const settings = readJson<FacingSettings>(raw, { characters: {} });
      const previous = settings.characters[characterId];
      if (!previous || !removedIds.size) return JSON.stringify(settings);
      const next = { ...previous };
      if (next.portraitId && removedIds.has(next.portraitId)) delete next.portraitId;
      if (next.fullPortraitId && removedIds.has(next.fullPortraitId)) delete next.fullPortraitId;
      if (next.sceneId && removedIds.has(next.sceneId)) delete next.sceneId;
      if (next.hotspots) {
        next.hotspots = { ...next.hotspots };
        for (const id of removedIds) delete next.hotspots[id];
      }
      return JSON.stringify({ ...settings, characters: { ...settings.characters, [characterId]: next } });
    },
  });
  await Promise.allSettled(Array.from(unusedMediaIds, deleteThemeAsset));
}

export function loadFacingMeetings(characterId: string, identityId?: string | null, includeParticipants = false): FacingMeeting[] {
  return kvKeysWithPrefix(FACING_MEETING_PREFIX)
    .map(key => readJson<FacingMeeting | null>(kvGet(key), null))
    .filter((record): record is FacingMeeting => !!record && !record.deletedAt && (record.characterId === characterId || (includeParticipants && [...facingParticipantIds(record),...(record.participantHistoryIds??[])].includes(characterId))) && (identityId === undefined || record.identityId === identityId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function loadFacingMeeting(id: string): FacingMeeting | null {
  const record=readJson<FacingMeeting|null>(kvGet(FACING_MEETING_PREFIX + id), null);
  return record?.deletedAt ? null : record;
}

export function facingVisualMatches(meeting: FacingMeeting, anchor: FacingTurn, activityId: string, revision?: number) {
  if (meeting.deletedAt || (revision !== undefined && (meeting.sceneRevision ?? 0) !== revision)) return false;
  const index = meeting.turns.findIndex(turn => turn.id === anchor.id);
  const original = meeting.turns[index];
  if (!original || original.versionIndex !== anchor.versionIndex || original.text !== anchor.text || original.action !== anchor.action) return false;
  const position = facingMeetingPosition(meeting);
  return position.sceneName === anchor.sceneName && position.sceneId === anchor.sceneId
    && meeting.turns.slice(index).every(turn => turn.sceneName === anchor.sceneName && turn.sceneId === anchor.sceneId);
}

export async function applyFacingVisual(meetingId: string, anchor: FacingTurn, activityId: string, location: string,
  asset: FacingAsset, mode: "scene" | "hold" | "brief" | "replacement", revision?: number, generationRound?: number): Promise<FacingMeeting | undefined> {
  let saved: FacingMeeting | undefined;
  await kvUpdatePersisted(FACING_MEETING_PREFIX + meetingId, raw => {
    const meeting = readJson<FacingMeeting | null>(raw, null);
    if (!meeting || !facingVisualMatches(meeting, anchor, activityId, revision) || generationRound !== undefined && (meeting.visual?.round ?? -1) > generationRound) return raw ?? "null";
    const assets = loadFacingAssets(anchor.speakerId ?? meeting.characterId);
    if (!assets.some(item => item.id === asset.id)) return raw!;
    if (mode === "scene") {
      const group = groupFacingScenes(assets).find(item => item.name === location);
      if (!group || (group.portrait?.id !== asset.id && group.backdrop?.id !== asset.id)) return raw!;
      const scene = facingScenePosition(group);
      const last = meeting.turns.at(-1)!;
      const turns = [...meeting.turns.slice(0, -1), { ...last, ...scene }];
      saved = { ...meeting, turns, scene, visual: undefined };
    } else if (location === anchor.sceneName) {
      saved = { ...meeting, visual: { assetId: asset.id, activityId, sceneName: location,
        replacement: mode === "replacement", displayStarted: mode === "replacement" ? false : undefined, characterId: asset.characterId, shownAtRound: facingCompletedRounds(meeting), round: generationRound ?? facingCompletedRounds(meeting), expiresAt: mode === "brief" ? Date.now() + asset.durationMs : undefined } };
    }
    if(saved?.visual?.replacement)saved.lastCg=saved.visual;
    return saved ? JSON.stringify(saved) : raw!;
  });
  return saved;
}

export async function changeFacingTurns(meeting: FacingMeeting, update: (turns: FacingTurn[]) => FacingTurn[]): Promise<FacingMeeting> {
  let saved = meeting;
  await kvUpdatePersisted(FACING_MEETING_PREFIX + meeting.id, raw => {
    const current = readJson(raw, meeting);
    const turns = update(current.turns);
    const last = turns.at(-1);
    const previousLast=current.turns.at(-1);
    const positionChanged=last?.sceneName!==previousLast?.sceneName||last?.sceneId!==previousLast?.sceneId||last?.portraitId!==previousLast?.portraitId;
    const scene = last?.id === previousLast?.id && !positionChanged ? current.scene : last ? facingReplyVersion(last) : current.scene;
    const previous = current.turns.at(-1);
    const visual = last?.id === previous?.id && last?.action === previous?.action && last?.text === previous?.text && last?.versionIndex === previous?.versionIndex
      ? current.visual : undefined;
    const contentChanged=turns.length!==current.turns.length||turns.some((turn,index)=>{const old=current.turns[index];return !old||turn.id!==old.id||turn.text!==old.text||turn.action!==old.action||turn.sceneName!==old.sceneName||turn.sceneId!==old.sceneId||turn.versionIndex!==old.versionIndex;});
    saved = { ...current, turns, sceneRevision: (current.sceneRevision ?? 0) + (contentChanged?1:0), completedRounds: facingCompletedRounds(current), visual,
      scene: scene && { sceneName: scene.sceneName, portraitId: scene.portraitId, sceneId: scene.sceneId } };
    return JSON.stringify(saved);
  });
  return saved;
}

export function createFacingMeeting(
  characterId: string, identityId: string | null, type: FacingMeeting["type"], parent?: FacingMeeting,
): FacingMeeting {
  const now = new Date().toISOString();
  return {
    id: facingId(), characterId, identityId, type, createdAt: now, updatedAt: now,
    participantIds: parent ? facingParticipantIds(parent) : [characterId],
    parentId: parent?.id, title: parent ? `分线 · ${parent.title}` : "", turns: parent?.turns.slice() ?? [], completedRounds: 0,
  };
}

export async function saveFacingMeetingStart(meeting: FacingMeeting, scene: FacingScenePosition): Promise<FacingMeeting> {
  let started = { ...meeting, scene };
  await kvUpdatePersisted(FACING_MEETING_PREFIX + meeting.id, raw => {
    started = readJson(raw, started);
    return JSON.stringify(started);
  });
  return started;
}

export function facingParticipantIds(meeting: FacingMeeting): string[] {
  return [...new Set(meeting.participantIds ?? meeting.mapContext?.participantIds ?? [meeting.characterId])];
}

export async function appendFacingTurn(meeting: FacingMeeting, turn: FacingTurn): Promise<FacingMeeting> {
  return appendFacingTurns(meeting, [turn]);
}

/** Persist a whole reply round atomically; speakers share one user turn and one round. */
export async function appendFacingTurns(meeting: FacingMeeting, incoming: FacingTurn[]): Promise<FacingMeeting> {
  let saved = meeting;
  await kvUpdatePersisted(FACING_MEETING_PREFIX + meeting.id, raw => {
    const current = readJson(raw, meeting);
    const turns = current.turns.slice();
    const rounds = new Set(current.turns.filter(item => item.role === "assistant").map(item => item.replyTo ?? item.id));
    let addedRounds = 0;
    for (const incomingTurn of incoming) {
      const turn=incomingTurn.participantIds?incomingTurn:{...incomingTurn,participantIds:facingParticipantIds(current)};
      if (turns.some(item => item.id === turn.id || (turn.replyTo && item.replyTo === turn.replyTo && item.speakerId === turn.speakerId))) continue;
      const replyIndex = turn.replyTo ? turns.findIndex(item => item.id === turn.replyTo) : -1;
      let insert = replyIndex + 1;
      while (replyIndex >= 0 && insert < turns.length && turns[insert].replyTo === turn.replyTo) insert++;
      if (replyIndex >= 0) turns.splice(insert, 0, turn); else turns.push(turn);
      const round = turn.replyTo ?? turn.id;
      if (turn.role === "assistant" && !rounds.has(round)) { rounds.add(round); addedRounds++; }
    }
    const last = turns.at(-1);
    const turn = incoming.at(-1);
    if (!last || !turn) { saved = current; return JSON.stringify(saved); }
    const previousPosition=facingMeetingPosition(current);
    const moved=previousPosition.sceneName!==last.sceneName||previousPosition.sceneId!==last.sceneId;
    const visual = current.visual && last.id === turn.id && turn.role === "assistant" && (moved
      || (!current.visual.replacement && current.visual.expiresAt === undefined && current.visual.activityId !== turn.visualContinuityId)) ? undefined : current.visual;
    saved = { ...current, title: current.title || incoming[0]?.text.trim().slice(0, 30) || "见面", turns, updatedAt: turn.at,
      visual, completedRounds: facingCompletedRounds(current) + addedRounds,
      sceneRevision: (current.sceneRevision ?? 0) + (current.scene && (current.scene.sceneName !== last.sceneName || current.scene.sceneId !== last.sceneId) ? 1 : 0),
      scene: { sceneName: last.sceneName, sceneId: last.sceneId, portraitId: last.portraitId } };
    return JSON.stringify(saved);
  });
  return saved;
}


export const FACING_SHARED_CHARACTER_ID = "__facing_shared__";
export function loadFacingUsableAssets(characterId: string): FacingAsset[] {
  const own = loadFacingAssets(characterId);
  if (characterId === FACING_SHARED_CHARACTER_ID) return own;
  const shared = loadFacingAssets(FACING_SHARED_CHARACTER_ID);
  const ownSprites = own.filter(item => item.category === "portrait" && item.composition !== "full" && !item.generated);
  const gender = loadFacingSettings().characters[characterId]?.fallbackNpcGender ?? "male";
  return [...own, ...shared.filter(item => item.category === "portrait" && !ownSprites.length && (!item.npcGender || item.npcGender === gender)),
    ...shared.filter(item => item.category === "scene").map(item => ownSprites.length ? { ...item, portraitIds: undefined } : item)];
}
export async function changeFacingScene(meetingId: string, scene: FacingScenePosition): Promise<FacingMeeting> {
  let saved!: FacingMeeting;
  await kvUpdatePersisted(FACING_MEETING_PREFIX + meetingId, raw => {
    const current = readJson<FacingMeeting | null>(raw, null);
    if (!current || current.deletedAt) throw new Error("见面记录不存在。");
    saved = { ...current, lastCg: current.visual?.replacement ? current.visual : current.lastCg, scene, sceneRevision: (current.sceneRevision ?? 0) + 1, visual: undefined, updatedAt: new Date().toISOString() };
    return JSON.stringify(saved);
  });
  return saved;
}
export async function manageFacingMeetings(ids: string[], operation: "delete" | "rename", title = "") {
  if (operation === "rename" && !title.trim()) throw new Error("请填写记录名称。");
  await kvUpdatePersistedEntries(Object.fromEntries([...new Set(ids)].map(id => [FACING_MEETING_PREFIX + id, (raw: string | null) => {
    const current = readJson<FacingMeeting | null>(raw, null);
    if (!current) throw new Error("部分见面记录不存在。");
    return JSON.stringify({ ...current, ...(operation === "delete" ? { deletedAt: new Date().toISOString() } : { title: title.trim() }), updatedAt: new Date().toISOString() });
  }])));
}
export async function mergeFacingMeetings(targetId: string, ids: string[], removeSources = false): Promise<FacingMeeting> {
  const keys = [...new Set([targetId, ...ids])];
  if (keys.length < 2) throw new Error("请至少选择两条见面记录。");
  let saved!: FacingMeeting;
  const records = keys.map(id => loadFacingMeeting(id)).filter((item): item is FacingMeeting => !!item && !item.deletedAt);
  if (records.length !== keys.length) throw new Error("部分见面记录已移除。");
  const target = records.find(item => item.id === targetId)!;
  const cast = (item: FacingMeeting) => facingParticipantIds(item).sort().join("|");
  if (records.some(item => item.identityId !== target.identityId || cast(item) !== cast(target))) throw new Error("只能合并同一用户身份、相同见面角色的记录。");
  const turns = new Map<string, FacingTurn>();
  for (const item of records.sort((a,b) => a.updatedAt.localeCompare(b.updatedAt))) for (const turn of item.turns) {
    const previous=turns.get(turn.id);
    if(!previous){turns.set(turn.id,turn);continue;}
    const selected=facingReplyVersion(turn);
    const versions=[...new Map([...(previous.versions??[facingReplyVersion(previous)]),...(turn.versions??[selected])].map(version=>[JSON.stringify(version),version])).values()];
    turns.set(turn.id,versions.length>1?{...turn,versions,versionIndex:versions.findIndex(version=>JSON.stringify(version)===JSON.stringify(selected))}:turn);
  }
  saved = { ...target, turns: [...turns.values()].sort((a,b) => a.at.localeCompare(b.at)), updatedAt: new Date().toISOString(),
    visual: undefined, mergedFrom: [...new Set([...(target.mergedFrom ?? []), ...keys.filter(id=>id!==targetId)])] };
  saved.completedRounds = new Set(saved.turns.filter(turn=>turn.role === "assistant").map(turn=>turn.replyTo ?? turn.id)).size;
  saved.scene = records.at(-1)?.scene ?? records.at(-1)?.turns.at(-1) ?? target.scene;
  await kvUpdatePersistedEntries(Object.fromEntries(keys.map(id => [FACING_MEETING_PREFIX + id, (raw: string | null) => {
    const current = readJson<FacingMeeting | null>(raw,null);
    if (!current || JSON.stringify(current) !== JSON.stringify(records.find(item=>item.id===id))) throw new Error("记录已更新，请重新选择后合并。");
    return JSON.stringify(id === targetId ? saved : removeSources ? { ...current, deletedAt: new Date().toISOString() } : current);
  }])));
  return saved;
}

export async function replaceFacingAssetMedia(asset: FacingAsset, blob: Blob, mediaType: string): Promise<FacingAsset> {
  if (!MEDIA_TYPES.has(mediaType) || !blob.size || blob.size > 30 * 1024 * 1024) throw new Error("请选择不超过30 MB的有效素材。");
  const mediaId = await saveThemeAssetFromBlob(blob.slice(0,blob.size,mediaType), "facing_media");
  const saved = { ...asset, mediaId, mediaType, motionMediaId:undefined, motionMediaType:undefined };
  try {
    await kvUpdatePersisted(FACING_ASSETS_KEY, raw => {
      const items = readJson<FacingAsset[]>(raw,[]);
      if (!items.some(item=>item.id === asset.id && item.characterId === asset.characterId)) throw new Error("原素材已删除。");
      return JSON.stringify(items.map(item=>item.id === asset.id ? saved : item));
    });
  } catch(error) { await deleteThemeAsset(mediaId).catch(()=>{}); throw error; }
  // Keep media still used by another asset or historical backup reference intact.
  return saved;
}
