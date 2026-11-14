import { loadChatAppSettings, type ChatSession } from "./chat-storage";

export type ChatBeautyPreset = "classic" | "glass";
/** Preserve existing classic/glass settings; unsupported imports use the legacy flag. Fallback to global. */
export function resolveChatBeautyPreset(session?: Pick<ChatSession, "beautyPreset" | "glassBubblesEnabled"> | null): ChatBeautyPreset {
    if (session?.beautyPreset === "glass" || session?.beautyPreset === "classic") {
        return session.beautyPreset;
    }
    if (session?.glassBubblesEnabled) return "glass";
    try {
        const globalPreset = loadChatAppSettings().globalBeautyPreset;
        if (globalPreset === "glass" || globalPreset === "classic") return globalPreset;
    } catch {}
    return "classic";
}
