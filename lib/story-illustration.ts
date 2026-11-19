import { jsonrepair } from "jsonrepair";
import { throwIfAborted } from "./abort-utils";
import { loadCharacters } from "./character-storage";
import { generateImageFromConfiguredApi, resolveConfiguredImageGenerationSettings } from "./image-generation-service";
import type { LLMMessage } from "./llm-prompt-assembler";
import { SCENE_IMAGE_COMPOSITION_GUIDANCE, SCENE_IMAGE_ORIENTATION_GUIDANCE } from "./scene-image-analysis";
import { resolveUserIdentity } from "./settings-storage";
import { STORY_ILLUSTRATION_INTERVAL, type StoryIllustration, type StoryIllustrationDetails, type StoryIllustrationSettings } from "./story-storage";
import { stripXmlTagBlocks } from "./stream-preview";

const ILLUSTRATION_TAG = "story_illustration";

export function storyIllustrationSettingsForRound(settings: StoryIllustrationSettings | undefined, round: number | undefined) {
  return settings?.enabled && round && round % (settings.interval ?? STORY_ILLUSTRATION_INTERVAL) === 0 ? settings : undefined;
}

export function buildStoryIllustrationMessages(settings: StoryIllustrationSettings, characterId: string, participantIds?: string[]): LLMMessage[] {
  const ids = new Set([characterId, ...(participantIds ?? [])]);
  const characters = loadCharacters().filter(character => ids.has(character.id)).map(({ id, name, persona, personality }) => ({ id, name, persona, personality }));
  const instructions = [
    "【本轮剧情配图】先按原有格式输出正文、状态栏和摘要等内容。在全部正文及附属区块之后，仅追加一个 <story_illustration>...</story_illustration> 区块。区块内只放 JSON。画面描述与判定只放在区块内。",
    "从本轮正文选择一个实际发生的画面作为横向 4:3 插图，延续前情中的地点、衣着、光线和动作。没有合适画面就填 draw=false。",
    SCENE_IMAGE_COMPOSITION_GUIDANCE,
    ids.size > 1 ? "多人剧情使用纯文字生图，不附任何角色或用户参考图。description 必须根据人设和当前正文交代画面中各人的外貌、衣着、所在位置、动作与朝向，让图像模型理解人物关系。按实际画面选择出镜人物，不强制所有人同时出镜。" : "",
    "character_id 从角色列表选择画面中的主要角色。description 写可见内容。镜头来自用户眼睛或只看到用户的手时填 user_visible=false；能看见用户本人可辨认的外貌时填 true。",
    settings.skipNsfw
      ? "rating 为 safe、nsfw 或 uncertain，判断最新正文中所选的实际画面。直观表现性行为、裸露私密部位或明显露骨色情为 nsfw，普通拥抱、牵手和非露骨的亲吻为 safe，无法判断为 uncertain。只有 safe 能填 draw=true；其他情况填 draw=false。"
      : "",
    `输出示例：<story_illustration>{"draw":true,${settings.skipNsfw ? '"rating":"safe",' : ""}"character_id":"角色ID","user_visible":false,"description":"画面描述"}</story_illustration>。跳过时在同一标签里写 {"draw":false}。`,
    `角色列表 ${JSON.stringify(characters)}`,
  ].filter(Boolean).join("\n");
  const messages: LLMMessage[] = [{ role: "system", content: instructions }];
  const extra = settings.descriptionPrompt?.trim();
  if (extra) messages.push({ role: "system", content: `【画面描述额外提示词】\n以下是用户的构图要求，只用于选择和描述画面。\n${extra}` });
  return messages;
}

export function stripStoryIllustrationBlock(text: string) {
  const visible = text.replace(/<story_illustration\b[^>]*>[\s\S]*?(?:<\/story_illustration\s*>|$)/gi, "");
  // 流式输出可能恰好停在标签的一部分，等下一段再决定它是否属于正文。
  const partial = /<([a-z_]*)(?:\s[^<>]*)?$/i.exec(visible);
  return partial && ILLUSTRATION_TAG.startsWith(partial[1].toLowerCase()) ? visible.slice(0, partial.index) : visible;
}

