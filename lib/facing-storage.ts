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
  const locations = new Map<string, FacingAsset[]>();
  for (const asset of assets) {
    const name = facingAssetLocation(asset);
    if (!locations.has(name)) locations.set(name, []);
    locations.get(name)!.push(asset);
  }
  const legacyPortrait = assets.find(asset => asset.id === legacyPortraitId && asset.use === "idle" && asset.composition !== "full")
    ?? assets.find(asset => asset.use === "idle" && asset.composition !== "full");
  const legacyReactions = assets.filter(asset => asset.use === "reaction" && asset.composition !== "full" && !asset.location);
  return Array.from(locations, ([name, groupAssets]) => {
    const full = groupAssets.filter(asset => asset.composition === "full");
    const fullPortrait = full.find(asset => asset.use === "idle");
    const backdrop = fullPortrait ? undefined : groupAssets.find(asset => asset.category === "scene");
    const portrait = fullPortrait
      ?? (backdrop ? legacyPortrait : groupAssets.find(asset => asset.id === legacyPortraitId && asset.use === "idle")
      ?? groupAssets.find(asset => asset.use === "idle"));
    const reactions = fullPortrait ? full.filter(asset => asset.use === "reaction")
      : backdrop ? [...full.filter(asset => asset.use === "reaction"), ...legacyReactions] : groupAssets.filter(asset => asset.use === "reaction");
    return { name, assets: groupAssets, portrait, backdrop, reactions };
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
  const recordedBackdrop = assets.find(asset => asset.id === position.sceneId && asset.category === "scene");
  const portrait = recordedPortrait && (recordedPortrait.composition !== "full" || !recordedPortrait.location || facingAssetLocation(recordedPortrait) === position.sceneName)
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
  portraitId?: string;
  fullPortraitId?: string;
  sceneId?: string;
  useScene?: boolean;
  length?: keyof typeof FACING_REPLY_LENGTHS;
  voice?: boolean;
  speechInput?: "browser" | "cloud";
  touch?: boolean;
  touchMode?: "instant" | "collect" | "double";
  appearance?: { bubbleColor?: string; opacity?: number; textColor?: string; textSize?: number };
  memory?: boolean;
  autoVisual?: FacingAutoVisualSettings;
  hotspots?: Record<string, FacingHotspot[]>;
};

export type FacingAutoVisualSettings = {
  enabled?: boolean;
  interval?: number;
  skipNsfw?: boolean;
  referenceSource?: "character" | "avatar" | "upload";
  referenceMediaRef?: string;
};

export const FACING_VISUAL_INTERVAL = 5;

export function shouldCheckFacingVisual(round: number, settings?: FacingAutoVisualSettings) {
  const interval = settings?.interval;
  const step = interval && Number.isSafeInteger(interval) && interval > 0 ? interval : FACING_VISUAL_INTERVAL;
  return settings?.enabled === true && round > 0 && round % step === 0;
}

export type FacingSettings = { characterId?: string; characters: Record<string, FacingCharacterSettings> };

export type FacingTurn = {
  id: string;
  role: "user" | "assistant";
  kind: "text" | "voice" | "touch" | "reply";
  text: string;
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
  replyTo?: string;
  versions?: FacingReplyVersion[];
  versionIndex?: number;
};

export type FacingReplyVersion = FacingScenePosition & Pick<FacingTurn, "text" | "action" | "reactionId" | "reactionName" | "visualContinuityId">;

export function facingReplyVersion(turn: FacingTurn): FacingReplyVersion {
  const { text, action, sceneName, sceneId, portraitId, reactionId, reactionName, visualContinuityId } = turn;
  return { text, action, sceneName, sceneId, portraitId, reactionId, reactionName, visualContinuityId };
}

export function facingTurnText(turn: FacingTurn): string {
  return [turn.kind === "touch" && !turn.touches?.length ? `（触碰了${turn.text}）` : turn.text,
    ...(turn.touches ?? []).map(part => `（触碰了${part}）`), turn.imageRef ? "（当面展示了一张图片）" : "", turn.action,
    turn.reactionName && !turn.text && !turn.action ? `（${turn.reactionName}）` : ""].filter(Boolean).join("\n");
}

export type FacingMeeting = {
  id: string;
  type: "main" | "branch" | "independent";
  characterId: string;
  identityId: string | null;
  parentId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  scene?: FacingScenePosition;
  turns: FacingTurn[];
  completedRounds?: number;
  pausedAt?: string;
  mapContext?: { atlasId: string; placeId: string; participantIds: string[]; secret: boolean; description: string };
  visual?: { assetId: string; activityId: string; sceneName: string; expiresAt?: number };
};

export function facingCompletedRounds(meeting: FacingMeeting) {
  return meeting.completedRounds ?? meeting.turns.filter(turn => turn.role === "assistant").length;
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
      return JSON.stringify(remaining);
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

export function loadFacingMeetings(characterId: string, identityId?: string | null): FacingMeeting[] {
  return kvKeysWithPrefix(FACING_MEETING_PREFIX)
    .map(key => readJson<FacingMeeting | null>(kvGet(key), null))
    .filter((record): record is FacingMeeting => !!record && record.characterId === characterId && (identityId === undefined || record.identityId === identityId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function loadFacingMeeting(id: string): FacingMeeting | null {
  return readJson(kvGet(FACING_MEETING_PREFIX + id), null);
}

export function facingVisualMatches(meeting: FacingMeeting, anchor: FacingTurn, activityId: string) {
  const latest = meeting.turns.at(-1);
  return latest?.role === "assistant" && latest.sceneName === anchor.sceneName && (
    (latest.id === anchor.id && latest.versionIndex === anchor.versionIndex && latest.text === anchor.text && latest.action === anchor.action)
    || latest.visualContinuityId === activityId);
}

export async function applyFacingVisual(meetingId: string, anchor: FacingTurn, activityId: string, location: string,
  asset: FacingAsset, mode: "scene" | "hold" | "brief"): Promise<FacingMeeting | undefined> {
  let saved: FacingMeeting | undefined;
  await kvUpdatePersisted(FACING_MEETING_PREFIX + meetingId, raw => {
    const meeting = readJson<FacingMeeting | null>(raw, null);
    if (!meeting || !facingVisualMatches(meeting, anchor, activityId)) return raw ?? "null";
    const assets = loadFacingAssets(meeting.characterId);
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
        expiresAt: mode === "brief" ? Date.now() + asset.durationMs : undefined } };
    }
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
    const scene = last ? facingReplyVersion(last) : current.scene;
    const previous = current.turns.at(-1);
    const visual = last?.id === previous?.id && last?.action === previous?.action && last?.text === previous?.text && last?.versionIndex === previous?.versionIndex
      ? current.visual : undefined;
    saved = { ...current, turns, completedRounds: facingCompletedRounds(current), visual,
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

export async function appendFacingTurn(meeting: FacingMeeting, turn: FacingTurn): Promise<FacingMeeting> {
  let saved = meeting;
  await kvUpdatePersisted(FACING_MEETING_PREFIX + meeting.id, raw => {
    const current = readJson(raw, meeting);
    if (current.turns.some(item => item.id === turn.id || (turn.replyTo && item.replyTo === turn.replyTo))) {
      saved = current;
    } else {
      const turns = current.turns.slice();
      const replyIndex = turn.replyTo ? turns.findIndex(item => item.id === turn.replyTo) : -1;
      if (replyIndex >= 0) turns.splice(replyIndex + 1, 0, turn);
      else turns.push(turn);
      const last = turns.at(-1)!;
      const visual = current.visual && last.id === turn.id && turn.role === "assistant" && (current.visual.sceneName !== last.sceneName
        || (current.visual.expiresAt === undefined && current.visual.activityId !== turn.visualContinuityId)) ? undefined : current.visual;
      saved = { ...current, title: current.title || turn.text.trim().slice(0, 30) || "见面", turns, updatedAt: turn.at,
        visual, completedRounds: facingCompletedRounds(current) + Number(turn.role === "assistant"),
        scene: { sceneName: last.sceneName, sceneId: last.sceneId, portraitId: last.portraitId } };
    }
    return JSON.stringify(saved);
  });
  return saved;
}
