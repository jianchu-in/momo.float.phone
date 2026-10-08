"use client";

import React, { useRef, useState, useEffect } from "react";
import { PhoneOff, Maximize2 } from "lucide-react";

interface CallMiniWindowProps {
    title: string;
    avatar?: string;
    durationText: string;
    subText?: string;
    onRestore: () => void;
    onHangup: () => void;
}

export function CallMiniWindow({
    title,
    avatar,
    durationText,
    subText,
    onRestore,
    onHangup,
}: CallMiniWindowProps) {
    const [pos, setPos] = useState({ x: 20, y: 80 });
    const isDraggingRef = useRef(false);
    const dragStartRef = useRef({ startX: 0, startY: 0, initialX: 0, initialY: 0 });
    const hasMovedRef = useRef(false);

    const handlePointerDown = (e: React.PointerEvent) => {
        isDraggingRef.current = true;
        hasMovedRef.current = false;
        dragStartRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            initialX: pos.x,
            initialY: pos.y,
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDraggingRef.current) return;
        const dx = e.clientX - dragStartRef.current.startX;
        const dy = e.clientY - dragStartRef.current.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            hasMovedRef.current = true;
        }
        setPos({
            x: Math.max(10, Math.min(window.innerWidth - 210, dragStartRef.current.initialX + dx)),
            y: Math.max(20, Math.min(window.innerHeight - 100, dragStartRef.current.initialY + dy)),
        });
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        isDraggingRef.current = false;
        try {
            (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        } catch (_) {}
    };

    return (
        <div
            className="fixed z-[99999] select-none touch-none pointer-events-auto"
            style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        >
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-2xl bg-black/80 backdrop-blur-md border border-white/15 text-white shadow-2xl transition-shadow active:shadow-lg">
                {/* 头像 */}
                <div
                    className="relative w-10 h-10 rounded-full overflow-hidden flex-shrink-0 bg-neutral-800 border border-white/20 cursor-pointer"
                    onClick={(e) => {
                        if (!hasMovedRef.current) {
                            e.stopPropagation();
                            onRestore();
                        }
                    }}
                >
                    {avatar ? (
                        <img src={avatar} alt={title} className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center font-bold text-sm">
                            {title?.[0] || "?"}
                        </div>
                    )}
                    {/* 呼吸波形脉冲 */}
                    <div className="absolute inset-0 rounded-full border border-green-400/60 animate-ping pointer-events-none" />
                </div>

                {/* 文本信息 */}
                <div
                    className="flex flex-col min-w-[70px] max-w-[100px] cursor-pointer"
                    onClick={(e) => {
                        if (!hasMovedRef.current) {
                            e.stopPropagation();
                            onRestore();
                        }
                    }}
                >
                    <span className="text-xs font-semibold truncate leading-tight">{title}</span>
                    <span className="text-[10px] text-green-400 font-mono tracking-tight">{durationText}</span>
                    {subText && <span className="text-[9px] text-white/50 truncate">{subText}</span>}
                </div>

                {/* 操作按键 */}
                <div className="flex items-center gap-1 pl-1 border-l border-white/10">
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onRestore();
                        }}
                        className="p-1.5 rounded-full hover:bg-white/10 active:scale-95 text-white/80 transition-all"
                        title="还原全屏"
                        aria-label="还原通话"
                    >
                        <Maximize2 size={14} />
                    </button>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onHangup();
                        }}
                        className="p-1.5 rounded-full bg-red-500/80 hover:bg-red-500 active:scale-95 text-white transition-all"
                        title="挂断通话"
                        aria-label="挂断通话"
                    >
                        <PhoneOff size={14} />
                    </button>
                </div>
            </div>
        </div>
    );
}
