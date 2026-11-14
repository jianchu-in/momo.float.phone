import type { ChatMessage } from "./chat-storage";

const COVER = /朋友圈(?:的)?(?:主页)?(?:的)?(?:封面|背景(?:图)?)/;
const OLD_COVER = /(?:好久|很久|多久|一直|还)?没换(?:过)?/g;
const CHANGE = /换|改|更新|设置|设为|设成|生成|用作|作为|当(?:作|成|你的|你朋友圈)/;
const POINTS_TO_IMAGE = /这(?:张|幅)|那(?:张|幅)|刚(?:才|刚)(?:发|那|给)|发给你的|用它|原图/;
const MAKE_IMAGE = /生成|重画|画(?:一|张)|拍(?:一|张)|新(?:做|画|拍)/;
const DECLINE = /(?:不要|不用|别|先不|不必|不想)(?:再|急着)?(?:换|改|设置|生成|更新)/;
const META_QUESTION = /怎么(?:换|改|设置|生成)|如何(?:换|改|设置|生成)|(?:换|改|生成).{0,14}(?:怎么操作|在哪里|在哪里设置|要不要钱|花额度|要多久)|什么时候换|换过了吗|换好了(?:吗|没)/;
const TAG = /\[(?:采用朋友圈封面图|生成朋友圈封面)[^\]\r\n]*\]/g;
const ACTION = /(?:^|\n)[ \t]*\[(?:采用朋友圈封面图|生成朋友圈封面\s*[:：]\s*(自由|角色|用户|合照)\s*[|｜]\s*([^\]\r\n]{1,300}))\]\s*$/;

export type CoverRequest = { messageId: string; kind: "use_image" | "generate" | "clarify"; imageId?: string };
type CoverSubject = "自由" | "角色" | "用户" | "合照";
export type CoverAction = { kind: "use_image" } | { kind: "generate"; subject: CoverSubject; description: string };

export function isCoverUserMessage(message: ChatMessage): boolean {
  return message.role === "user" && !message.isRetracted && message.status !== "failed" && message.status !== "rejected";
}

export function isCoverUserImage(message: ChatMessage): boolean {
  return isCoverUserMessage(message) && Boolean(message.mediaUrl)
    && (message.mediaType === "image" || (message.mediaType === "media_file" && message.mediaData?.fileType === "image"));
}

export function findCoverRequest(history: ChatMessage[], sessionId: string): CoverRequest | undefined {
  const recent = history.slice(-24).filter(message => message.sessionId === sessionId);
  let start = recent.length;
  while (start > 0 && recent[start - 1].role !== "assistant") start--;
  const turn = recent.slice(start).filter(isCoverUserMessage);
  const text = (message: ChatMessage) => (message.content || message.mediaData?.label || "").replace(/\s+/g, "").slice(0, 400);
  const latest = turn.at(-1);
  if (!latest || DECLINE.test(text(latest))) return undefined;
  const topic = [...turn].reverse().find(message => COVER.test(text(message)));
  const lastReply = recent[start - 1];
  const pointsToEarlierTopic = lastReply && /封面|背景图/.test(text(lastReply))
    && recent.slice(Math.max(0, start - 6), start - 1).some(message => isCoverUserMessage(message) && COVER.test(text(message)));
  const followup = pointsToEarlierTopic && /^(?:那|好[呀啊]?|行|嗯|就|要不)*[，,]?(?:换(?:成|个|张|一张)|用(?:这张|那张|它|我的|我们)|生成|画一张)/.test(text(latest));
  const request = topic || (followup ? latest : undefined);
  if (!request || request.mediaData?.momentsCoverAttempted) return undefined;
  const wording = text(request);
  if (DECLINE.test(wording) || META_QUESTION.test(wording)
    || /(?:我的|我自己的|用户的)朋友圈|^(?:我|用户)(?:刚|已经|又)?(?:换|改|设置)/.test(wording)) return undefined;
  const anchor = Math.max(0, wording.search(COVER));
  const nearby = wording.slice(Math.max(0, anchor - 20), anchor + 35);
  if (!followup && !CHANGE.test(nearby.replace(OLD_COVER, ""))) {
    return /没换/.test(nearby) ? { messageId: request.id, kind: "clarify" } : undefined;
  }
  const quoteId = request.mediaData?.quoteMessageId;
  if (MAKE_IMAGE.test(wording) && !POINTS_TO_IMAGE.test(wording) && !quoteId) return { messageId: request.id, kind: "generate" };
  if (quoteId) {
    const quoted = history.find(message => message.id === quoteId && message.sessionId === sessionId && isCoverUserImage(message));
    if (quoted) return { messageId: request.id, kind: "use_image", imageId: quoted.id };
  }
  let images = turn.filter(isCoverUserImage);
  if (!images.length && POINTS_TO_IMAGE.test(wording)) {
    const time = Date.parse(request.createdAt);
    images = recent.slice(0, start).filter(message => isCoverUserImage(message)
      && Date.parse(message.createdAt) <= time && time - Date.parse(message.createdAt) <= 30 * 60_000);
  }
  if (images.length === 1) return { messageId: request.id, kind: "use_image", imageId: images[0].id };
  if (images.length > 1 || POINTS_TO_IMAGE.test(wording)) return { messageId: request.id, kind: "clarify" };
  return { messageId: request.id, kind: "generate" };
}

export function coverRequestPrompt(request: CoverRequest): string {
  if (request.kind === "clarify") return "当前在聊你的朋友圈封面。自然回应，问用户想用哪张图或想换什么样的封面。";
  const action = request.kind === "use_image"
    ? "用户想用发来的图换你的朋友圈封面。愿意就另起一行以 [采用朋友圈封面图] 结尾。"
    : "用户想换你的朋友圈封面。愿意生成就另起一行以 [生成朋友圈封面:主体|画面描述] 结尾。主体填自由、角色、用户或合照，按用户要求和人设构思。";
  return `${action} 可以拒绝或追问。等系统通知换好，别提前说已完成。`;
}

export function extractCoverAction(text: string): CoverAction | undefined {
  const match = text.match(ACTION);
  if (!match) return undefined;
  const description = match[2]?.trim();
  if (!match[1]) return { kind: "use_image" };
  if (description) return { kind: "generate", subject: match[1] as CoverSubject, description };
}

export function stripCoverActions(text: string): string {
  return text.includes("朋友圈封面") ? text.replace(TAG, "").trimEnd() : text;
}

export function stripCoverActionPreview(text: string): string {
  return stripCoverActions(text).replace(/\[(?:采用朋友圈封面图|生成朋友圈封面)[^\]\r\n]*$/g, "");
}

export function protectCoverActions(text: string, transform: (text: string) => string): string {
  if (!text.includes("朋友圈封面")) return transform(text);
  const tags: string[] = [];
  const protectedText = text.replace(TAG, tag => `\uE10C${tags.push(tag) - 1}\uE10D`);
  return transform(protectedText).replace(/\uE10C(\d+)\uE10D/g, (_match, index: string) => tags[Number(index)] || "");
}
