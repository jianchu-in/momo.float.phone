"use client";

import { useEffect, useRef } from "react";
import type { ChatBeautyPreset } from "@/lib/chat-beauty-preset";

const choices = [{ value: "glass", label: "玻璃" }, { value: "classic", label: "经典" }] as const;

export function BeautyPresetPicker({ value, onChange }: { value: ChatBeautyPreset; onChange: (value: ChatBeautyPreset) => void }) {
    const root = useRef<HTMLDetailsElement>(null);
    useEffect(() => {
        const outside = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) root.current.open = false; };
        document.addEventListener("pointerdown", outside);
        return () => document.removeEventListener("pointerdown", outside);
    }, []);
    return <details ref={root} className="chat-beauty-picker" onKeyDown={event => {
        if (event.key === "Escape" && root.current?.open) { event.stopPropagation(); root.current.open = false; root.current.querySelector("summary")?.focus(); }
    }} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false; }}>
        <summary aria-label="美化预设"><span>{choices.find(choice => choice.value === value)?.label}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m7 10 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" /></svg></summary>
        <div className="chat-beauty-picker-options" role="group" aria-label="选择美化预设">
            {choices.map(choice => <button type="button" key={choice.value} aria-pressed={choice.value === value} onClick={() => {
                onChange(choice.value);
                if (root.current) { root.current.open = false; root.current.querySelector("summary")?.focus(); }
            }}><span>{choice.label}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 4 4 10-10" strokeLinecap="round" strokeLinejoin="round" /></svg></button>)}
        </div>
    </details>;
}
