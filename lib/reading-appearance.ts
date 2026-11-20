"use client";

import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { openIndexedDbAtLeast } from "./idb-open";

export type ReadingFontFamilyId = "system" | "song" | "serif" | "sans" | "custom";

export type ReadingThemeId = "paper" | "warm" | "night" | "ink" | "rose" | "sage";

export type ReadingThemeConfig = {
    id: ReadingThemeId;
    name: string;
    bg: string;
    cardBg: string;
    textColor: string;
    subtextColor: string;
    accentColor: string;
    borderColor: string;
};

export const READING_THEMES: ReadingThemeConfig[] = [
    { id: "paper", name: "纸白", bg: "#f7f4ef", cardBg: "#ffffff", textColor: "#2c2520", subtextColor: "#8a7e75", accentColor: "#9e2a2b", borderColor: "#e3d5c5" },
    { id: "warm", name: "手账", bg: "#fcf8f2", cardBg: "#f5ede2", textColor: "#382d24", subtextColor: "#998574", accentColor: "#b89870", borderColor: "#e8dcce" },
    { id: "night", name: "夜读", bg: "#18181b", cardBg: "#27272a", textColor: "#e4e4e7", subtextColor: "#9a9a9e", accentColor: "#d4a373", borderColor: "#3f3f46" },
    { id: "ink", name: "水墨", bg: "#121212", cardBg: "#1e1e1e", textColor: "#f4f4f5", subtextColor: "#a1a1aa", accentColor: "#c97a63", borderColor: "#27272a" },
    { id: "rose", name: "玫瑰", bg: "#faf4f5", cardBg: "#ffffff", textColor: "#3a2226", subtextColor: "#9e7a82", accentColor: "#d4889a", borderColor: "#ebd5db" },
    { id: "sage", name: "青苔", bg: "#f4f7f4", cardBg: "#ffffff", textColor: "#1c291c", subtextColor: "#788c78", accentColor: "#7a9a6a", borderColor: "#d5ebd8" },
];

export type ReadingAppearance = {
    fontFamily: ReadingFontFamilyId;
    fontSize: number;
    textColor: string;
    lineHeight: number;
    themeId?: ReadingThemeId;
    customFontName?: string;
};

export const READING_FONT_OPTIONS: Array<{ id: ReadingFontFamilyId; label: string; cssValue: string }> = [
    { id: "system", label: "系统阅读", cssValue: "var(--app-font-family)" },
    { id: "song", label: "宋体", cssValue: "\"Songti SC\", \"STSong\", \"Noto Serif SC\", serif" },
    { id: "serif", label: "衬线", cssValue: "\"Source Han Serif SC\", \"Noto Serif SC\", serif" },
    { id: "sans", label: "黑体", cssValue: "\"PingFang SC\", \"Hiragino Sans GB\", \"Noto Sans SC\", sans-serif" },
    { id: "custom", label: "自定义上传", cssValue: "var(--app-font-family)" },
];

const APPEARANCE_STORAGE_KEY = "ai_phone_reading_appearance_v1";
registerKvMigration(APPEARANCE_STORAGE_KEY);
const BG_DB_NAME = "reading-appearance-assets";
const BG_STORE_NAME = "assets";
const BG_KEY = "shared-background";
const FONT_KEY = "custom-font";

