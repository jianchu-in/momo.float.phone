// lib/music-theme.ts — Day/Night theme management for the Music App
// Supports "light", "dark", or "auto" (follow system).
// Changes broadcast via window event.

import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export type MusicThemeMode = "light" | "dark" | "auto";
export type ResolvedMusicTheme = "light" | "dark";

const MUSIC_THEME_KEY = "music-theme-mode-v1";
registerKvMigration(MUSIC_THEME_KEY);

export const MUSIC_THEME_EVENT = "music-theme-change";

export function loadMusicThemeMode(): MusicThemeMode {
    if (typeof window === "undefined") return "dark";
    try {
        const stored = kvGet(MUSIC_THEME_KEY);
        if (stored === "light" || stored === "dark" || stored === "auto") {
            return stored;
        }
        return "dark";
    } catch {
        return "dark";
    }
}

export function saveMusicThemeMode(mode: MusicThemeMode): void {
    if (typeof window === "undefined") return;
    try {
        kvSet(MUSIC_THEME_KEY, mode);
        window.dispatchEvent(new CustomEvent(MUSIC_THEME_EVENT, { detail: { mode } }));
    } catch {
        // ignore
    }
}

export function getSystemPreferredMusicTheme(): ResolvedMusicTheme {
    if (typeof window === "undefined") return "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveMusicTheme(mode: MusicThemeMode): ResolvedMusicTheme {
    if (mode === "auto") {
        return getSystemPreferredMusicTheme();
    }
    return mode;
}
