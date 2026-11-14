import { getMusicControlBridge } from "./music-control-bridge";
import { loadAllTracks, type MusicTrack } from "./music-storage";
import type { SharedListeningSong } from "./listening-library";

export async function activateListeningSong(song: SharedListeningSong, action: "toggle" | "open", openPlayer: () => void): Promise<void> {
    const bridge = getMusicControlBridge();
    if (!bridge) throw new Error("播放器未就绪");
    const state = bridge.getState();
    if (state.currentTrack?.id === song.id) {
        if (action === "open") openPlayer();
        else if (state.isPlaying) bridge.pause();
        else bridge.resume();
        return;
    }
    const track: MusicTrack | undefined = song.source === "local"
        ? (await loadAllTracks()).find(item => item.id === song.id)
        : { id: song.id, title: song.title, artist: song.artist, coverUrl: song.coverUrl, duration: 0, liked: false, addedAt: new Date().toISOString() };
    if (getMusicControlBridge() !== bridge) return;
    if (!track) throw new Error("本地歌曲已移除，请重新导入");
    const result = await bridge.playTrack(track);
    if (!result.ok) throw new Error(result.message);
    if (action === "open" && getMusicControlBridge() === bridge) openPlayer();
}
