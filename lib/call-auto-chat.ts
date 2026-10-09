export interface AutoChatConfig {
    enabled: boolean;
    minSilenceSeconds: number; // 最短静默秒数（默认 12）
    maxSilenceSeconds: number; // 最长静默秒数（默认 25）
    maxTurnsPerCall: number;   // 单次通话主动找话上限（默认 8）
    backoffFactor: number;     // 指数退避倍率（默认 1.3）
}

export const DEFAULT_AUTO_CHAT_CONFIG: AutoChatConfig = {
    enabled: true,
    minSilenceSeconds: 12,
    maxSilenceSeconds: 25,
    maxTurnsPerCall: 8,
    backoffFactor: 1.3,
};

export function calculateNextSilenceInterval(config: AutoChatConfig, triggeredCount: number): number {
    const base = config.minSilenceSeconds + Math.random() * Math.max(0, config.maxSilenceSeconds - config.minSilenceSeconds);
    const multiplier = Math.pow(config.backoffFactor, triggeredCount);
    return Math.round(base * multiplier * 1000); // 毫秒
}
