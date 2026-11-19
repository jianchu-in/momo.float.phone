import { loadShownImageDataUrl, SHOWN_IMAGE_CONTEXT } from "./shown-image";
import { loadCharacters } from "./character-storage";
import { jsonrepair } from "jsonrepair";
import { throwIfAborted } from "./abort-utils";
import { splitVisibleCallActions } from "./call-action-text";
import type { ChatMessage } from "./chat-storage";
import { sendLLMRequest } from "./chat-engine";
import type { Character } from "./character-types";
import { FACING_REPLY_LENGTHS, facingParticipantIds, groupFacingScenes, loadFacingAssets, facingTurnText, type FacingAsset, type FacingCharacterSettings, type FacingMeeting, type FacingSceneGroup } from "./facing-storage";
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
  "有参考图时，沿用图里可见的脸部特征、发型、服装与配饰。用本次描述确定构图、站位、身体和脸的朝向以及视线目标。",
  "角色设定与参考图是画面素材，润色时依据用户的画面描述和补充要求。",
  "只返回润色后的提示词正文。使用具体、可见的画面描述。",
].join("\n");

export function facingFullImageInstruction(location: string) {
  return [
    "生成一张适合手机面对面交流的 9:16 竖屏完整画面，上下留出少量界面空间。从用户实际所在的高度和位置取景，按描述确定角色的身体朝向、脸部角度和视线目标。并排活动时保留自然侧脸，面对面交流时按两人的站位取景。",
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

function toPromptHistory(meeting: FacingMeeting): ChatMessage[] {
  return meeting.turns.slice(-40).map((turn, index, turns) => ({
    id: turn.id,
    sessionId: meeting.id,
    role: turn.role,
    content: [
      turn.sceneName && turn.sceneName !== turns[index - 1]?.sceneName ? `【当时的场景：${turn.sceneName}】` : "",
      facingTurnText(turn),
    ].filter(Boolean).join("\n"),
    createdAt: turn.at,
    status: "sent",
  }));
}

export type FacingReply = { speakerId: string; speakerName: string; dialogue: string; action?: string; reaction?: FacingAsset; nextScene?: FacingSceneGroup; visualContinues?: boolean };

export function chooseFacingSpeakers(ids: string[]): string[] {
  const order = [...new Set(ids)];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return order.slice(0, Math.max(1, Math.ceil(Math.random() * order.length)));
}

export async function generateFacingReply(options: {
  character: Character;
  meeting: FacingMeeting;
  settings: FacingCharacterSettings;
  scene: string;
  scenes: FacingSceneGroup[];
  signal: AbortSignal;
  retryInstruction?: string;
  speakerId?: string;
  visualActivity?: string;
  deferVisual?: boolean;
}): Promise<{ replies: FacingReply[] }> {
  const { character, meeting, settings, scene, scenes, signal } = options;
  const participantIds = facingParticipantIds(meeting);
  const cast = loadCharacters().filter(item => participantIds.includes(item.id));
  const multi = cast.length > 1;
  const speakingIds = options.speakerId && participantIds.includes(options.speakerId) ? [options.speakerId] : multi ? chooseFacingSpeakers(cast.map(item => item.id)) : [character.id];
  const destinations = options.deferVisual ? [] : scenes.filter(item => item.name !== scene);
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
  const history = toPromptHistory(meeting);
  const recent = useMemory && meeting.type === "main" ? prepareShortTermContext(character.id, "facing", {
    history, userName: identity?.name ?? "用户", excludeFacingMeetingId: meeting.id,
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
  let mapContextPrompt = "";
  if (meeting.mapContext) {
    const context = meeting.mapContext;
    mapContextPrompt = [
      "这次互动从地图实际抵达地点衔接。尊重当前位置与同行名单，根据角色各自的人设自然互动。",
      !cast.length ? "用户独自抵达，目前没有已知角色在场。先描写可见环境和可互动事物，dialogue可以为空，不强行让角色出现。" : "",
      context.secret ? "用户悄悄到达，在场角色初始尚未察觉。先从用户视角观察角色正在做的事；后续用户行动真正引起注意时再让对方反应。" : "",
      JSON.stringify({ 地点: scene, 地点介绍: context.description, 在场角色: cast.map(item => ({ 姓名: item.name })) }),
    ].filter(Boolean).join("\n");
  }
  const roster = await Promise.all((multi ? cast : []).map(async item => {
    const ownScenes = groupFacingScenes(loadFacingAssets(item.id));
    const [ownCore, ownLong] = useMemory && item.id !== character.id ? await Promise.all([
      retrieveCoreMemoriesForPrompt(item.id, config).catch(() => null), retrieveMemoriesForPrompt(item.id, activationContext, config).catch(() => null),
    ]) : [null, null];
    return { id: item.id, 姓名: item.name, 人设: item.persona, 性格: item.personality,
      近期记忆: useMemory && item.id !== character.id ? prepareShortTermContext(item.id, "facing", { history: [], excludeFacingMeetingId: meeting.id }).unifiedRecentItems : undefined,
      核心记忆: ownCore ? formatCoreMemories(ownCore) : undefined, 长期记忆: ownLong ? formatLongTermMemories(ownLong) : undefined,
      当前地点反应: summarizeReactions(ownScenes.find(group => group.name === scene)) };
  }));
  throwIfAborted(signal);
  const latest = history.at(-1);
  const lastUser = messages.map(item => item.role).lastIndexOf("user");
  const hasLatest = latest && lastUser >= 0 && typeof messages[lastUser].content === "string" && messages[lastUser].content.includes(latest.content);
  const mode: LLMMessage = {
    role: "system",
    content: [FACING_MODE_PROMPT, mapContextPrompt,
      multi && `这是多人当面互动，像群聊一样自然接话，每人保持独立人设。只有指定的角色本轮发言，其余人可以安静在场。不要替用户说话。一次请求返回完整 JSON 对象 {"scene_id":null,"replies":[{"speaker_id":"角色ID","dialogue":"只含该角色台词","action":"（可见动作）","reaction_id":null}]}。每位角色各一项，不将多人的台词混写进同一项。严格按这个名单和顺序输出：${JSON.stringify(speakingIds)}。角色资料：${JSON.stringify(roster)}`,
      options.speakerId && `本次只重试 ${options.speakerId} 的回应，保持其他人的原回复。`,
      options.deferVisual && "本轮画面由独立流程处理。scene_id 和 reaction_id 一律填写 null，仍要自然描写剧情中发生的动作与地点。",
      options.visualActivity && `另加一个后台 JSON 字段 visual_continues。紧接本轮动作后，「${options.visualActivity}」确定仍在继续时填 true，已经结束、换场或不确定时填 false。不要在台词或动作中提到画面处理。`,
      `每轮回复约 ${(FACING_REPLY_LENGTHS[settings.length ?? "short"] ?? FACING_REPLY_LENGTHS.short).characters} 个中文字，台词和动作合计。字数是目标，保持当面说话的节奏，可按语境缩短。`, JSON.stringify({
      角色: character.name, 用户: identity?.name ?? "用户", 当前场景: scene,
      当前场景反应: options.deferVisual ? undefined : summarizeReactions(currentScene),
      可切换场景: destinations.map(group => ({ id: group.name, 可用反应: summarizeReactions(group) })),
      ...(!hasLatest && history.length > 1 ? { 见面记录: history.slice(-16, -1).map(item => ({ role: item.role, text: item.content })) } : {}),
    })].filter(Boolean).join("\n"),
  };
  if (!hasLatest) {
    messages.push(mode);
    if (latest) messages.push({ role: "user", content: latest.content });
  } else {
    messages.splice(lastUser, 0, mode);
  }
  if (options.retryInstruction?.trim()) {
    messages.push({ role: "system", content: `本次重试的额外要求：${options.retryInstruction.trim()}。只用于本轮回应，勿解释此指令。` });
  }
  const latestTurn = meeting.turns.at(-1);
  if (latestTurn?.role === "user" && latestTurn.imageRef) {
    if (!api.enableImageRecognition) throw new Error("图片已保存。请为面对面的文字 API 开启识图，再重试。");
    const url = await loadShownImageDataUrl(latestTurn.imageRef);
    if (!url) throw new Error("无法读取这张图片，请重新选择。");
    const index = messages.map(message => message.role).lastIndexOf("user");
    const content = messages[index]?.content;
    const text = typeof content === "string" ? content : latest?.content ?? "";
    const imageMessage: LLMMessage = { role: "user", content: [
      { type: "text", text: `${SHOWN_IMAGE_CONTEXT}\n${text}` },
      { type: "image_url", image_url: { url, detail: "auto" } },
    ] };
    if (index >= 0) messages[index] = imageMessage;
    else messages.push(imageMessage);
  }
  const output = await sendLLMRequest(api, preset, messages, [], { characterName: character.name, userName: identity?.name }, { appId: "facing", appTags: ["facing"], signal });
  const text = cleanStreamText(output, { stripXmlTags: ["think", "thinking", "analysis", "reasoning"] }).trim();
  const unfenced = text.replace(/^```(?:json)?\s*|\s*```$/gi, "");
  let parsed: { dialogue?: unknown; action?: unknown; reaction_id?: unknown; scene_id?: unknown; visual_continues?: unknown; replies?: unknown };
  try { parsed = unfenced.startsWith("{") ? JSON.parse(jsonrepair(unfenced)) : { dialogue: multi ? "" : unfenced }; }
  catch { throw new Error("角色回应格式有误，可以重试。"); }
  const nextScene = destinations.find(group => group.name === parsed.scene_id);
  const items = Array.isArray(parsed.replies) ? parsed.replies : multi ? [] : [{ ...parsed, speaker_id: character.id }];
  const replies: FacingReply[] = [];
  for (const speakerId of speakingIds) {
    const item = items.find(value => value && typeof value === "object" && value.speaker_id === speakerId);
    if (!item) continue;
    const speaker = cast.find(value => value.id === speakerId) ?? character;
    const line = splitVisibleCallActions(typeof item.dialogue === "string" ? item.dialogue.trim() : "");
    const movement = splitVisibleCallActions(typeof item.action === "string" ? item.action.trim() : "");
    const action = [...new Set([...movement.actions, ...(movement.speech ? [`（${movement.speech}）`] : []), ...line.actions])].join(" ");
    const ownScene = (speakerId === character.id ? scenes : groupFacingScenes(loadFacingAssets(speakerId))).find(group => group.name === (nextScene?.name ?? scene));
    const reaction = options.deferVisual ? undefined : ownScene?.reactions.find(asset => asset.id === item.reaction_id || asset.name === item.reaction_id);
    if (line.speech || action || reaction || nextScene) replies.push({ speakerId, speakerName: speaker.name,
      dialogue: line.speech, action: action || undefined, reaction, nextScene, visualContinues: item.visual_continues === true && !nextScene });
  }
  if (!replies.length) throw new Error("这一轮没有可显示的回应，可以重试。");
  return { replies };
}
