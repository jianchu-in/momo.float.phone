import { kvGet, kvSet, kvSetAsync, registerKvMigration } from "./kv-db";
import { loadCharacters } from "./character-storage";
import { readThemeAssetRecords } from "./theme-storage";
import type { MomentPost } from "./moments-types";
import { importShortMemories, loadManualShortMemories, persistShortMemoryChanges } from "./short-term-memory-records";

const KEY = "ai_phone_character_moments_profiles_v1";
registerKvMigration(KEY);
export const CHARACTER_MOMENTS_PROFILE_UPDATED = "character-moments-profile-updated";
export type CharacterMomentsProfile = { coverAssetId?: string; signature?: string };

function loadProfiles(): Record<string, CharacterMomentsProfile> {
  try {
    const value = JSON.parse(kvGet(KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function loadCharacterMomentsProfile(characterId: string): CharacterMomentsProfile {
  const value = loadProfiles()[characterId];
  return { coverAssetId: typeof value?.coverAssetId === "string" ? value.coverAssetId : undefined,
    signature: typeof value?.signature === "string" ? value.signature : undefined };
}

function notifyProfileUpdated(characterId: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CHARACTER_MOMENTS_PROFILE_UPDATED, { detail: { characterId } }));
}

export function saveCharacterMomentsProfile(characterId: string, patch: CharacterMomentsProfile): void {
  if (!characterId) return;
  const profiles = loadProfiles();
  kvSet(KEY, JSON.stringify({ ...profiles, [characterId]: { ...profiles[characterId], ...patch } }));
  notifyProfileUpdated(characterId);
}

function recordCoverMemory(characterId: string, characterName: string, coverAssetId: string, timestamp: string, description?: string): void {
  const id = `moments_cover_${coverAssetId}`;
  if (loadManualShortMemories(characterId).some(entry => entry.id === id)) return;
  const content = "更换了朋友圈封面";
  const photoDescription = description?.trim().slice(0, 500) || undefined;
  importShortMemories(characterId, [{
    id,
    sourceApp: "moments",
    sourceDetail: "moments_cover",
    authorType: "character",
    timestamp,
    content: `[朋友圈] ${characterName}${content}${photoDescription ? `：${photoDescription}` : ""}`,
    memoryScope: "short",
    momentsMeta: { author: characterName, content, photoUrl: `asset://${coverAssetId}`, photoDescription, comments: [] },
  }]);
}

export async function backfillCharacterMomentsCoverMemories(): Promise<void> {
  const profiles = loadProfiles();
  if (!Object.values(profiles).some(profile => profile?.coverAssetId)) return;
  for (const { id, name } of loadCharacters()) {
    const coverAssetId = profiles[id]?.coverAssetId;
    if (!coverAssetId || loadManualShortMemories(id).some(entry => entry.id === `moments_cover_${coverAssetId}`)) continue;
    const [asset] = await readThemeAssetRecords([coverAssetId]);
    if (!asset || !Number.isFinite(Date.parse(asset.updatedAt)) || loadCharacterMomentsProfile(id).coverAssetId !== coverAssetId) continue;
    recordCoverMemory(id, name, coverAssetId, asset.updatedAt);
    await persistShortMemoryChanges(id);
  }
}

export async function saveCharacterMomentsCover(characterId: string, coverAssetId: string, description?: string): Promise<void> {
  if (!characterId) return;
  const profiles = loadProfiles();
  const next = JSON.stringify({ ...profiles, [characterId]: { ...profiles[characterId], coverAssetId } });
  try {
    await kvSetAsync(KEY, next);
  } catch (error) {
    // Restore the previous reference without undoing a newer profile edit.
    const latest = loadProfiles();
    if (latest[characterId]?.coverAssetId === coverAssetId) {
      const restored = { ...latest[characterId], coverAssetId: profiles[characterId]?.coverAssetId };
      latest[characterId] = restored;
      kvSet(KEY, JSON.stringify(latest));
    }
    throw error;
  }
  const characterName = loadCharacters().find(character => character.id === characterId)?.name || "角色";
  recordCoverMemory(characterId, characterName, coverAssetId, new Date().toISOString(), description);
  notifyProfileUpdated(characterId);
  await persistShortMemoryChanges(characterId).catch(error => {
    console.warn("[Moments] cover memory persistence failed:", error);
  });
}

export function saveCharacterMomentsSignature(characterId: string, characterName: string, value: string): void {
  const signature = value.trim();
  if (signature === (loadCharacterMomentsProfile(characterId).signature ?? "")) return;
  saveCharacterMomentsProfile(characterId, { signature });
  if (!signature) return;
  const content = `更新了个性签名：“${signature}”`;
  importShortMemories(characterId, [{
    id: `moments_signature_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`,
    sourceApp: "moments",
    sourceDetail: "moments_signature",
    authorType: "character",
    timestamp: new Date().toISOString(),
    content: `[朋友圈] ${characterName}${content}`,
    memoryScope: "short",
    momentsMeta: { author: characterName, content, comments: [] },
  }]);
}

export function getCharacterMomentPosts(posts: MomentPost[], characterId: string): MomentPost[] {
  return posts.filter(post => post.authorType === "character" && post.authorId === characterId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
