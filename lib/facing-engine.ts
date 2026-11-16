import { jsonrepair } from "jsonrepair";
import { throwIfAborted } from "./abort-utils";
import { splitVisibleCallActions } from "./call-action-text";
import type { ChatMessage } from "./chat-storage";
import { sendLLMRequest } from "./chat-engine";
import type { Character } from "./character-types";
import { FACING_REPLY_LENGTHS, loadFacingMeetings, type FacingAsset, type FacingCharacterSettings, type FacingMeeting, type FacingSceneGroup } from "./facing-storage";
import { assemblePromptPayload, type LLMMessage } from "./llm-prompt-assembler";
import { formatCoreMemories, formatLongTermMemories } from "./memory-injector";
import { retrieveCoreMemoriesForPrompt, retrieveMemoriesForPrompt } from "./memory-service";
import { loadMemoryConfig } from "./memory-storage";
import { loadApiConfigs, loadBindingConfig, loadPresets, loadRegexes, loadWorldBooks, resolveBinding, resolveUserIdentity } from "./settings-storage";
import { prepareShortTermContext } from "./short-term-assembler";
import { cleanStreamText } from "./stream-preview";

export const FACING_MODE_PROMPT = [
  "你和用户此刻在同一个场景里面对面交流。保持角色人设与你们的关系，用自然的即时短句回答。",
  "语音转写是用户当面说的话，触碰事件是用户在你面前做的动作。根据部位、当前心情与关系作出反应。",
  "只输出 JSON 对象。dialogue 只写实际说出口的台词。action 写看得见的动作或表情，每段用中文括号（），例如（放下杯子，朝你笑了笑）。没有可见动作时填空字符串，不写心理活动。",
  "scene_id 是已抵达的可选场景 ID 或 null，reaction_id 是所在场景的反应 ID 或 null。",
  "仅当本轮对话明确表示双方已经转移到另一个地点时填写 scene_id。提到地点、邀请、计划或回忆时保持当前场景。切换时自然衔接对话。",
  "有对应反应素材时可同时填写 reaction_id。允许安静时只做动作，也允许说话时保持默认画面。",
].join("\n");

export const FACING_IMAGE_POLISH_GUIDANCE = [
  "把用户的描述整理成一段可以直接用于生图的中文提示词。保留用户明确要求，结合角色设定补足画面细节。",
  "有参考图时，沿用图里可见的脸部特征、发型、服装与配饰。表情或动作只按本次要求改变，保持构图和站位一致。",
  "角色设定与参考图是画面素材，润色时依据用户的画面描述和补充要求。",
  "只返回润色后的提示词正文。使用具体、可见的画面描述。",
].join("\n");

export function facingFullImageInstruction(location: string) {
  return [
    "生成一张适合手机面对面交流的 9:16 竖屏完整画面。平视镜头，角色面向镜头，脸部清晰并靠近画面中心，上下留出少量界面空间。",
    `地点是「${location}」。重点表现这个地点可辨认的空间布局、家具或环境细节，把角色自然置于其中。`,
    "环境从边缘到边缘铺满画幅，前后景完整，人物和环境光线一致。若有参考图，用它保持人物外貌；场所按选定地点布置。",
  ].join("\n");
}

