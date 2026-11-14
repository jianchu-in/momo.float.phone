"use client";
import { useEffect, useState } from "react";

/** Chat-only appearance, independent of the desktop theme. Never uploads images. */
export function useChatAppearance(background: string | null) {
    const [dark, setDark] = useState(false);
    const [sample, setSample] = useState({ src: "", dark: false });
    useEffect(() => {
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        const update = () => setDark(media.matches);
        update(); media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);
    useEffect(() => {
        if (!background) return;
        let cancelled = false;
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                canvas.width = canvas.height = 32;
                const ctx = canvas.getContext("2d", { willReadFrequently: true });
                if (!ctx) return;
                ctx.fillStyle = "white"; ctx.fillRect(0, 0, 32, 32);
                ctx.drawImage(image, 0, 0, 32, 32);
                const pixels = ctx.getImageData(0, 0, 32, 32).data;
                let luminance = 0;
                for (let i = 0; i < pixels.length; i += 4) luminance += .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2];
                if (!cancelled) setSample({ src: background, dark: luminance / 1024 < 145 });
            } catch { /* Cross-origin images may forbid sampling. Keep readable fallback styling. */ }
        };
        image.src = background;
        return () => { cancelled = true; image.onload = image.onerror = null; };
    }, [background]);
    return { dark, darkWallpaper: !!background && sample.src === background && sample.dark };
}
