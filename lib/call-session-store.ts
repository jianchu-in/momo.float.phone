"use client";

import { useSyncExternalStore } from "react";
import type { ChatSession } from "@/lib/chat-storage";
import type { Character } from "@/lib/character-types";

export type CallSessionType = "voice" | "video" | "group";

export interface ActiveCallState {
    type: CallSessionType;
    session: ChatSession;
    character?: Character; // 单聊角色
    characters?: Character[]; // 群聊角色列表
    initiator?: "user" | "character";
    initiatorName?: string;
    isMinimized: boolean;
}

let activeCallState: ActiveCallState | null = null;
const listeners = new Set<() => void>();

function notify() {
    listeners.forEach((listener) => {
        try {
            listener();
        } catch (e) {
            console.error("[CallSessionStore] listener error:", e);
        }
    });
}

export const callSessionStore = {
    getState(): ActiveCallState | null {
        return activeCallState;
    },

    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },

    startCall(params: {
        type: CallSessionType;
        session: ChatSession;
        character?: Character;
        characters?: Character[];
        initiator?: "user" | "character";
        initiatorName?: string;
    }) {
        activeCallState = {
            ...params,
            isMinimized: false,
        };
        notify();
    },

    minimizeCall() {
        if (!activeCallState || activeCallState.isMinimized) return;
        activeCallState = {
            ...activeCallState,
            isMinimized: true,
        };
        notify();
    },

    restoreCall() {
        if (!activeCallState || !activeCallState.isMinimized) return;
        activeCallState = {
            ...activeCallState,
            isMinimized: false,
        };
        notify();
    },

    endCall() {
        if (!activeCallState) return;
        activeCallState = null;
        notify();
    },
};

export function useActiveCall(): ActiveCallState | null {
    return useSyncExternalStore(
        callSessionStore.subscribe,
        callSessionStore.getState,
        () => null
    );
}
