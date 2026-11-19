import { jsonrepair } from "jsonrepair";
import { throwIfAborted } from "./abort-utils";
import type { Character } from "./character-types";
import { loadCharacters } from "./character-storage";
import { getCharacterWorldGroup } from "./character-world-storage";
import { buildChatPromptMessages, sendLLMRequestPreferStream } from "./chat-engine";
import { createOrGetSession, loadChatMessages, pushChatMessage } from "./chat-storage";
import { generateImageFromConfiguredApi, resolveConfiguredImageGenerationSettings } from "./image-generation-service";
import { loadMemoryConfig } from "./memory-storage";
import { retrieveCoreMemoriesForPrompt, retrieveMemoriesForPrompt } from "./memory-service";
import { formatCoreMemories, formatLongTermMemories } from "./memory-injector";
import { loadApiConfigs, loadBindingConfig, loadUserIdentities, loadWorldBooks, resolveBinding } from "./settings-storage";
import { loadNativeTimelineAsync, prepareShortTermContext } from "./short-term-assembler";
import { cleanStreamText } from "./stream-preview";
import { isNovelAiResolution } from "./novelai-image-config";
import { getThemeAssetDataUrl } from "./theme-storage";
import { facingId } from "./facing-storage";
import { loadFacingAtlas, mapPlace, mapPlacePath, updateFacingAtlas,
  type FacingAtlas, type FacingMapPage, type MapInvitation, type MapPlace, type MapPoint, type MapPreferences, type MapSnapshot, type MapTile } from "./facing-map-storage";
import type { LLMMessage } from "./llm-prompt-assembler";

