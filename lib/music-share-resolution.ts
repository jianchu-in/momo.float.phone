import { unifiedSearch, type UnifiedSearchResult } from "./music-service";
import type { MusicTrack } from "./music-storage";
import { matchesSharedSong } from "./music-song-match";

export function selectSharedSong(results: UnifiedSearchResult[], title: string, artist?: string) {
    return results.find(item => matchesSharedSong(item, title, artist)) || null;
}

export async function resolveSharedSong(title: string, artist?: string): Promise<MusicTrack | null> {
    // Title-only search includes local tracks too; combined queries miss local exact matches.
    let match = selectSharedSong(await unifiedSearch(title), title, artist);
    if (!match && artist?.trim()) match = selectSharedSong(await unifiedSearch(`${title} ${artist}`), title, artist);
    if (match?.localTrack) {
        const track = match.localTrack;
        return { ...track, coverUrl: track.coverUrl?.startsWith("blob:") ? undefined : track.coverUrl };
    }
    const song = match?.neteaseResult;
    if (!song) return null;
    return {
        id: `netease_${song.id}`, title: song.name, artist: song.artists, album: song.album,
        duration: song.duration / 1000, coverUrl: song.coverUrl, liked: false, addedAt: new Date().toISOString()
    };
}
