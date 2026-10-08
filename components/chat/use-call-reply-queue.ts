"use client";

import { useState, useRef, useCallback } from "react";

export function useCallReplyQueue(
    onProcess: (text: string) => Promise<void> | void,
    maxQueueSize: number = 5
) {
    const [queue, setQueue] = useState<string[]>([]);
    const queueRef = useRef<string[]>([]);
    const isBusyRef = useRef<boolean>(false);

    const enqueue = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed) return;
            if (queueRef.current.length >= maxQueueSize) {
                // 超出上限，丢弃最早一条保留最新
                queueRef.current = [...queueRef.current.slice(1), trimmed];
            } else {
                queueRef.current = [...queueRef.current, trimmed];
            }
            setQueue([...queueRef.current]);
        },
        [maxQueueSize]
    );

    const flushNext = useCallback(async () => {
        if (isBusyRef.current || queueRef.current.length === 0) return;
        const nextText = queueRef.current[0];
        queueRef.current = queueRef.current.slice(1);
        setQueue([...queueRef.current]);

        isBusyRef.current = true;
        try {
            await onProcess(nextText);
        } finally {
            isBusyRef.current = false;
        }
    }, [onProcess]);

    const clearQueue = useCallback(() => {
        queueRef.current = [];
        setQueue([]);
    }, []);

    return {
        queue,
        queueCount: queue.length,
        enqueue,
        flushNext,
        clearQueue,
    };
}