export type MapPlan = { description: string; places: MapPlace[] };
export type MapExtension = { tile?: MapTile; direction: "right" | "left" | "top" | "bottom" };
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function coordinate(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1000, value)) : 500; }
export function parseMapPlan(raw: string): MapPlan {
  const data = object(JSON.parse(jsonrepair(raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ""))));
  if (!text(data.description)) throw new Error("地图方案缺少画面描述，请编辑后重试。");
  const places = Array.isArray(data.places) ? data.places : [];
  return { description: text(data.description), places: places.map(object).filter(place => text(place.name)).map(place => ({
    id: facingId(), name: text(place.name).slice(0, 80), description: text(place.description), x: coordinate(place.x), y: coordinate(place.y),
  })) };
}
async function request(lead: Character, instructions: string, content: string | LLMMessage["content"], signal: AbortSignal, vision = false) {
  const slot = resolveBinding(loadBindingConfig(), lead.id, "facing");
  const api = loadApiConfigs().find(item => item.id === slot.apiConfigId);
  if (!api) throw new Error("请先为面对面绑定文字 API。");
  if (vision && !api.enableImageRecognition) throw new Error("请先在文字 API 设置中开启识图。");
  const raw = await sendLLMRequestPreferStream(api, null, [{ role: "system", content: instructions }, { role: "user", content }], [],
    { characterName: lead.name }, { appId: "facing_map", signal, skipOutputRegex: true });
  throwIfAborted(signal);
  return cleanStreamText(raw, { stripXmlTags: ["think", "thinking", "analysis", "reasoning"] }).replace(/^```(?:json)?\s*|\s*```$/gi, "").trim();
}
export async function planFacingMap(lead: Character, atlas: FacingAtlas, page: FacingMapPage, characters: Character[],
  requirement: string, preferences: MapPreferences, signal: AbortSignal, extension?: MapExtension): Promise<MapPlan> {
  const books = loadWorldBooks().filter(book => atlas.worldBookIds.includes(book.id));
  const input = {
    世界: getCharacterWorldGroup(lead.id)?.description, 地图: page.name,
    上级地点: page.parentPlaceId ? mapPlacePath(atlas, page.parentPlaceId) : undefined,
    已有地点: page.places, 扩展方向: extension?.direction,
    用户要求: requirement, 画面描述额外提示词: preferences.descriptionPrompt,
    宽高: [preferences.width, preferences.height],
    角色: characters.filter(character => atlas.characterIds.includes(character.id)).map(({ id, name, persona }) => ({ id, name, persona })),
    世界书: books.map(book => ({ name: book.name, entries: book.entries.filter(entry => !entry.disable).map(entry => entry.content) })),
  };
  const raw = await request(lead, [
    "根据用户选中的世界书、角色与要求，规划一张可交互地图。只返回 JSON，description 是给图片模型的完整地图绘图提示词，places 是地点列表。",
    "图片采用简洁的半俯视地图插画，保持空间结构清楚，提供地点的可见建筑或房间。道路连接由用户后续手动绘制。图片里不画角色头像、文字标签、按钮或UI。",
    page.parentPlaceId ? "这是一个地点的内部平面图，规划房间、设施或楼层区域，保留门与走廊的空间。" : "这是一个世界的局部活动地图，依据人物设定组织住所、工作地和常去地点。",
    extension ? "只规划新增的区域与新地点，在指定边缘延续现有道路、河流和地图视觉风格。" : "",
    "每个地点提供 name、description、x、y。坐标相对于本次生成图片归一化到0至1000，左上为(0,0)，右下为(1000,1000)。在description里说明建筑或房间布局与对应坐标。",
    '返回 {"description":"完整绘图描述","places":[{"name":"地点名","description":"介绍","x":300,"y":450}]}。',
  ].filter(Boolean).join("\n"), JSON.stringify(input), signal);
  return parseMapPlan(raw);
}
export async function mapTileReference(tile: MapTile, direction: MapExtension["direction"]) {
  const source = await getThemeAssetDataUrl(tile.mediaId);
  if (!source) throw new Error("地图参考图片无法读取。");
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("地图参考图片无法读取。")); image.src = source; });
  const canvas = document.createElement("canvas");
  const horizontal = direction === "left" || direction === "right";
  const cropWidth = horizontal ? Math.max(1, Math.round(image.naturalWidth * .18)) : image.naturalWidth;
  const cropHeight = horizontal ? image.naturalHeight : Math.max(1, Math.round(image.naturalHeight * .18));
  canvas.width = cropWidth; canvas.height = cropHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法读取地图边缘。");
  context.drawImage(image, direction === "right" ? image.naturalWidth - cropWidth : 0,
    direction === "bottom" ? image.naturalHeight - cropHeight : 0, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return canvas.toDataURL("image/png");
}
export function extensionPosition(tile: MapTile | undefined, direction: MapExtension["direction"], width: number, height: number): MapPoint {
  if (!tile) return { x: 0, y: 0 };
  return { x: tile.x + (direction === "right" ? tile.width * .82 : direction === "left" ? -width + tile.width * .18 : 0),
    y: tile.y + (direction === "bottom" ? tile.height * .82 : direction === "top" ? -height + tile.height * .18 : 0) };
}
export async function renderFacingMap(lead: Character, plan: MapPlan, preferences: MapPreferences, signal: AbortSignal, extension?: MapExtension) {
  const configured = resolveConfiguredImageGenerationSettings(lead.id, "facing");
  const width = preferences.width, height = preferences.height;
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("请填写有效的图片宽高。");
  const selected = configured.openaiPresets?.find(preset => preset.id === configured.activeOpenAiPresetId) ?? configured.openaiPresets?.[0];
  const settings = { ...configured, size: `${width}x${height}`, openaiPresets: selected
    ? [{ ...selected, size: `${width}x${height}` }] : undefined };
  if (settings.provider === "novelai") {
    if (extension) throw new Error("地图扩展需要支持参考图的生图接口，请切换面对面的生图配置。");
    if (!isNovelAiResolution(settings.size)) throw new Error("这个尺寸不受当前 NovelAI 配置支持，请修改宽高。");
    const novel = configured.novelai;
    if (novel) settings.novelai = { ...novel, presets: novel.presets.map(preset => ({ ...preset, resolution: settings.size })) };
  }
  const edge = extension?.tile ? await mapTileReference(extension.tile, extension.direction) : undefined;
  const result = await generateImageFromConfiguredApi({ characterId: lead.id, appId: "facing", settings,
    description: [plan.description, "只画地图底图，地点名称、头像与UI由程序叠加。",
      extension ? `本图向原地图的${{ left: "左", right: "右", top: "上", bottom: "下" }[extension.direction]}侧扩展；参考图是原图相邻边缘，请在新图对应边缘保留18%的衔接画面，续接道路、河流、建筑尺度与光线。` : "",
      preferences.imagePrompt].filter(Boolean).join("\n"),
    explicitReferenceImage: edge,
    referenceSelection: settings.provider === "novelai" ? undefined : { character: false, user: false },
    signal });
  if (!result) throw new Error("请先启用并配置面对面的生图 API。");
  return result;
}
export async function calibrateFacingMap(lead: Character, page: FacingMapPage, signal: AbortSignal): Promise<MapPlace[]> {
  if (!page.tiles.length || !page.places.length) throw new Error("先添加地图图片与地点。");
  const raw = await request(lead, [
    "识别地图建筑或房间，对照地点列表返回对应的精确坐标。图片依次标明各自的全图边界。",
    "坐标使用整个地图的坐标系。只填写能够识别的地点，无法辨认时省略，保留地点原ID。",
    '仅返回 {"places":[{"id":"地点ID","x":100,"y":200}]}。',
  ].join("\n"), [
    { type: "text", text: JSON.stringify({ 地点: page.places }) },
    ...await Promise.all(page.tiles.map(async tile => {
      const url = await getThemeAssetDataUrl(tile.mediaId);
      if (!url) throw new Error("地图图片无法读取。");
      return [
        { type: "text" as const, text: JSON.stringify({ 图片边界: { x: tile.x, y: tile.y, width: tile.width, height: tile.height } }) },
        { type: "image_url" as const, image_url: { url, detail: "auto" as const } },
      ];
    })).then(parts => parts.flat()),
  ], signal, true);
  const found = object(JSON.parse(jsonrepair(raw))).places;
  if (!Array.isArray(found)) throw new Error("未能读取校准结果。");
  return page.places.map(place => {
    const point = found.map(object).find(item => item.id === place.id);
    return point && typeof point.x === "number" && Number.isFinite(point.x) && typeof point.y === "number" && Number.isFinite(point.y)
      ? { ...place, x: point.x, y: point.y } : place;
  });
}
async function characterMemory(character: Character) {
  const timeline = await loadNativeTimelineAsync(character.id, { appId: "facing" });
  const recent = prepareShortTermContext(character.id, "facing", { history: [], timeline });
  const config = loadMemoryConfig();
  const [core, long] = await Promise.all([retrieveCoreMemoriesForPrompt(character.id, config), retrieveMemoriesForPrompt(character.id, "当前位置、活动、出行计划、邀约与日程", config)]);
  return { id: character.id, name: character.name, persona: character.persona,
    近期记忆: recent.unifiedRecentItems, 核心记忆: core ? formatCoreMemories(core) : "", 长期记忆: long ? formatLongTermMemories(long) : "" };
}
export async function refreshMapActivities(lead: Character, atlas: FacingAtlas, characters: Character[], signal: AbortSignal): Promise<MapSnapshot> {
  const group = getCharacterWorldGroup(lead.id);
  const members = characters.filter(character => group?.memberIds.includes(character.id) ?? atlas.characterIds.includes(character.id));
  const memory = await Promise.all(members.map(characterMemory));
  throwIfAborted(signal);
  const createdAt = new Date().toISOString();
  const input = { 当前时间: createdAt, 角色资料与记忆: memory, 上次动向: atlas.snapshots.at(-1),
    已实际到达: atlas.visits.slice(-12), 可选地点: atlas.pages.flatMap(page => page.places.map(place => ({ id: place.id, path: mapPlacePath(atlas, place.id), description: place.description }))) };
  if (!input.可选地点.length) throw new Error("先添加地图地点，再刷新角色动向。");
  const raw = await request(lead, [
    "根据所有角色的近期记忆、设定、上次动向、已实际到达记录和当前时间，一次生成他们此刻在本世界中的合理位置与活动。",
    "每人返回一条，characterId取自角色资料，placeId必须使用可选地点ID，可定位到内部房间。time填写此活动的ISO时间。不确定的行程保持连贯，不把未来计划当成已发生。",
    '返回 {"entries":[{"characterId":"角色ID","placeId":"地点ID","activity":"正在做什么","time":"ISO时间"}]}。',
  ].join("\n"), JSON.stringify(input), signal);
  const data = object(JSON.parse(jsonrepair(raw))).entries;
  if (!Array.isArray(data)) throw new Error("角色动向格式无效，请重试。");
  const entries = members.map(character => {
    const item = data.map(object).find(entry => entry.characterId === character.id);
    if (!item || !mapPlace(atlas, text(item.placeId)) || !text(item.activity) || !Number.isFinite(Date.parse(text(item.time)))) {
      throw new Error(`${character.name}的动向缺少有效地点或时间，本次结果未保存。`);
    }
    return { characterId: character.id, placeId: text(item.placeId), activity: text(item.activity), time: new Date(text(item.time)).toISOString() };
  });
  return { id: facingId(), createdAt, entries };
}
const invitationJobs = new Set<string>();
export async function answerMapInvitation(lead: Character, atlasId: string, invitationId: string, character: Character, signal: AbortSignal) {
  const jobId = `${invitationId}:${character.id}`;
  if (invitationJobs.has(jobId)) return;
  invitationJobs.add(jobId);
  try {
    const atlas = loadFacingAtlas(atlasId);
    const invitation = atlas?.invitations.find(item => item.id === invitationId);
    const recipient = invitation?.recipients.find(item => item.characterId === character.id);
    if (!atlas || !invitation || !recipient || recipient.status === "accepted" || recipient.status === "declined") return;
    const session = createOrGetSession(character.id, invitation.chatAccountId ?? null);
    const user = loadUserIdentities().find(identity => identity.id === invitation.identityId);
    const destination = mapPlacePath(atlas, invitation.placeId);
    let messageId = recipient.messageId;
    if (!messageId) {
      const party = loadCharacters().filter(item => invitation.recipients.some(recipient => recipient.characterId === item.id)).map(item => item.name).join("、");
      const message = pushChatMessage({ sessionId: session.id, role: "user", senderName: user?.name,
        mediaType: "app_card", content: `邀请你一起前往${destination}。同行角色：${party}。`,
        mediaData: { appName: "面对面", appCardTitle: `邀请你一起去${destination}`, appCardBody: `目的地：${destination}\n同行角色：${party}\n邀请时间：${new Date(invitation.createdAt).toLocaleString("zh-CN")}\n请告诉我你是否愿意一起去。` } });
      messageId = message.id;
      await patchRecipient(atlasId, invitationId, character.id, { messageId, sessionId: session.id, status: "waiting" });
    }
    const existing = loadChatMessages(session.id).find(message => message.role === "assistant" && message.mediaData?.quoteMessageId === messageId);
    let accepted: boolean;
    let reply: string;
    if (existing) { accepted = existing.mediaData?.status === "received"; reply = existing.content; }
    else {
      await patchRecipient(atlasId, invitationId, character.id, { status: "waiting", reply: undefined });
      const built = await buildChatPromptMessages(session, loadChatMessages(session.id), { toolsAllowed: false });
      const raw = await sendLLMRequestPreferStream(built.config, built.preset, [
        ...built.llmMessages, { role: "system", content: `针对最后的出行邀请，结合你的角色设定、记忆、关系和当前安排作出回应。邀请人是${user?.name ?? "用户"}，邀请目的地是${destination}。只输出JSON {"accepted":true或false,"reply":"自然的私聊回应"}。同意才填true。` },
      ], [], { characterName: character.name }, { appId: "facing_map_invitation", signal, skipOutputRegex: true });
      const data = object(JSON.parse(jsonrepair(cleanStreamText(raw, { stripXmlTags: ["think", "thinking"] }).replace(/^```(?:json)?\s*|\s*```$/gi, ""))));
      if (typeof data.accepted !== "boolean" || !text(data.reply)) throw new Error("邀请回应格式无效，可以重试此角色。");
      accepted = data.accepted; reply = text(data.reply);
      pushChatMessage({ sessionId: session.id, role: "assistant", content: reply,
        mediaData: { quoteMessageId: messageId, status: accepted ? "received" : "declined" } });
    }
    await patchRecipient(atlasId, invitationId, character.id, { status: accepted ? "accepted" : "declined", reply });
  } catch (cause) {
    await patchRecipient(atlasId, invitationId, character.id, { status: "failed", reply: cause instanceof Error ? cause.message : "邀请失败，请重试。" });
  } finally { invitationJobs.delete(jobId); }
}
async function patchRecipient(atlasId: string, invitationId: string, characterId: string, patch: Partial<MapInvitation["recipients"][number]>) {
  await updateFacingAtlas(atlasId, atlas => ({ ...atlas, invitations: atlas.invitations.map(item => item.id !== invitationId ? item : {
    ...item, recipients: item.recipients.map(recipient => recipient.characterId === characterId ? { ...recipient, ...patch } : recipient),
  }) }));
}