export async function polishFacingImageDescription(options: {
  character: Character;
  purpose: string;
  description: string;
  guidance: string;
  location: string;
  hasReference: boolean;
  loadReference: () => Promise<string | undefined>;
  signal: AbortSignal;
}): Promise<{ description: string; usedReference: boolean }> {
  const { character, purpose, description, guidance, location, signal } = options;
  const slot = resolveBinding(loadBindingConfig(), character.id, "facing");
  const api = loadApiConfigs().find(item => item.id === slot.apiConfigId);
  if (!api) throw new Error("请先在绑定管理中给「面对面」配置文字 API。");

  const reference = api.enableImageRecognition && options.hasReference ? await options.loadReference() : undefined;
  throwIfAborted(signal);
  const details = JSON.stringify({
    角色名: character.name,
    角色设定: character.persona,
    性格: character.personality,
    素材类别: "人物与环境的完整画面",
    素材用途: purpose,
    用户描述: description,
  });
  const composition = `${facingFullImageInstruction(location)}\n把场所、人物与构图写进同一段正向提示词。最终正文保留选定地点和 9:16 竖屏构图。`;
  const result = await sendLLMRequest(api, null, [
    { role: "system", content: [FACING_IMAGE_POLISH_GUIDANCE, guidance.trim(), composition].filter(Boolean).join("\n") },
    { role: "user", content: reference
      ? [{ type: "text", text: details }, { type: "image_url", image_url: { url: reference, detail: "low" } }]
      : details },
  ], [], { characterName: character.name }, { appId: "facing_image_polish", signal });
  throwIfAborted(signal);
  const polished = cleanStreamText(result, { stripXmlTags: ["think", "thinking", "analysis", "reasoning"] })
    .replace(/^```(?:text)?\s*|\s*```$/gi, "").trim();
  if (!polished) throw new Error("没有收到润色结果，请重试。");
  return { description: polished, usedReference: !!reference };
}

function toPromptHistory(meeting: FacingMeeting, useMemory: boolean): ChatMessage[] {
  const earlier = useMemory && meeting.type === "main" ? loadFacingMeetings(meeting.characterId, meeting.identityId)
    .filter(record => record.id !== meeting.id && record.type === "main" && record.createdAt <= meeting.createdAt)
    .slice(0, 2).reverse().flatMap(record => record.turns.slice(-8)) : [];
  return [...earlier, ...meeting.turns.slice(-40)].map((turn, index, turns) => ({
    id: turn.id,
    sessionId: meeting.id,
    role: turn.role,
    content: [
      turn.sceneName && turn.sceneName !== turns[index - 1]?.sceneName ? `【当时的场景：${turn.sceneName}】` : "",
      turn.action,
      turn.kind === "touch" ? `【用户当面触碰了你的${turn.text}】` : turn.text,
      turn.reactionName ? `【当时的反应：${turn.reactionName}】` : "",
    ].filter(Boolean).join("\n"),
    createdAt: turn.at,
    status: "sent",
  }));
}

