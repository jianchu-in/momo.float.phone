import { getChatMessagePreview, loadChatMessages, updateMessageMediaData, type ChatMessage } from "./chat-storage";

export type MessageTapback = string;
export type GroupTapback = { actorId: string; actorName: string; emoji: string };

const NATIVE_TAPBACK_EMOJIS = new Set(["❤️", "👍", "👎", "😆", "‼️", "❓"]);
const TAPBACK_GLYPHS: Record<string, string> = {
    heart: "❤️",
    like: "👍",
    dislike: "👎",
    laugh: "😆",
    exclamation: "‼️",
    question: "❓",
};
const TAPBACK_LABELS: Record<string, string> = {
    "❤️": "喜爱",
    "👍": "赞",
    "👎": "踩",
    "😆": "笑",
    "‼️": "强调",
    "❓": "疑问",
};

export function isNativeTapbackEmoji(emoji: string): boolean {
    return NATIVE_TAPBACK_EMOJIS.has(emoji);
}

export function getTapbackGlyph(nameOrEmoji: string): string {
    return TAPBACK_GLYPHS[nameOrEmoji] || nameOrEmoji;
}

export function getTapbackLabel(nameOrEmoji: string): string {
    const glyph = getTapbackGlyph(nameOrEmoji);
    return TAPBACK_LABELS[glyph] || glyph;
}

export function normalizeGroupTapbacks(value: unknown): GroupTapback[] {
    if (!Array.isArray(value)) return [];
    const actors = new Map<string, GroupTapback>();
    for (const item of value) {
        if (!item || typeof item.actorId !== "string" || !item.actorId.trim() || typeof item.emoji !== "string") continue;
        const emoji = getTapbackGlyph(item.emoji);
        if (!isNativeTapbackEmoji(emoji)) continue;
        const actorId = item.actorId.trim();
        actors.set(actorId, { actorId, actorName: typeof item.actorName === "string" && item.actorName.trim() ? item.actorName : actorId === "self" ? "你" : "群成员", emoji });
    }
    return [...actors.values()];
}
