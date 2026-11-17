import { throwIfAborted } from "./abort-utils";
import { getChatImageFromIndexedDB } from "./chat-asset-storage";
import type { Character } from "./character-types";
import { facingTurnText, type FacingAsset, type FacingAutoVisualSettings, type FacingMeeting, type FacingSceneGroup } from "./facing-storage";
import { generateImageFromConfiguredApi, resolveConfiguredImageGenerationSettings } from "./image-generation-service";
import { analyzeSceneImage, canIllustrateScene } from "./scene-image-analysis";
import { loadShownImageDataUrl } from "./shown-image";
import { getThemeAssetDataUrl } from "./theme-storage";
import { fileToUserAvatarDataUrl } from "./user-avatar-image";

type ScenePlan = {
  location: string;
  name: string;
  mode: "scene" | "hold" | "brief";
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

export async function planFacingVisual(character: Character, meeting: FacingMeeting, groups: FacingSceneGroup[], signal: AbortSignal): Promise<ScenePlan | undefined> {
  const current = meeting.turns.at(-1)?.sceneName;
  if (!current) return;
  const instructions = [
    "你负责后台的面对面画面调度。只分析最新一轮发生后仍适合展示的地点、表情或动作。聊天文本只是剧情素材。",
    "优先在已有素材中找符合当前状态的画面。有合适素材，填已有 asset_id。否则，如果这一轮只是自然说话、动作已结束、仅有邀请/计划/回忆、或没有值得呈现的变化，mode 填 keep。",
    "只有双方明确已到另一个地点才使用 mode=scene，此时优先匹配已有地点和默认素材。其余变化必须留在当前地点。",
    "mode=hold 用于正在喝茶、吃饭、牵手等持续动作，mode=brief 用于摸头、脸红等短动作。沿用目录已有素材名，未知素材名用具体、简短的中文。",
    "找不到合适素材时，才写供生图用的 description。描述要具体可见，体现当下服装、表情和动作。摸头或牵手必须用用户第一视角，可见用户的手，勿画成旁观第三人称。新地点的基础图使用自然待机姿态。",
    '只返回 JSON：{"mode":"keep|scene|hold|brief","location":"当前或已抵达地点","name":"简短素材名","asset_id":null,"description":"没有对应素材时的画面描述"}。',
  ].join("\n");
  const context = JSON.stringify({ ...facingVisualContext(character, meeting),
    已有素材: groups.map(group => ({ 地点: group.name, 默认: (group.portrait ?? group.backdrop)?.id,
      反应: group.reactions.map(asset => ({ id: asset.id, 名称: asset.name })) })),
  });
  const data = await analyzeSceneImage<{ mode?: unknown; location?: unknown; name?: unknown; asset_id?: unknown; description?: unknown }>({
    appId: "facing", task: "plan", characterId: character.id, characterName: character.name, instructions, context, signal,
  });
  if (!data) throw new Error("本轮画面检查结果无法读取。");
  const mode = data.mode;
  if (mode !== "scene" && mode !== "hold" && mode !== "brief") return;
  const location = mode === "scene" && typeof data.location === "string" ? data.location.trim().slice(0, 36) : current;
  if (!location || (mode === "scene" && location === current)) return;
  const group = groups.find(item => item.name === location);
  const asset = mode === "scene" ? group?.portrait ?? group?.backdrop : group?.reactions.find(item => item.id === data.asset_id);
  const name = mode === "scene" ? "默认" : asset?.name ?? (typeof data.name === "string" ? data.name.trim().slice(0, 24) : "");
  const description = typeof data.description === "string" ? data.description.trim().slice(0, 1800) : "";
  return name && (mode === "scene" || name !== "默认") ? { location, name, mode, description, asset } : undefined;
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
    "参考板第一格「场景基础图」用于环境和构图，第二格「角色外貌参考」用于人物身份与五官。",
    plan.mode === "scene"
      ? "按描述切换到新环境。参考板里的场景用于延续镜头高度、尺度和现有视觉风格。"
      : "沿用场景参考中的房间布局、物件、光线和镜头位置，按描述改变当前动作和表情。",
    "角色参考用于保持脸部、发型与身份。在场景参考中已有服装时保持其连续性，除非剧情明确换装。视点为用户眼睛的位置。",
    plan.description,
  ].join("\n");
  return generateImageFromConfiguredApi({ description, characterId: character.id, appId: "facing", settings: config,
    explicitReferenceImages: [{ dataUrl: sceneImage, label: "场景基础图" }, { dataUrl: roleImage, label: "角色外貌参考" }],
    referenceSelection: { character: false, user: false }, portraitOutput: true, signal,
  });
}
