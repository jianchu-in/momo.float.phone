"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, X, Music, Play, Loader2 } from "lucide-react";
import {
    searchNetease, getDailyRecommendSongs, getNeteasePlayInfo, getNeteaseLyricData,
    type NeteaseSearchResult
} from "@/lib/music-service";
import { loadAllTracks, type MusicTrack } from "@/lib/music-storage";

type Props = {
    onClose: () => void;
    onSelectTrack: (track: MusicTrack, playUrl?: string) => void;
};

export function ListeningSongPicker({ onClose, onSelectTrack }: Props) {
    const [query, setQuery] = useState("");
    const [searching, setSearching] = useState(false);
    const [loadingRecommend, setLoadingRecommend] = useState(true);
    const [searchResults, setSearchResults] = useState<NeteaseSearchResult[]>([]);
    const [recommendSongs, setRecommendSongs] = useState<NeteaseSearchResult[]>([]);
    const [localTracks, setLocalTracks] = useState<MusicTrack[]>([]);
    const [selectingId, setSelectingId] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        Promise.all([
            getDailyRecommendSongs().catch(() => []),
            loadAllTracks().catch(() => []),
        ]).then(([rec, local]) => {
            if (!active) return;
            setRecommendSongs(rec.slice(0, 8));
            setLocalTracks(local.slice(0, 6));
            setLoadingRecommend(false);
        });
        return () => { active = false; };
    }, []);

    const handleSearch = useCallback(async () => {
        const q = query.trim();
        if (!q) {
            setSearchResults([]);
            return;
        }
        setSearching(true);
        try {
            const results = await searchNetease(q, 15);
            setSearchResults(results);
        } catch {
            setSearchResults([]);
        } finally {
            setSearching(false);
        }
    }, [query]);

    const handlePickNetease = async (song: NeteaseSearchResult) => {
        if (selectingId) return;
        setSelectingId(`netease_${song.id}`);
        try {
            const [info, lyricData] = await Promise.all([
                getNeteasePlayInfo(song.id).catch(() => ({ url: null, trial: false, reason: "" })),
                getNeteaseLyricData(song.id).catch(() => ({ lyrics: "", tlyrics: "" })),
            ]);
            const track: MusicTrack = {
                id: `netease_${song.id}`,
                title: song.name,
                artist: song.artists,
                duration: song.duration / 1000,
                coverUrl: song.coverUrl,
                lyrics: lyricData.lyrics || undefined,
                tlyrics: lyricData.tlyrics || undefined,
                liked: false,
                addedAt: new Date().toISOString(),
            };
            onSelectTrack(track, info.url || undefined);
        } catch {
            const track: MusicTrack = {
                id: `netease_${song.id}`,
                title: song.name,
                artist: song.artists,
                duration: song.duration / 1000,
                coverUrl: song.coverUrl,
                liked: false,
                addedAt: new Date().toISOString(),
            };
            onSelectTrack(track);
        } finally {
            setSelectingId(null);
        }
    };

    const handlePickLocal = (track: MusicTrack) => {
        if (selectingId) return;
        setSelectingId(track.id);
        onSelectTrack(track);
    };

    return (
        <div
            className="music-settings-modal-overlay"
            style={{ zIndex: 120 }}
            onClick={onClose}
        >
            <div
                className="music-settings-modal-dialog"
                style={{
                    maxHeight: "80vh",
                    display: "flex",
                    flexDirection: "column",
                    padding: "16px 18px",
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* 顶栏 */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                    <div style={{ fontSize: "16px", fontWeight: "600", color: "var(--c-music-text, #1d1d1f)" }}>
                        选一首想一起听的歌
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="music-playlist-picker-close"
                        style={{ border: 0, background: "none", cursor: "pointer", color: "var(--c-music-accent)" }}
                        aria-label="关闭选歌"
                    >
                        <X size={20} strokeWidth={1.8} />
                    </button>
                </div>

                {/* 搜索框 */}
                <div className="music-search-bar" style={{ margin: "0 0 12px 0" }}>
                    <input
                        className="music-search-input"
                        placeholder="搜索歌曲或歌手..."
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") void handleSearch(); }}
                    />
                    <button
                        type="button"
                        className="music-search-btn"
                        onClick={() => void handleSearch()}
                        disabled={searching || !query.trim()}
                        aria-label="搜索"
                    >
                        {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={18} strokeWidth={1.8} />}
                    </button>
                </div>

                {/* 歌曲列表区域 */}
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                    {searching ? (
                        <div className="music-empty" style={{ padding: "24px 0" }}>
                            <Loader2 size={24} className="animate-spin" style={{ margin: "0 auto 8px" }} />
                            <div className="music-empty-text">正在寻找曲目...</div>
                        </div>
                    ) : searchResults.length > 0 ? (
                        <div>
                            <div style={{ fontSize: "12px", color: "var(--c-music-accent)", margin: "4px 0 8px 4px", fontWeight: "500" }}>
                                搜索结果
                            </div>
                            {searchResults.map(song => (
                                <button
                                    key={song.id}
                                    type="button"
                                    onClick={() => void handlePickNetease(song)}
                                    disabled={selectingId === `netease_${song.id}`}
                                    style={{
                                        width: "100%",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "10px",
                                        padding: "8px 10px",
                                        border: "none",
                                        background: "var(--c-music-surface, rgba(0,0,0,0.03))",
                                        borderRadius: "12px",
                                        cursor: "pointer",
                                        textAlign: "left",
                                        margin: "4px 0",
                                    }}
                                >
                                    <div style={{ width: "38px", height: "38px", borderRadius: "8px", overflow: "hidden", flexShrink: 0, background: "rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                        {song.coverUrl ? (
                                            <img src={song.coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                        ) : (
                                            <Music size={18} color="var(--c-music-accent)" />
                                        )}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--c-music-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {song.name}
                                        </div>
                                        <div style={{ fontSize: "11px", color: "var(--c-music-accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "2px" }}>
                                            {song.artists}{song.album ? ` · ${song.album}` : ""}
                                        </div>
                                    </div>
                                    {selectingId === `netease_${song.id}` ? (
                                        <Loader2 size={18} className="animate-spin" color="var(--c-music-primary, #fa2d55)" />
                                    ) : (
                                        <Play size={18} fill="currentColor" color="var(--c-music-primary, #fa2d55)" />
                                    )}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <>
                            {/* 本地音乐快捷选择 */}
                            {localTracks.length > 0 && (
                                <div>
                                    <div style={{ fontSize: "12px", color: "var(--c-music-accent)", margin: "4px 0 8px 4px", fontWeight: "500" }}>
                                        本地曲库
                                    </div>
                                    {localTracks.map(t => (
                                        <button
                                            key={t.id}
                                            type="button"
                                            onClick={() => handlePickLocal(t)}
                                            style={{
                                                width: "100%",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "10px",
                                                padding: "8px 10px",
                                                border: "none",
                                                background: "var(--c-music-surface, rgba(0,0,0,0.03))",
                                                borderRadius: "12px",
                                                cursor: "pointer",
                                                textAlign: "left",
                                                margin: "4px 0",
                                            }}
                                        >
                                            <div style={{ width: "38px", height: "38px", borderRadius: "8px", overflow: "hidden", flexShrink: 0, background: "rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                {t.coverUrl ? (
                                                    <img src={t.coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                                ) : (
                                                    <Music size={18} color="var(--c-music-accent)" />
                                                )}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--c-music-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {t.title}
                                                </div>
                                                <div style={{ fontSize: "11px", color: "var(--c-music-accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "2px" }}>
                                                    {t.artist || "本地音频"}
                                                </div>
                                            </div>
                                            <Play size={18} fill="currentColor" color="var(--c-music-primary, #fa2d55)" />
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* 推荐歌曲 */}
                            {loadingRecommend ? (
                                <div className="music-empty" style={{ padding: "20px 0" }}>
                                    <div className="music-empty-text">加载推荐曲目...</div>
                                </div>
                            ) : recommendSongs.length > 0 ? (
                                <div style={{ marginTop: localTracks.length > 0 ? "8px" : "0" }}>
                                    <div style={{ fontSize: "12px", color: "var(--c-music-accent)", margin: "4px 0 8px 4px", fontWeight: "500" }}>
                                        推荐曲目
                                    </div>
                                    {recommendSongs.map(song => (
                                        <button
                                            key={song.id}
                                            type="button"
                                            onClick={() => void handlePickNetease(song)}
                                            disabled={selectingId === `netease_${song.id}`}
                                            style={{
                                                width: "100%",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "10px",
                                                padding: "8px 10px",
                                                border: "none",
                                                background: "var(--c-music-surface, rgba(0,0,0,0.03))",
                                                borderRadius: "12px",
                                                cursor: "pointer",
                                                textAlign: "left",
                                                margin: "4px 0",
                                            }}
                                        >
                                            <div style={{ width: "38px", height: "38px", borderRadius: "8px", overflow: "hidden", flexShrink: 0, background: "rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                {song.coverUrl ? (
                                                    <img src={song.coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                                ) : (
                                                    <Music size={18} color="var(--c-music-accent)" />
                                                )}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--c-music-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {song.name}
                                                </div>
                                                <div style={{ fontSize: "11px", color: "var(--c-music-accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "2px" }}>
                                                    {song.artists}
                                                </div>
                                            </div>
                                            {selectingId === `netease_${song.id}` ? (
                                                <Loader2 size={18} className="animate-spin" color="var(--c-music-primary, #fa2d55)" />
                                            ) : (
                                                <Play size={18} fill="currentColor" color="var(--c-music-primary, #fa2d55)" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="music-empty" style={{ padding: "20px 0" }}>
                                    <div className="music-empty-text">在上方输入歌曲名快速选歌</div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
