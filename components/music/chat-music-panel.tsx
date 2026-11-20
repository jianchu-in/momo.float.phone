"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, Headphones, Music2, Pause, Play, ChevronDown, X } from "lucide-react";
import MusicApp from "./music-app";
import { ListeningPlayerPresence, useListeningPresence } from "./listening-presence";
import { useMusicControlsOptional } from "@/lib/music-context";
import { getListeningRoom, subscribeListeningRoom, joinGroupListeningAsUser } from "@/lib/listen-together";
import styles from "./chat-music-panel.module.css";
import { ListeningSongPicker } from "./listening-song-picker";
import type { MusicTrack } from "@/lib/music-storage";

const serverRoom = () => null;
export function useListeningRoom() { return useSyncExternalStore(subscribeListeningRoom, getListeningRoom, serverRoom); }

export function ListeningStatus({ sessionId, name, avatar, onOpen }: { sessionId: string; name: string; avatar?: string; onOpen: () => void }) {
    const room = useListeningRoom();
    const player = useMusicControlsOptional();
    const [collapsed, setCollapsed] = useState(false);
    const statusRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
    const drag = useRef<{ id: number; x: number; y: number; left: number; top: number; scale: number; moved: boolean } | null>(null);
    const suppressClick = useRef(false);
    const clampPosition = (x: number, y: number, snap = false) => {
        const node = statusRef.current;
        const parent = node?.offsetParent as HTMLElement | null;
        if (!node || !parent) return { x, y };
        const maxX = Math.max(12, parent.clientWidth - node.offsetWidth - 12);
        const maxY = Math.max(12, parent.clientHeight - node.offsetHeight - 12);
        return { x: snap ? (x + node.offsetWidth / 2 < parent.clientWidth / 2 ? 12 : maxX) : Math.max(12, Math.min(maxX, x)), y: Math.max(12, Math.min(maxY, y)) };
    };
    useEffect(() => {
        const node = statusRef.current;
        const parent = node?.offsetParent as HTMLElement | null;
        if (!node || !parent) return;
        const observer = new ResizeObserver(() => setPosition(current => current ? clampPosition(current.x, current.y, true) : current));
        observer.observe(parent); observer.observe(node);
        return () => observer.disconnect();
    }, [room?.sessionId, room?.status, sessionId]);
    if (room?.sessionId !== sessionId || room.status === "declined") return null;
    return <div ref={statusRef} className={styles.status} style={position ? { left: position.x, top: position.y, right: "auto" } : undefined}
        onPointerDown={event => {
            event.stopPropagation();
            if (!event.isPrimary || event.button !== 0) return;
            const node = event.currentTarget;
            const parent = node.offsetParent as HTMLElement | null;
            suppressClick.current = false;
            drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: node.offsetLeft, top: node.offsetTop, scale: parent?.clientWidth ? parent.getBoundingClientRect().width / parent.clientWidth : 1, moved: false };
        }}
        onPointerMove={event => {
            const start = drag.current;
            if (!start || start.id !== event.pointerId) return;
            const dx = (event.clientX - start.x) / start.scale, dy = (event.clientY - start.y) / start.scale;
            if (!start.moved && Math.hypot(dx, dy) < 6) return;
            start.moved = true; suppressClick.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            setPosition(clampPosition(start.left + dx, start.top + dy));
        }}
        onPointerUp={event => {
            const start = drag.current;
            if (!start || start.id !== event.pointerId) return;
            if (start.moved) setPosition(clampPosition(start.left + (event.clientX - start.x) / start.scale, start.top + (event.clientY - start.y) / start.scale, true));
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { drag.current = null; setPosition(current => current ? clampPosition(current.x, current.y, true) : current); }}
        onLostPointerCapture={() => { drag.current = null; }}
        onClickCapture={event => { if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
        onDragStart={event => event.preventDefault()}>
        <button type="button" onClick={onOpen} aria-label={`打开与${name}的一起听`}>
            {avatar ? <img src={avatar} alt="" /> : <Headphones size={20} />}
            {!collapsed && <span><strong>{room.status === "invited" ? `等待${name}加入` : `和${name}一起听`}</strong><small>{player?.currentTrack ? `${player.isPlaying ? "" : "已暂停 · "}${player.currentTrack.title}` : "选一首歌吧"}</small></span>}
        </button>
        <button type="button" aria-label={collapsed ? "展开一起听状态" : "收起一起听状态"} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}><ChevronDown size={16} style={{ transform: collapsed ? "rotate(180deg)" : undefined }} /></button>
    </div>;
}

type Props = { sessionId: string; characterId?: string; name: string; avatar?: string; busy: boolean; onClose: () => void; onInvite: (track?: MusicTrack) => void; onLeave: () => void; onRetry: () => void };
export default function ChatMusicPanel(props: Props) {
    const { sessionId, onClose, onInvite } = props;
    const presence = useListeningPresence();
    const room = useListeningRoom();
    const mine = room?.sessionId === sessionId ? room : null;
    const player = useMusicControlsOptional();
    const [notice, setNotice] = useState("");
    const [showPicker, setShowPicker] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const node = root.current;
        const previous = document.activeElement as HTMLElement | null;
        node?.focus();
        return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
    }, []);

    const handlePickTrack = (track: MusicTrack, playUrl?: string) => {
        setShowPicker(false);
        if (player) {
            if (!player.queue.some(t => t.id === track.id)) {
                player.setQueue([track, ...player.queue]);
            }
            if (playUrl) {
                player.playUrl(playUrl, track);
            } else {
                player.playTrack(track);
            }
        }
        // 携曲极速直连一起听
        setTimeout(() => {
            try { onInvite(track); } catch { /* ignore */ }
        }, 80);
    };

    const hasControls = Boolean((room && !mine && room.status !== "declined") || (mine?.isGroup));
    const controls = hasControls ? (
        <div className={`${styles.accessory} music-hero-accessory`}>
            {room && !mine && room.status !== "declined" && <p className={styles.note}>已有一起听会话，请先回原聊天结束。</p>}
            {mine?.isGroup && <ListeningPlayerPresence />}
        </div>
    ) : undefined;
    return <div ref={root} className={styles.panel} onPointerDown={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="音乐与一起听" tabIndex={-1} onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    }}>
        <MusicApp onClose={onClose} headerAccessory={controls} initialTogether listeningSessionId={sessionId} />
        {showPicker && <ListeningSongPicker onClose={() => setShowPicker(false)} onSelectTrack={handlePickTrack} />}
        {notice && <button type="button" className={styles.notice} onClick={() => setNotice("")} role="status">{notice}</button>}
    </div>;
}
