import { depictedImageReferences } from "./depicted-image-references";
import { throwIfAborted } from "./abort-utils";
import { getChatImageFromIndexedDB } from "./chat-asset-storage";
import type { Character } from "./character-types";
import { facingEffectiveSettings, facingParticipantIds, facingPromptTurns, facingTurnText, type FacingAsset, type FacingAutoVisualSettings, type FacingMeeting, type FacingSceneGroup } from "./facing-storage";
import { generateImageFromConfiguredApi, resolveConfiguredImageGenerationSettings } from "./image-generation-service";
import { canIllustrateScene, SCENE_IMAGE_ORIENTATION_GUIDANCE } from "./scene-image-analysis";
import { loadShownImageDataUrl } from "./shown-image";
import { getThemeAssetDataUrl } from "./theme-storage";
import { fileToUserAvatarDataUrl } from "./user-avatar-image";

export type ScenePlan = {
  referenceMode?: "text" | "depicted";
  referenceSource?: "character" | "avatar" | "upload";
  participantIds?: string[];
  depictedCharacterIds?: string[];
  userVisible?: boolean;
  location: string;
  name: string;
  mode: "scene" | "hold" | "brief" | "replacement";
  description: string;
  asset?: FacingAsset;
};

function facingVisualContext(character: Character, meeting: FacingMeeting) {
  const turns = facingPromptTurns(meeting);
  return { 角色: character.name, 人设: character.persona?.slice(0, 1800), 当前地点: turns.at(-1)?.sceneName,
    最近互动: turns.slice(-10).map(turn => ({ 说话者: turn.role, 地点: turn.sceneName, 内容: facingTurnText(turn).slice(0, 1600) })),
  };
}

export function canIllustrateFacingScene(character: Character, meeting: FacingMeeting, signal: AbortSignal) {
  return canIllustrateScene({ characterId: character.id, characterName: character.name, appId: "facing",
    context: JSON.stringify(facingVisualContext(character, meeting)), signal });
}

export async function planFacingVisual(character: Character, meeting: FacingMeeting, _groups: FacingSceneGroup[], signal: AbortSignal): Promise<ScenePlan | undefined> {
  throwIfAborted(signal);
  meeting = { ...meeting, turns: facingPromptTurns(meeting) };
  const turn = meeting.turns.at(-1);
  if (!turn?.sceneName) return;
  const settings = facingEffectiveSettings(meeting.characterId, undefined, meeting).autoVisual;
  if (settings?.skipNsfw && turn.visualRating !== "safe") return;
  return { referenceMode: turn.visualReferenceMode, referenceSource: turn.visualReferenceSource, participantIds: facingParticipantIds(meeting), depictedCharacterIds: turn.depictedCharacterIds ?? (facingParticipantIds(meeting).length===1?[meeting.characterId]:undefined), userVisible: turn.userVisible, location: turn.sceneName, name: `${turn.sceneName} · CG`, mode: "replacement",
    description: turn.visualDescription?.trim() || `${character.name}，在「${turn.sceneName}」。${meeting.turns.slice(-4).map(facingTurnText).join("\n")}` };
}

async function stillSceneReference(asset: FacingAsset, signal: AbortSignal): Promise<string | undefined> {
  const source = await getThemeAssetDataUrl(asset.mediaId);
  if (!source) return;
  if (!asset.mediaType.startsWith("video/")) return prepareReference(source, signal);
  throwIfAborted(signal);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  try {
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => {
        window.clearTimeout(timeout);
        signal.removeEventListener("abort", cancel);
        video.onloadeddata = null;
        video.onerror = null;
        if (error) reject(error);
        else resolve();
      };
      const cancel = () => done(new Error("已取消读取参考画面。"));
      const timeout = window.setTimeout(() => done(new Error("无法读取场景视频的参考画面。")), 8000);
      signal.addEventListener("abort", cancel, { once: true });
      video.onloadeddata = () => done();
      video.onerror = () => done(new Error("无法读取场景视频的参考画面。"));
      video.src = source;
    });
    const scale = Math.min(1, 1200 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context || !video.videoWidth) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

async function prepareReference(source: string, signal: AbortSignal) {
  const response = await fetch(source, { signal });
  if (!response.ok) return;
  const blob = await response.blob();
  if (blob.size && blob.type.startsWith("image/")) return fileToUserAvatarDataUrl(new File([blob], "reference", { type: blob.type }), 1200);
}

export async function renderFacingVisual(plan: ScenePlan, base: FacingAsset | undefined, character: Character,
  options: FacingAutoVisualSettings, signal: AbortSignal) {
  const config = resolveConfiguredImageGenerationSettings(character.id, "facing");
  if (!config.enabled) throw new Error("请先为面对面启用生图配置。");
  const textOnly = options.referenceMode === "text";
  const participantIds = plan.participantIds ?? [character.id];
  const roster = plan.depictedCharacterIds ?? (participantIds.length === 1 ? [character.id] : undefined);
  const explicitReferenceImages = textOnly ? [] : await depictedImageReferences({ appId: "facing", leadId: character.id,
    participantIds, depictedCharacterIds: roster, userVisible: plan.userVisible, includeUser: plan.userVisible,
    source: options.referenceSource ?? "character", signal });
  // A composite portrait can contain an off-camera character. Only background assets qualify.
  if (!textOnly && base?.category === "scene" && base.composition !== "full") {
    const sceneImage = await stillSceneReference(base, signal);
    if (!sceneImage) throw new Error("场景参考图读取失败，请更换背景或选择纯文字生图。");
    explicitReferenceImages.unshift({ dataUrl: sceneImage, label: "场景基础图（只参考环境，忽略其中人物）" });
  }
  throwIfAborted(signal);
  const description = [
    `生成一张适合手机面对面的 9:16 竖屏完整画面，地点是「${plan.location}」。只输出一幅连贯画面。`,
    `只画描述中的出镜角色。人物参考按标签ID对应，禁止添加未出镜人物。出镜ID：${JSON.stringify(textOnly ? plan.depictedCharacterIds ?? [] : roster)}。`,
    plan.mode === "scene"
      ? "按描述切换到新环境，延续场景参考的视觉风格。"
      : "沿用场景参考中的房间布局、物件和光线，按用户当前的位置与动作取景。",
    SCENE_IMAGE_ORIENTATION_GUIDANCE,
    "视点为用户眼睛的位置，服装按剧情保持连续。",
    plan.description,
    options.extraPrompt?.trim() ? `用户的CG生图额外要求：${options.extraPrompt.trim()}` : "",
  ].join("\n");
  return generateImageFromConfiguredApi({ description, characterId: character.id, appId: "facing", settings: config,
    explicitReferenceImages, persistResult: false,
    referenceSelection: { character: false, user: false }, portraitOutput: true, signal,
  });
}
