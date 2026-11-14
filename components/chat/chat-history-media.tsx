"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, ImageOff } from "lucide-react";
import { getChatImageFromIndexedDB } from "@/lib/chat-asset-storage";
import { loadChatMessages, type ChatMessage, type ChatSession } from "@/lib/chat-storage";
import { addChatFavorite } from "@/lib/favorites-storage";
import { isMediaStoreRef, loadMediaObjectUrl } from "@/lib/media-cache-storage";
import { formatIsoDate } from "@/lib/calendar-utils";
import { MediaPreviewOverlay } from "./media-preview-overlay";
import { MessageBubble } from "./message-bubble";

export type HistoryMediaKind = "image" | "audio";

export function matchesHistoryMedia(message: ChatMessage, kind: HistoryMediaKind): boolean {
    if (message.isRetracted || (message.role !== "user" && message.role !== "assistant")) return false;
    if (message.mediaType === "media_file") return message.mediaData?.fileType === kind && Boolean(message.mediaUrl);
    return message.mediaType === kind && (kind === "audio" || Boolean(message.mediaUrl));
}

function HistoryImage({ url, onOpen, onFavorite }: {
    url: string; onOpen: () => void; onFavorite: () => Promise<void>;
}) {
    const [near, setNear] = useState(false);
    const [source, setSource] = useState("");
    const [failed, setFailed] = useState(false);
    const [preview, setPreview] = useState(false);
    const button = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!button.current || typeof IntersectionObserver === "undefined") { setNear(true); return; }
        const observer = new IntersectionObserver(entries => {
            if (!entries.some(entry => entry.isIntersecting)) return;
            setNear(true);
            observer.disconnect();
        }, { rootMargin: "180px" });
        observer.observe(button.current);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        if (!near) return;
        let live = true;
        let objectUrl: string | null = null;
        const fromStore = isMediaStoreRef(url);
        const result = fromStore ? loadMediaObjectUrl(url)
            : url.startsWith("asset://") ? getChatImageFromIndexedDB(url.slice(8)) : Promise.resolve(url);
        void result.then(value => {
            if (fromStore) objectUrl = value;
            if (live) { setSource(value || ""); setFailed(!value); }
            else if (objectUrl) URL.revokeObjectURL(objectUrl);
        }).catch(() => { if (live) setFailed(true); });
        return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [near, url]);

    return <>
        <button type="button" className="chat-history-image" ref={button} aria-label="预览图片" onClick={() => {
            if (source && !failed) setPreview(true);
            else onOpen();
        }}>
            {source && !failed ? <img src={source} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
                : failed ? <ImageOff size={18} aria-hidden="true" /> : null}
        </button>
        {preview && <MediaPreviewOverlay imageUrl={source} saveFilename="聊天图片.png" onClose={() => setPreview(false)} onFavorite={onFavorite} />}
    </>;
}

const VIEW_CHUNK = 90;

export function ChatHistoryMedia({ session, kind, query, onJump }: {
    session: ChatSession; kind: HistoryMediaKind; query: string;
    onJump: (id: string) => void;
}) {
    const [selecting, setSelecting] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [count, setCount] = useState(VIEW_CHUNK);
    const [busy, setBusy] = useState(false);
    const saving = useRef(false);
    const [status, setStatus] = useState("");
    const messages = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase();
        return loadChatMessages(session.id).filter(msg => matchesHistoryMedia(msg, kind)
            && (!needle || [msg.content, msg.senderName, msg.mediaData?.label, msg.mediaData?.fileName]
                .some(value => value?.toLocaleLowerCase().includes(needle)))).reverse();
    }, [session.id, kind, query]);
    const dates = new Map<string, ChatMessage[]>();
    for (const message of messages.slice(0, count)) {
        const day = formatIsoDate(new Date(message.createdAt));
        const group = dates.get(day) ?? [];
        group.push(message);
        dates.set(day, group);
    }

    const toggle = (id: string) => setSelected(previous => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
    });

    const favorite = async (ids: string[]) => {
        if (saving.current || !ids.length) return;
        saving.current = true;
        setBusy(true);
        setStatus("");
        try {
            const keys = new Set(ids);
            const latest = loadChatMessages(session.id).filter(msg => keys.has(msg.id) && matchesHistoryMedia(msg, kind));
            if (latest.length !== keys.size) throw new Error("所选消息已变化，请重新选择。");
            await addChatFavorite({ session, messages: latest });
            const message = `已收藏 ${latest.length} 条`;
            setStatus(message);
            setSelecting(false);
            setSelected(new Set());
        } catch (reason) {
            setStatus(reason instanceof Error ? reason.message : "收藏失败，请重试。");
        } finally {
            saving.current = false;
            setBusy(false);
        }
    };

    return <section className="chat-history-media">
        <div className="chat-history-media-toolbar">
            <span>{messages.length} 条{kind === "image" ? "图片" : "语音"}</span>
            {messages.length > 0 && <button type="button" className="ui-btn ui-btn-ghost" disabled={busy} onClick={() => {
                setSelecting(!selecting);
                setSelected(new Set());
            }}>{selecting ? "取消多选" : "多选"}</button>}
        </div>
        {status && <p role="status" className="menu-desc">{status}</p>}
        {!messages.length && <p className="ui-empty">暂无{kind === "image" ? "图片" : "语音"}</p>}
        {[...dates].map(([day, items]) => <section key={day}>
            <h3>{day}</h3>
            <div className={kind === "image" ? "chat-history-image-grid" : "chat-history-audio-list"}>
                {items.map(message => <div key={message.id} className="chat-history-media-item" data-selected={selected.has(message.id) || undefined}>
                    {selecting ? <button className="chat-history-media-check" type="button" aria-pressed={selected.has(message.id)}
                        aria-label={`选择${kind === "image" ? "图片" : "语音"} ${message.id}`} disabled={busy} onClick={() => toggle(message.id)}>
                        <span>{selected.has(message.id) ? "✓" : ""}</span>
                    </button> : <button className="chat-history-media-favorite" type="button" aria-label="收藏此消息" disabled={busy}
                        onClick={() => void favorite([message.id])}><Bookmark size={15} /></button>}
                    {kind === "image" ? <HistoryImage url={message.mediaUrl!} onOpen={() => onJump(message.id)} onFavorite={() => favorite([message.id])} />
                        : <div className="chat-history-audio">
                            <div inert={selecting}><MessageBubble msg={message} characterId={message.senderCharacterId || session.contactId} /></div>
                            <button type="button" className="ui-btn ui-btn-ghost" disabled={selecting} onClick={() => onJump(message.id)}>查看原消息</button>
                        </div>}
                </div>)}
            </div>
        </section>)}
        {count < messages.length && <button type="button" className="ui-btn ui-btn-ghost w-full" onClick={() => setCount(count + VIEW_CHUNK)}>加载更多</button>}
        {selecting && <footer className="chat-history-media-toolbar chat-history-selection">
            <span>已选 {selected.size} 条</span>
            <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setSelected(new Set(messages.slice(0, count).map(msg => msg.id)))}
                disabled={busy}>全选已加载</button>
            <button type="button" className="ui-btn ui-btn-primary" disabled={!selected.size || busy} onClick={() => void favorite([...selected])}>收藏</button>
        </footer>}
    </section>;
}