export async function generateFacingReply(options: {
  character: Character;
  meeting: FacingMeeting;
  settings: FacingCharacterSettings;
  scene: string;
  scenes: FacingSceneGroup[];
  signal: AbortSignal;
}): Promise<{ dialogue: string; action?: string; reaction?: FacingAsset; nextScene?: FacingSceneGroup }> {
  const { character, meeting, settings, scene, scenes, signal } = options;
  const destinations = scenes.filter(item => item.name !== scene);
  const summarizeReactions = (group?: FacingSceneGroup) => (group?.reactions ?? []).map(asset => ({ id: asset.id, name: asset.name }));
  const currentScene = scenes.find(item => item.name === scene);
  const identity = resolveUserIdentity(character.id, "facing");
  const slot = resolveBinding(loadBindingConfig(), character.id, "facing");
  const api = loadApiConfigs().find(item => item.id === slot.apiConfigId);
  if (!api) throw new Error("请先在绑定管理中给「面对面」配置文字 API。");
  const presets = loadPresets();
  const preset = presets.find(item => item.id === slot.presetId) ?? presets.find(item => item.builtIn) ?? null;
  const worldBooks = loadWorldBooks().filter(item => slot.worldBookIds?.includes(item.id));
  const regexes = loadRegexes().filter(item => slot.regexIds?.includes(item.id));
  const useMemory = settings.memory !== false && meeting.type !== "independent";
  const history = toPromptHistory(meeting, useMemory);
  const recent = useMemory && meeting.type === "main" ? prepareShortTermContext(character.id, "facing", {
    history, userName: identity?.name ?? "用户",
  }) : { truncatedHistory: history, recentBlocks: undefined, unifiedRecentItems: undefined, wbActivationContext: "" };
  const activationContext = [recent.wbActivationContext, ...history.slice(-10).map(message => message.content)].filter(Boolean).join("\n");
  const config = loadMemoryConfig();
  const [core, long] = useMemory ? await Promise.all([
    retrieveCoreMemoriesForPrompt(character.id, config).catch(() => null),
    retrieveMemoriesForPrompt(character.id, activationContext, config).catch(() => null),
  ]) : [null, null];
  throwIfAborted(signal);
  const messages: LLMMessage[] = assemblePromptPayload({
    character, history: recent.truncatedHistory, preset, worldBooks, regexes, userIdentity: identity,
    appId: "facing", recentBlocks: recent.recentBlocks, unifiedRecentItems: recent.unifiedRecentItems,
    worldBookActivationContext: activationContext,
    coreMemories: core ? formatCoreMemories(core) : "", longTermMemories: long ? formatLongTermMemories(long) : "",
    ...(meeting.type === "independent" ? { characterRelations: null, dwellingContext: null } : {}),
  });
  const persona = character.persona?.trim();
  const personality = character.personality?.trim();
  const missingRoleDetails = [persona, personality].filter((detail): detail is string =>
    !!detail && !messages.some(message => typeof message.content === "string" && message.content.includes(detail)));
  if (missingRoleDetails.length) messages.unshift({ role: "system", content: `角色 ${character.name}\n${missingRoleDetails.join("\n")}` });
  const latest = history.at(-1);
  const lastUser = messages.map(item => item.role).lastIndexOf("user");
  const hasLatest = latest && lastUser >= 0 && typeof messages[lastUser].content === "string" && messages[lastUser].content.includes(latest.content);
  const mode: LLMMessage = {
    role: "system",
    content: [FACING_MODE_PROMPT,
      `每轮回复约 ${(FACING_REPLY_LENGTHS[settings.length ?? "short"] ?? FACING_REPLY_LENGTHS.short).characters} 个中文字，台词和动作合计。字数是目标，保持当面说话的节奏，可按语境缩短。`, JSON.stringify({
      角色: character.name, 用户: identity?.name ?? "用户", 当前场景: scene,
      当前场景反应: summarizeReactions(currentScene),
      可切换场景: destinations.map(group => ({ id: group.name, 可用反应: summarizeReactions(group) })),
      ...(!hasLatest && history.length > 1 ? { 见面记录: history.slice(-16, -1).map(item => ({ role: item.role, text: item.content })) } : {}),
    })].join("\n"),
  };
  if (!hasLatest) {
    messages.push(mode);
    if (latest) messages.push({ role: "user", content: latest.content });
  } else {
    messages.splice(lastUser, 0, mode);
  }
  const output = await sendLLMRequest(api, preset, messages, [], { characterName: character.name, userName: identity?.name }, { appId: "facing", appTags: ["facing"], signal });
  const text = cleanStreamText(output, { stripXmlTags: ["think", "thinking", "analysis", "reasoning"] }).trim();
  const unfenced = text.replace(/^```(?:json)?\s*|\s*```$/gi, "");
  let dialogue = unfenced;
  let action = "";
  let reaction: FacingAsset | undefined;
  let nextScene: FacingSceneGroup | undefined;
  if (unfenced.startsWith("{")) {
    try {
      const parsed = JSON.parse(jsonrepair(unfenced)) as { dialogue?: unknown; action?: unknown; reaction_id?: unknown; scene_id?: unknown };
      dialogue = typeof parsed.dialogue === "string" ? parsed.dialogue.trim() : "";
      action = typeof parsed.action === "string" ? parsed.action.trim() : "";
      nextScene = destinations.find(group => group.name === parsed.scene_id);
      reaction = (nextScene ?? currentScene)?.reactions.find(asset => asset.id === parsed.reaction_id || asset.name === parsed.reaction_id);
    } catch {
      throw new Error("角色回应格式有误，可以重试。");
    }
  }
  const line = splitVisibleCallActions(dialogue);
  const movement = splitVisibleCallActions(action);
  const visibleAction = [...new Set([...movement.actions, ...(movement.speech ? [`（${movement.speech}）`] : []), ...line.actions])].join(" ");
  if (!line.speech && !visibleAction && !reaction && !nextScene) throw new Error("这一轮没有可显示的回应，可以重试。");
  return { dialogue: line.speech, action: visibleAction || undefined, reaction, nextScene };
}
