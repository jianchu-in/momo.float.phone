"use client";
import { LyricShareCard } from "@/components/music/lyric-share-card";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, MessageCircle, ChevronRight, Send } from "lucide-react";
import { loadChatSessions, createOrGetSession, pushChatMessage, type ChatSession } from "@/lib/chat-storage";
import { loadCharacters } from "@/lib/character-storage";
import type { ChatSharePayload } from "@/lib/chat-share";
import styles from "./share-destination-sheet.module.css";

export default function ShareDestinationSheet({ payload, onClose, onView, preview }: { payload: ChatSharePayload; onClose: () => void; onView: (destination: string) => void; preview?: ReactNode }) {
    const panel = useRef<HTMLDivElement>(null);
    const submitting = useRef(false);
    const [busy, setBusy] = useState(false);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [query, setQuery] = useState("");
    const [note, setNote] = useState("");
    const [target, setTarget] = useState<ChatSession | null>(null);
    const [error, setError] = useState("");
    const [sent, setSent] = useState(false);
    const sentDestination = useRef<string>("");
    const chars = loadCharacters();
    const name = (session: ChatSession) => session.isGroup ? (session as any).groupName || "群聊" : (session as any).alias || chars.find(c => c.id === session.contactId)?.name || "对话";
    const title = payload.title;
    const excerpt = payload.listeningContext?.reference?.text;
    const subtitle = payload.artist;

    useEffect(() => {
        const existing = loadChatSessions();
        setSessions(existing.filter(s => !(s as any).isSpectator));
        panel.current?.focus();
    }, []);

    const confirm = async (destination: ChatSession | null = target) => {
        if (submitting.current || !destination) return;
        submitting.current = true; setBusy(true);
        try {
            pushChatMessage({
                sessionId: destination.id, role: "user", content: note.trim(), mediaType: "music_share", listeningContext: payload.listeningContext,
                mediaData: { musicTitle: payload.title, musicArtist: payload.artist, musicCoverUrl: payload.coverUrl, label: `${payload.title} - ${payload.artist}` }
            });
            window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: destination.id } }));
            sentDestination.current = destination.id;
            setSent(true);
        } catch (e) { setError(e instanceof Error ? e.message : "分享失败，请重试"); submitting.current = false; }
        finally { setBusy(false); }
    };

    return <div className={styles.overlay} onClick={onClose}>
        <div className={styles.sheet} ref={panel} role="dialog" aria-modal="true" aria-label="分享" tabIndex={-1} onClick={e => e.stopPropagation()} onKeyDown={e => {
            if (e.key === "Escape") { e.stopPropagation(); if (target && !sent) setTarget(null); else onClose(); }
        }}>
            <header><h2>{sent ? "已分享" : target ? `分享到「${name(target)}」` : "分享歌曲"}</h2><button aria-label="关闭分享" onClick={onClose}><X size={20} /></button></header>
            {preview || (excerpt ? <LyricShareCard title={title} artist={payload.artist} coverUrl={payload.coverUrl} text={excerpt} /> : <div className={styles.preview}>{payload.coverUrl ? <img className={styles.cover} src={payload.coverUrl} alt="专辑封面" /> : <span className={styles.coverFallback}>{title.slice(0, 1)}</span>}<div><strong>{title}</strong><small>{subtitle}</small>{excerpt && <p>{excerpt}</p>}</div></div>)}
            {sent ? <div className={styles.done}><button type="button" onClick={() => { onView(sentDestination.current); }}>去看看</button></div> : <>
                {!target && <><input className={styles.search} placeholder="搜索对话" aria-label="搜索对话" value={query} onChange={e => setQuery(e.target.value)} /><div className={styles.list}>
                    {sessions.filter(s => name(s).toLowerCase().includes(query.toLowerCase())).map(s => <button key={s.id} onClick={() => { setError(""); setTarget(s); }}><span>{name(s)}<small>{s.isGroup ? "群聊" : "私聊"}</small></span><ChevronRight size={16} /></button>)}
                    {!sessions.some(s => name(s).toLowerCase().includes(query.toLowerCase())) && <p>没有可分享的对话</p>}
                </div></>}
                {target && <textarea aria-label="分享附言" placeholder={excerpt ? "关于这句歌词，想说些什么（可选）…" : "说点什么（可选）…"} value={note} maxLength={2000} onChange={e => setNote(e.target.value)} />}
                {target && <div className={styles.actions}><button onClick={() => setTarget(null)}>返回</button><button className={styles.primary} disabled={busy} onClick={() => confirm()}><Send size={16} />{busy ? "正在发送…" : "确认发送"}</button></div>}
                {error && <p className={styles.error} role="alert">{error}</p>}
            </>}
        </div>
    </div>;
}
