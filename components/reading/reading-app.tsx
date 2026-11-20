"use client";

import { useState, useEffect, useRef, type CSSProperties } from "react";
import { hydrateReadingStorage } from "@/lib/reading-storage";
import { ReadingShelf } from "./reading-shelf";
import { ReadingViewer } from "./reading-viewer";
import type { Book } from "@/lib/reading-types";
import {
    DEFAULT_READING_APPEARANCE,
    loadReadingAppearance,
    loadReadingBackground,
    loadReadingCustomFont,
    resolveReadingFontFamily,
    saveReadingAppearance,
    saveReadingBackground,
    saveReadingCustomFont,
    READING_THEMES,
    type ReadingAppearance,
} from "@/lib/reading-appearance";

type Props = { onClose: () => void };

export default function ReadingApp({ onClose }: Props) {
    const [ready, setReady] = useState(false);
    const [activeBook, setActiveBook] = useState<Book | null>(null);
    const [appearance, setAppearance] = useState<ReadingAppearance>(DEFAULT_READING_APPEARANCE);
    const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
    const [customFontFamily, setCustomFontFamily] = useState<string | undefined>(undefined);
    // Keep track of the last opened book so viewer stays mounted
    const lastBookRef = useRef<Book | null>(null);
    const backgroundUrlRef = useRef<string | null>(null);
    const customFontUrlRef = useRef<string | null>(null);
    if (activeBook) lastBookRef.current = activeBook;

    const updateBackgroundUrl = (nextUrl: string | null) => {
        if (backgroundUrlRef.current && backgroundUrlRef.current !== nextUrl) {
            URL.revokeObjectURL(backgroundUrlRef.current);
        }
        backgroundUrlRef.current = nextUrl;
        setBackgroundUrl(nextUrl);
    };

    const loadCustomFontFace = async (blob: Blob | null) => {
        if (customFontUrlRef.current) {
            URL.revokeObjectURL(customFontUrlRef.current);
            customFontUrlRef.current = null;
        }
        setCustomFontFamily(undefined);
        if (!blob) return;

        const url = URL.createObjectURL(blob);
        customFontUrlRef.current = url;
        const familyName = `AIVirtualPhoneReadingFont_${Date.now()}`;

        try {
            const face = new FontFace(familyName, `url("${url}")`);
            await face.load();
            document.fonts.add(face);
            setCustomFontFamily(`"${familyName}"`);
        } catch {
            setCustomFontFamily(undefined);
        }
    };

    useEffect(() => {
        hydrateReadingStorage().then(() => setReady(true));
        setAppearance(loadReadingAppearance());
        // 背景底图已被用户移除，统一走经典主题系统
        void loadReadingCustomFont().then((blob) => {
            void loadCustomFontFace(blob);
        });
        return () => {
            if (backgroundUrlRef.current) URL.revokeObjectURL(backgroundUrlRef.current);
            if (customFontUrlRef.current) URL.revokeObjectURL(customFontUrlRef.current);
        };
    }, []);

    const handleSaveAppearance = async (
        nextAppearance: ReadingAppearance,
        options: { backgroundFile: File | null; clearBackground: boolean; customFontFile: File | null; clearCustomFont: boolean },
    ) => {
        const normalized = saveReadingAppearance(nextAppearance);
        setAppearance(normalized);
        if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("reading-appearance-changed"));
        }

        if (options.clearBackground) {
            await saveReadingBackground(null);
            updateBackgroundUrl(null);
            return;
        }

        if (options.backgroundFile) {
            await saveReadingBackground(options.backgroundFile);
            updateBackgroundUrl(URL.createObjectURL(options.backgroundFile));
        }

        if (options.clearCustomFont) {
            await saveReadingCustomFont(null);
            await loadCustomFontFace(null);
            return;
        }

        if (options.customFontFile) {
            await saveReadingCustomFont(options.customFontFile);
            await loadCustomFontFace(options.customFontFile);
        }
    };

    const activeThemeObj = READING_THEMES.find((t) => t.id === appearance.themeId) || READING_THEMES[0];

    const appearanceStyle = {
        ["--reading-font-family" as "--reading-font-family"]: resolveReadingFontFamily(appearance.fontFamily, customFontFamily),
        ["--reading-font-size" as "--reading-font-size"]: `${appearance.fontSize}px`,
        ["--reading-text-color" as "--reading-text-color"]: activeThemeObj.textColor,
        ["--reading-line-height" as "--reading-line-height"]: String(appearance.lineHeight),
        ["--reading-bg-image" as "--reading-bg-image"]: "none",
    } as CSSProperties;
    const hiddenViewerStyle = {
        position: "absolute",
        inset: 0,
        visibility: "hidden",
        pointerEvents: "none",
    } as CSSProperties;

    if (!ready) return <div className="absolute inset-0 z-[100] flex items-center justify-center" style={{ background: activeThemeObj.bg }}><span className="ts-14" style={{ color: activeThemeObj.subtextColor }}>加载中...</span></div>;

    return (
        <div className="absolute inset-0 w-full h-full overflow-hidden transition-colors duration-300" style={{ ...appearanceStyle, backgroundColor: activeThemeObj.bg, color: activeThemeObj.textColor }}>
            {!activeBook && (
                <ReadingShelf
                    onOpenBook={setActiveBook}
                    onClose={onClose}
                    appearance={appearance}
                    backgroundUrl={backgroundUrl}
                    onSaveAppearance={handleSaveAppearance}
                />
            )}
            {lastBookRef.current && (
                <div className="absolute inset-0 w-full h-full" style={activeBook ? undefined : hiddenViewerStyle} aria-hidden={!activeBook}>
                    <ReadingViewer book={lastBookRef.current} onBack={() => setActiveBook(null)} />
                </div>
            )}
        </div>
    );
}
