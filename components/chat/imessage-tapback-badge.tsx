import { getTapbackGlyph, getTapbackLabel, normalizeGroupTapbacks, type GroupTapback } from "@/lib/chat-tapback";
import { useState, useRef, useEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";

interface IMessageTapbackBadgeProps {
    tapback?: string;
    tapbackBy?: "user" | "assistant";
    reactions?: GroupTapback[];
    reactionStyleForActor?: (actorId: string) => CSSProperties | undefined;
}

export function IMessageTapbackBadge({ tapback, tapbackBy = "user", reactions, reactionStyleForActor }: IMessageTapbackBadgeProps) {
    const validReactions = normalizeGroupTapbacks(reactions);
    if (validReactions.length) return <GroupTapbackStack reactions={validReactions} reactionStyleForActor={reactionStyleForActor} />;
    if (!tapback) return null;
    return (
        <span
            className="imessage-tapback-badge"
            data-tapback={tapback}
            data-tapback-by={tapbackBy}
            style={reactionStyleForActor?.(tapbackBy === "user" ? "self" : "legacy-assistant")}
            role="img"
            aria-label={`Tapback：${getTapbackLabel(tapback)}`}
        >
            <TapbackShape />
            <span className="imessage-tapback-glyph" aria-hidden="true">
                {getTapbackGlyph(tapback)}
            </span>
        </span>
    );
}

/** One silhouette for private and group reactions, including both tail lobes. */
function TapbackShape({ tail = true }: { tail?: boolean } = {}) {
    return <svg
                className="imessage-tapback-shape"
                viewBox="-1 -1 35 40"
                aria-hidden="true"
            >
                {tail ? <><path d="M15.258 0C23.684 0 30.516 6.831 30.516 15.258C30.516 18.887 29.246 22.22 27.13 24.839C28.468 25.645 29.363 27.112 29.363 28.788C29.363 31.332 27.301 33.393 24.758 33.394C22.52 33.394 20.655 31.798 20.238 29.683C18.677 30.222 17.002 30.516 15.258 30.516C6.831 30.516 0 23.684 0 15.258C0 6.831 6.831 0 15.258 0Z" />
                <circle cx="30.515" cy="35.697" r="2.591" />
                </> : <circle cx="15.258" cy="15.258" r="15.258" />}
            </svg>;
}

function GroupTapbackStack({ reactions, reactionStyleForActor }: { reactions: GroupTapback[]; reactionStyleForActor?: (actorId: string) => CSSProperties | undefined }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLButtonElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        closeRef.current?.focus();
        const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); ref.current?.focus(); } };
        window.addEventListener("keydown", close);
        return () => window.removeEventListener("keydown", close);
    }, [open]);
    const displayed = reactions.slice(0, 3);
    return <>
        <button ref={ref} type="button" className="imessage-tapback-badge group-tapback-stack" style={{ width: 28.6 + (displayed.length - 1) * 8 }} aria-label={`${reactions.length} 人回应，查看详情`} aria-expanded={open}
            onPointerDown={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }} onClick={event => { event.stopPropagation(); setOpen(value => !value); }}>
            <span className="group-tapback-visuals">
            {displayed.map((item, index) => <span className="group-tapback-layer" data-tapback-by={item.actorId === "self" ? "user" : "assistant"} key={item.actorId} style={{ left: index * 8, zIndex: displayed.length - index, ...reactionStyleForActor?.(item.actorId) }} aria-hidden="true"><TapbackShape tail={index === 0} /><span className="imessage-tapback-glyph">{item.emoji}</span></span>)}
            {reactions.length > 3 && <span className="group-tapback-overflow">+{reactions.length - 3}</span>}
            </span>
        </button>
        {open && ref.current && createPortal(<div className="group-tapback-detail-backdrop" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setOpen(false); ref.current?.focus(); }}>
            <section className="group-tapback-detail" role="dialog" aria-label="消息回应" onClick={event => event.stopPropagation()}>
                <header><span>回应 · {reactions.length}</span><button ref={closeRef} type="button" onClick={() => { setOpen(false); ref.current?.focus(); }} aria-label="关闭回应详情">×</button></header>
                <div>{reactions.map(item => <div className="group-tapback-person" key={item.actorId}><span>{item.actorName}</span><span>{item.emoji}</span></div>)}</div>
            </section>
        </div>, ref.current.closest('.chat-room-wrapper') || document.body)}
    </>;
}
