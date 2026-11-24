import { throwIfAborted } from "./abort-utils";
import { getChatImageFromIndexedDB } from "./chat-asset-storage";
import type { Character } from "./character-types";
import { facingTurnText, type FacingAsset, type FacingAutoVisualSettings, type FacingMeeting, type FacingSceneGroup } from "./facing-storage";
import { generateImageFromConfiguredApi, resolveConfiguredImageGenerationSettings } from "./image-generation-service";
import { canIllustrateScene, SCENE_IMAGE_ORIENTATION_GUIDANCE } from "./scene-image-analysis";
import { loadShownImageDataUrl } from "./shown-image";
import { getThemeAssetDataUrl } from "./theme-storage";
import { fileToUserAvatarDataUrl } from "./user-avatar-image";

type ScenePlan = {
  location: string;
  name: string;
  mode: "scene" | "hold" | "brief" | "replacement";
  description: string;
  asset?: FacingAsset;
};

function facingVisualContext(character: Character, meeting: FacingMeeting) {
  return { 角色: character.name, 人设: character.persona?.slice(0, 1800), 当前地点: meeting.turns.at(-1)?.sceneName,
    最近互动: meeting.turns.slice(-10).map(turn => ({ 说话者: turn.role, 地点: turn.sceneName, 内容: facingTurnText(turn).slice(0, 1600) })),
  };
}

export function canIllustrateFacingScene(character: Character, meeting: FacingMeeting, signal: AbortSignal) {
  return canIllustrateScene({ characterId: character.id, characterName: character.name, appId: "facing",
    context: JSON.stringify(facingVisualContext(character, meeting)), signal });
}

export async function planFacingVisual(character: Character, meeting: FacingMeeting, _groups: FacingSceneGroup[], signal: AbortSignal): Promise<ScenePlan | undefined> {
  throwIfAborted(signal);
  const turn = meeting.turns.at(-1);
  if (!turn?.sceneName) return;
  const settings = (await import("./facing-storage")).loadFacingSettings().characters[meeting.characterId]?.autoVisual;
  if (settings?.skipNsfw && turn.visualRating !== "safe") return;
  return { location: turn.sceneName, name: `${turn.sceneName} · CG`, mode: "replacement",
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
  if (config.provider === "novelai") throw new Error("自动补图需要支持参考图的生图配置。");
  if (!base) throw new Error("请先给当前场景添加基础图。");
  const sourceMode = options.referenceSource ?? "character";
  const configured = config.characterReferences?.[character.id];
  const custom = sourceMode === "upload" && options.referenceMediaRef ? await loadShownImageDataUrl(options.referenceMediaRef) : undefined;
  const saved = sourceMode === "character" && configured?.assetId && configured.enabled !== false
    ? await getChatImageFromIndexedDB(configured.assetId) : undefined;
  const roleSource = sourceMode === "upload" ? custom : saved || character.avatar;
  if (!roleSource) throw new Error("请在自动补图设置里选择一张角色参考图。");
  const [sceneImage, roleImage] = await Promise.all([stillSceneReference(base, signal), prepareReference(roleSource, signal)]);
  throwIfAborted(signal);
  if (!sceneImage || !roleImage) throw new Error("场景图或角色参考图读取失败。");
  const description = [
    `生成一张适合手机面对面的 9:16 竖屏完整画面，地点是「${plan.location}」。只输出一幅连贯画面。`,
    "参考板第一格「场景基础图」用于环境和视觉风格，第二格「角色外貌参考」用于人物身份与五官。",
    plan.mode === "scene"
      ? "按描述切换到新环境，延续场景参考的视觉风格。"
      : "沿用场景参考中的房间布局、物件和光线，按用户当前的位置与动作取景。",
    SCENE_IMAGE_ORIENTATION_GUIDANCE,
    "视点为用户眼睛的位置，服装按剧情保持连续。",
    plan.description,
    options.extraPrompt?.trim() ? `用户的CG生图额外要求：${options.extraPrompt.trim()}` : "",
  ].join("\n");
  return generateImageFromConfiguredApi({ description, characterId: character.id, appId: "facing", settings: config,
    explicitReferenceImages: [{ dataUrl: sceneImage, label: "场景基础图" }, { dataUrl: roleImage, label: "角色外貌参考" }],
    referenceSelection: { character: false, user: false }, portraitOutput: true, signal,
  });
}