export const DEFAULT_READING_APPEARANCE: ReadingAppearance = {
    fontFamily: "system",
    fontSize: 20,
    textColor: "#111111",
    lineHeight: 2.3,
    themeId: "paper",
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function canUseStorage(): boolean {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeAppearance(raw: Partial<ReadingAppearance> | null | undefined): ReadingAppearance {
    const fontFamily = READING_FONT_OPTIONS.some((option) => option.id === raw?.fontFamily)
        ? raw!.fontFamily!
        : DEFAULT_READING_APPEARANCE.fontFamily;
    const fontSize = clamp(Number(raw?.fontSize ?? DEFAULT_READING_APPEARANCE.fontSize) || DEFAULT_READING_APPEARANCE.fontSize, 12, 30);
    const lineHeight = clamp(Number(raw?.lineHeight ?? DEFAULT_READING_APPEARANCE.lineHeight) || DEFAULT_READING_APPEARANCE.lineHeight, 1.2, 2.8);
    const themeId = READING_THEMES.some((t) => t.id === raw?.themeId) ? raw!.themeId! : "paper";
    const themeObj = READING_THEMES.find((t) => t.id === themeId) || READING_THEMES[0];
    const textColor = typeof raw?.textColor === "string" && raw.textColor.trim() && raw.textColor !== DEFAULT_READING_APPEARANCE.textColor
        ? raw.textColor.trim()
        : themeObj.textColor;
    const customFontName = typeof raw?.customFontName === "string" && raw.customFontName.trim()
        ? raw.customFontName.trim()
        : undefined;

    return { fontFamily, fontSize, textColor, lineHeight, themeId, customFontName };
}

export function resolveReadingFontFamily(fontFamily: ReadingFontFamilyId, customFontFamily?: string): string {
    if (fontFamily === "custom" && customFontFamily) return customFontFamily;
    return READING_FONT_OPTIONS.find((option) => option.id === fontFamily)?.cssValue || READING_FONT_OPTIONS[0].cssValue;
}

export function loadReadingAppearance(): ReadingAppearance {
    if (!canUseStorage()) return DEFAULT_READING_APPEARANCE;
    try {
        const raw = kvGet(APPEARANCE_STORAGE_KEY);
        return normalizeAppearance(raw ? JSON.parse(raw) : null);
    } catch {
        return DEFAULT_READING_APPEARANCE;
    }
}

export function saveReadingAppearance(appearance: ReadingAppearance): ReadingAppearance {
    const normalized = normalizeAppearance(appearance);
    if (!canUseStorage()) return normalized;
    try {
        kvSet(APPEARANCE_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
        // Ignore quota or serialization failures and keep in-memory settings usable.
    }
    return normalized;
}

async function openBackgroundDb(): Promise<IDBDatabase> {
    // Open at >= 1: a backup restore may have bumped the stored version higher,
    // and opening at a fixed lower version would throw a VersionError.
    return openIndexedDbAtLeast(BG_DB_NAME, 1, (db) => {
        if (!db.objectStoreNames.contains(BG_STORE_NAME)) db.createObjectStore(BG_STORE_NAME);
    });
}

export async function saveReadingBackground(blob: Blob | null): Promise<void> {
    const db = await openBackgroundDb();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(BG_STORE_NAME, "readwrite");
        const store = tx.objectStore(BG_STORE_NAME);
        if (blob) store.put(blob, BG_KEY);
        else store.delete(BG_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

export async function loadReadingBackground(): Promise<Blob | null> {
    try {
        const db = await openBackgroundDb();
        const blob = await new Promise<Blob | null>((resolve, reject) => {
            const tx = db.transaction(BG_STORE_NAME, "readonly");
            const req = tx.objectStore(BG_STORE_NAME).get(BG_KEY);
            req.onsuccess = () => resolve((req.result as Blob) || null);
            req.onerror = () => reject(req.error);
        });
        db.close();
        return blob;
    } catch {
        return null;
    }
}

export async function saveReadingCustomFont(blob: Blob | null): Promise<void> {
    const db = await openBackgroundDb();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(BG_STORE_NAME, "readwrite");
        const store = tx.objectStore(BG_STORE_NAME);
        if (blob) store.put(blob, FONT_KEY);
        else store.delete(FONT_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

export async function loadReadingCustomFont(): Promise<Blob | null> {
    try {
        const db = await openBackgroundDb();
        const blob = await new Promise<Blob | null>((resolve, reject) => {
            const tx = db.transaction(BG_STORE_NAME, "readonly");
            const req = tx.objectStore(BG_STORE_NAME).get(FONT_KEY);
            req.onsuccess = () => resolve((req.result as Blob) || null);
            req.onerror = () => reject(req.error);
        });
        db.close();
        return blob;
    } catch {
        return null;
    }
}
