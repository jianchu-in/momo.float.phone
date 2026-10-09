"use client";

import React, { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useActiveCall, callSessionStore } from "@/lib/call-session-store";
import { VoiceCallScreen } from "./voice-call-screen";
import { VideoCallScreen } from "./video-call-screen";
import { GroupCallScreen } from "./group-call-screen";
import { CallMiniWindow } from "./call-mini-window";

export function CallLayer() {
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);
    const activeCall = useActiveCall();
    const [duration, setDuration] = useState(0);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (!activeCall) {
            setDuration(0);
            if (timerRef.current) clearInterval(timerRef.current);
            return;
        }

        timerRef.current = setInterval(() => {
            setDuration((prev) => prev + 1);
        }, 1000);

        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [activeCall?.session.id]);

    if (!activeCall) return null;

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    };

    const handleEnd = () => {
        callSessionStore.endCall();
    };

    const handleMinimize = () => {
        callSessionStore.minimizeCall();
    };

    const handleRestore = () => {
        callSessionStore.restoreCall();
    };

    const title =
        activeCall.type === "group"
            ? `群通话 (${(activeCall.characters?.length || 0) + 1}人)`
            : activeCall.character?.name || "通话中";

    const avatar =
        activeCall.type === "group"
            ? undefined
            : activeCall.character?.avatar;

    return (
        <>
            {/* 最小化悬浮小窗 */}
            {activeCall.isMinimized && mounted && typeof document !== "undefined" && createPortal(
                <CallMiniWindow
                    title={title}
                    avatar={avatar}
                    durationText={formatTime(duration)}
                    subText={activeCall.type === "video" ? "视频通话" : "语音通话"}
                    onRestore={handleRestore}
                    onHangup={handleEnd}
                />,
                document.body
            )}

            {/* 全屏或后台保持挂载的通话屏幕 */}
            <div
                className="fixed inset-0 z-[9999]"
                style={{
                    display: activeCall.isMinimized ? "none" : "block",
                }}
            >
                {activeCall.type === "voice" && activeCall.character && (
                    <VoiceCallScreen
                        session={activeCall.session}
                        character={activeCall.character}
                        onEnd={handleEnd}
                        initiator={activeCall.initiator}
                        onMinimize={handleMinimize}
                    />
                )}
                {activeCall.type === "video" && activeCall.character && (
                    <VideoCallScreen
                        session={activeCall.session}
                        character={activeCall.character}
                        onEnd={handleEnd}
                        initiator={activeCall.initiator}
                        onMinimize={handleMinimize}
                    />
                )}
                {activeCall.type === "group" && activeCall.characters && (
                    <GroupCallScreen
                        type="voice"
                        session={activeCall.session}
                        characters={activeCall.characters}
                        onEnd={handleEnd}
                        initiator={activeCall.initiator}
                        initiatorName={activeCall.initiatorName}
                    />
                )}
            </div>
        </>
    );
}
