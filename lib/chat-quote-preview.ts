import type { ChatMessage } from "./chat-storage";
import { splitBilingualText } from "./bilingual-text";

/** Keep only the language actually quoted, never the raw `original | translation` protocol. */
export function normalizeQuotePreviewText(value: string): string {
    const text = value.trim();
    if (!text) return "";
    return splitBilingualText(text)?.original || text;
}

function formatQuoteAmount(value: unknown): string {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "";
    return amount.toLocaleString("zh-CN", {
        minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
        maximumFractionDigits: 2,
    });
}

/** Copy readable content, not media URLs or an empty content field. */
export function getQuotePreview(message: ChatMessage): string {
    const d = message.mediaData;
    const text = normalizeQuotePreviewText(d?.label || message.content || "");
    const labeled = (kind: string, value = text) => value ? `${kind}：${value}` : `${kind}消息`;
    switch (message.mediaType) {
        case "audio": return labeled("语音", (message.content || d?.label || "").trim());
        case "transfer": {
            const amountText = formatQuoteAmount(d?.amount);
            const amount = amountText ? `¥${amountText}` : "";
            return labeled("转账", [amount, text].filter(Boolean).join(" · "));
        }
        case "red_packet": {
            const amountText = formatQuoteAmount(d?.amount);
            const amount = amountText ? `¥${amountText}` : "";
            return labeled("红包", [amount, text].filter(Boolean).join(" · "));
        }
        case "gift": return labeled("礼物", [d?.giftName || d?.label, text].filter(Boolean).join(" · "));
        case "image": return labeled("图片");
        case "sticker": return labeled("表情包");
        case "location": return labeled("位置");
        case "contact_card": return labeled("名片", d?.contactCardName || text);
        case "app_card": return labeled("卡片", [d?.appCardTitle, d?.appCardSummary || d?.appCardBody || text].filter(Boolean).join(" · "));
        case "music_share": return labeled("音乐", [d?.musicTitle, d?.musicArtist].filter(Boolean).join(" — ") || text);
        case "media_file": return labeled("文件", d?.fileName || text);
        default: return text || "消息";
    }
}
