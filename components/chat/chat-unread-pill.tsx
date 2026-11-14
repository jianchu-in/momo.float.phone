"use client";
import { useEffect, useState, useId, useRef } from "react";
import { ChevronLeft } from "lucide-react";
import { CHAT_MESSAGE_PUSHED_EVENT, CHAT_UNREAD_UPDATED_EVENT, loadChatSessions, markChatSessionRead } from "@/lib/chat-storage";

export function ChatUnreadPill({ sessionId, onBack, dotOnly = false }: { sessionId: string; onBack: () => void; dotOnly?: boolean }) {
    const [count, setCount] = useState(0);
    const host = useRef<HTMLButtonElement>(null);
    const maskId = useId().replace(/:/g, "");
    useEffect(() => {
        const update = () => {
            const room = host.current?.closest(".chat-room-wrapper");
            const rect = room?.getBoundingClientRect();
            // Cached chat rooms stay mounted: only the topmost visible room is read.
            const hit = rect && document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(100, rect.height / 2));
            if (document.visibilityState === "visible" && room && hit && room.contains(hit)) markChatSessionRead(sessionId);
            setCount(loadChatSessions().filter(item => item.id !== sessionId).reduce((sum, item) => sum + Math.max(0, Number(item.unreadCount) || 0), 0));
        };
        let frame = 0;
        const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
        const events = [CHAT_MESSAGE_PUSHED_EVENT, CHAT_UNREAD_UPDATED_EVENT, "chat-messages-deleted", "focus", "chat-bg-complete"];
        events.forEach(event => window.addEventListener(event, schedule));
        document.addEventListener("visibilitychange", schedule);
        const observer = new MutationObserver(schedule);
        let node: Element | null = host.current?.closest(".chat-room-wrapper") || null;
        while (node) { observer.observe(node, { attributes: true, attributeFilter: ["class", "style", "hidden"] }); node = node.parentElement; }
        window.addEventListener("transitionend", schedule);
        schedule();
        return () => { cancelAnimationFrame(frame); observer.disconnect(); events.forEach(event => window.removeEventListener(event, schedule)); document.removeEventListener("visibilitychange", schedule); window.removeEventListener("transitionend", schedule); };
    }, [sessionId]);
    const label = count > 99 ? "99+" : String(count);
    const width = count > 99 ? 38 : count > 9 ? 30 : 24;
    return <button ref={host} type="button" className="imessage-header-button imessage-header-back" data-has-unread={count > 0 || undefined} onClick={onBack} aria-label={count > 0 ? `返回，其他会话有 ${count} 条未读消息` : "返回"}>
        <ChevronLeft size={29} strokeWidth={2.15} />
        {count > 0 && (dotOnly ? <span className="sp-unread-dot" aria-hidden="true" /> : <span className="chat-unread-pill">
        <span className="sp-unread-count" aria-hidden="true">{label}</span>
        <svg width={width} height="22" viewBox={`0 0 ${width} 22`} aria-hidden="true"><defs><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height="22" style={{ maskType: "luminance" }}><rect width={width} height="22" rx="11" fill="white"/><text x="50%" y="50%" dy=".35em" textAnchor="middle" fill="black" fontSize="12" fontWeight="600">{label}</text></mask></defs><rect width={width} height="22" rx="11" fill="currentColor" mask={`url(#${maskId})`}/></svg>
    </span>)}</button>;
}
