import { kvGet, kvSet, kvSetAsync, registerKvMigration } from "./kv-db";
import type { MomentPost } from "./moments-types";
import { importShortMemories } from "./short-term-memory-records";

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

export async function saveCharacterMomentsCover(characterId: string, coverAssetId: string): Promise<void> {
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
  notifyProfileUpdated(characterId);
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
