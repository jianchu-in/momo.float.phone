// lib/memories-photo-resolver.ts
// 从自定义 APP「Memories」的相册库中根据对话语境智能匹配照片，供角色在聊天中发送。

import {
  loadInstalledCustomApps,
  readCustomAppCollection,
  writeCustomAppCollection,
} from "./custom-app-storage";
import { isMediaStoreRef } from "./media-cache-storage";

export type MemoriesPhotoRecord = {
  id: string;
  characterId: string;
  prompt?: string;
  details?: string;
  location?: string;
  mediaRef?: string;
  imgUrl?: string;
  source?: "chat" | "generate" | "manual";
  createdAt?: string;
  usedAt?: number;
  useCount?: number;
  aiUsable?: boolean;
};

export type MemoriesPhotoMatchResult = {
  photo: MemoriesPhotoRecord;
  imageUrl: string;
  score: number;
  reasons: string[];
};

export function getMemoriesAppId(): string | null {
  if (typeof window === "undefined") return null;
  const apps = loadInstalledCustomApps();
  const found = apps.find((app) => {
    const name = (app.name || "").trim().toLowerCase();
    const manifestName = (app.manifest?.name || "").trim().toLowerCase();
    const id = (app.id || "").trim().toLowerCase();
    return name === "memories" || manifestName === "memories" || id.includes("memories");
  });
  return found?.id || null;
}

export function loadMemoriesPhotos(): MemoriesPhotoRecord[] {
  const appId = getMemoriesAppId();
  if (!appId) return [];
  const rows = readCustomAppCollection(appId, "photos");
  return (rows as unknown as MemoriesPhotoRecord[]) || [];
}

export function saveMemoriesPhotos(photos: MemoriesPhotoRecord[]): void {
  const appId = getMemoriesAppId();
  if (!appId) return;
  writeCustomAppCollection(appId, "photos", photos as unknown as Array<Record<string, unknown>>);
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/浅金色|奶金色?|灰金色?|金黄色?|金色/g, "金发")
    .replace(/黑色(?=(?:短|长|中|卷|直)?发)/g, "黑发")
    .replace(/夏装|夏季/g, "夏天")
    .replace(/冬装|冬季/g, "冬天")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .replace(/照片|图片|一张|拍一下|拍了|发一下|发给我|给我看|看看|自拍|对镜拍|selfie/gi, "");
}

function textFeatures(value: string): Set<string> {
  const normalized = normalizeText(value);
  const result = new Set<string>();
  const latin = value.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  latin.forEach((item) => result.add(item));
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const pair = normalized.slice(index, index + 2);
    if ([...pair].some((item) => /\p{Script=Han}/u.test(item))) {
      result.add(pair);
    }
  }
  return result;
}

function similarity(a: string, b: string): number {
  if (!a.trim() || !b.trim()) return 0;
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na && nb && (na.includes(nb) || nb.includes(na))) return 1;
  const aa = textFeatures(a);
  const bb = textFeatures(b);
  if (aa.size === 0 || bb.size === 0) return 0;
  let overlap = 0;
  for (const token of aa) {
    if (bb.has(token)) overlap += token.length > 1 ? 2 : 1;
  }
  const denom = Math.max(3, Math.min([...aa].reduce((sum, item) => sum + (item.length > 1 ? 2 : 1), 0), 18));
  return Math.min(1, overlap / denom);
}

function photoSearchText(photo: MemoriesPhotoRecord): string {
  return [
    photo.location,
    photo.prompt,
    photo.details,
  ].filter(Boolean).join(" ");
}

function scorePhoto(photo: MemoriesPhotoRecord, wantedDescription: string): { score: number; reasons: string[] } {
  const search = photoSearchText(photo);
  const semantic = similarity(wantedDescription, search);
  let score = semantic * 10;
  const reasons = [`内容匹配度 ${semantic.toFixed(2)}`];

  const wanted = normalizeText(wantedDescription);

  // 1. 地点强相关加分
  if (photo.location) {
    const normLoc = normalizeText(photo.location);
    if (normLoc && (wanted.includes(normLoc) || normLoc.includes(wanted))) {
      score += 5;
      reasons.push(`命中地点关键词：${photo.location}`);
    }
  }

  // 2. 提示词/标签直接词组命中加分
  if (photo.prompt) {
    const directTerms = photo.prompt
      .split(/[,，;；。\s]+/)
      .map((term) => normalizeText(term))
      .filter((term) => term.length >= 2);
    const hitTerms = directTerms.filter((term) => wanted.includes(term) || term.includes(wanted));
    if (hitTerms.length > 0) {
      score += Math.min(6, 2 + hitTerms.length * 2);
      reasons.push(`命中画面词：${hitTerms.slice(0, 3).join("、")}`);
    }
  }

  // 3. 冷却机制：近期刚用过的照片适度扣分，把未发过的照片优先推出来
  if (photo.usedAt) {
    const hoursSinceUse = (Date.now() - photo.usedAt) / (1000 * 3600);
    if (hoursSinceUse < 24) {
      score -= 8;
      reasons.push("24小时内已使用，优先其他照片");
    } else if (hoursSinceUse < 72) {
      score -= 3;
      reasons.push("3天内已使用");
    }
  }

  return { score, reasons };
}

/**
 * 为角色在聊天发图时，从「Memories」相册中检索最合适的一张照片。
 */
export async function resolveMemoriesPhotoForUse(options: {
  characterId?: string;
  description: string;
}): Promise<MemoriesPhotoMatchResult | null> {
  const description = options.description.trim();
  if (!description) return null;

  const allPhotos = loadMemoriesPhotos();
  if (allPhotos.length === 0) return null;

  // 1. 过滤：属于该角色的照片（或者公共相片/未指定归属）
  const candidatePhotos = allPhotos.filter((photo) => {
    // 关闭 AI 调用的照片跳过
    if (photo.aiUsable === false) return false;
    // 必须有有效的图片地址
    if (!photo.imgUrl && !photo.mediaRef) return false;
    // 如果指定了角色，过滤属于该角色的照片（以及 shared 或未绑角色的照片）
    if (options.characterId) {
      if (photo.characterId && photo.characterId !== "my" && photo.characterId !== options.characterId) {
        return false;
      }
    }
    return true;
  });

  if (candidatePhotos.length === 0) return null;

  // 2. 打分与排序
  const scored = candidatePhotos
    .map((photo) => ({ photo, ...scorePhoto(photo, description) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return null;

  // 3. 门禁阈值：≥ 1.3 分视为有效命中（避免风马牛不相及的生硬配图）
  if (best.score < 1.3) return null;

  // 4. 确定最终展现的图片 URL（优先 imgUrl，次选 mediaRef 协议）
  const imageUrl = best.photo.imgUrl || best.photo.mediaRef;
  if (!imageUrl) return null;

  // 5. 记录使用时间与频次并回写 Memories 私有库
  try {
    const updatedPhotos = allPhotos.map((p) => {
      if (p.id === best.photo.id) {
        return {
          ...p,
          usedAt: Date.now(),
          useCount: (p.useCount || 0) + 1,
        };
      }
      return p;
    });
    saveMemoriesPhotos(updatedPhotos);
  } catch (err) {
    console.warn("[Memories] 记录照片使用记录失败:", err);
  }

  return {
    photo: best.photo,
    imageUrl,
    score: best.score,
    reasons: best.reasons,
  };
}