export function readStoryIllustration(raw: string, settings: StoryIllustrationSettings,
  characterId: string, participantIds?: string[]): StoryIllustration | undefined {
  const content = stripXmlTagBlocks(raw, ["think", "thinking", "analysis", "reasoning"]);
  const block = [...content.matchAll(/<story_illustration\b[^>]*>([\s\S]*?)<\/story_illustration\s*>/gi)].at(-1)?.[1];
  if (!block) return { state: "failed" };
  let plan: { draw?: unknown; character_id?: unknown; user_visible?: unknown; description?: unknown; rating?: unknown } | undefined;
  try {
    plan = JSON.parse(jsonrepair(block.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "")));
  } catch { return { state: "failed" }; }
  if (plan?.draw === false || (settings.skipNsfw && (plan?.rating === "nsfw" || plan?.rating === "uncertain"))) return;
  if (plan?.draw !== true || typeof plan.description !== "string" || !plan.description.trim()
    || (settings.skipNsfw && plan.rating !== "safe")) return { state: "failed" };

  const ids = new Set([characterId, ...(participantIds ?? [])]);
  const focusId = typeof plan.character_id === "string" && ids.has(plan.character_id) ? plan.character_id : characterId;
  return { state: "failed", details: {
    description: plan.description.trim().slice(0, 3000),
    characterId: focusId,
    referenceMode: ids.size > 1 ? "text" : undefined,
    useCharacterReference: ids.size <= 1,
    useUserReference: ids.size <= 1 && settings.includeUserReference === true && plan.user_visible === true && resolveStoryIllustrationReferences(characterId, focusId).hasUserReference,
  } };
}

export function resolveStoryIllustrationReferences(leadId: string, characterId: string) {
  const settings = resolveConfiguredImageGenerationSettings(leadId, "story");
  const user = resolveUserIdentity(leadId, "story");
  const characterRef = settings.characterReferences?.[characterId];
  const userRef = user?.id ? settings.userReferences?.[user.id] : undefined;
  return {
    settings, user,
    hasCharacterReference: Boolean(characterRef?.assetId && characterRef.enabled !== false),
    hasUserReference: Boolean(userRef?.assetId && userRef.enabled !== false),
  };
}

export async function generateStoryIllustrationImage(leadId: string, details: StoryIllustrationDetails, extraPrompt: string | undefined, signal: AbortSignal) {
  const { settings, user, hasCharacterReference, hasUserReference } = resolveStoryIllustrationReferences(leadId, details.characterId);
  const characterReference = details.referenceMode !== "text" && details.useCharacterReference;
  const userReference = details.referenceMode !== "text" && details.useUserReference;
  if (!settings.enabled) throw new Error("请先启用生图配置。");
  if (characterReference && !hasCharacterReference) throw new Error("请先为角色配置参考图，或取消使用角色参考图。");
  if (userReference && !hasUserReference) throw new Error("请先配置用户参考图，或取消使用用户参考图。");
  const description = [
    "生成单幅 4:3 横向剧情插图。",
    SCENE_IMAGE_ORIENTATION_GUIDANCE,
    characterReference && userReference ? "用户与角色同时入镜时，分别使用各自的参考图。" : "",
    details.description.trim(),
    extraPrompt?.trim() ? `【额外生图要求】${extraPrompt.trim()}` : "",
  ].filter(Boolean).join("\n");
  throwIfAborted(signal);
  const image = await generateImageFromConfiguredApi({
    characterId: details.characterId, appId: "story", description, settings,
    referenceSelection: { character: characterReference, user: userReference, identity: user },
    landscapeOutput: true, signal,
  });
  if (!image) throw new Error("请检查剧情的生图配置。");
  return image.mediaRef;
}
