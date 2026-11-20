import { type MusicListeningContext } from "./music-listening";

export function captureMusicListeningContext(capturedAt = new Date().toISOString(), reference?: MusicListeningContext | null): MusicListeningContext | null {
    if (reference?.reference) {
        // A selected lyric keeps its source even if playback has changed songs.
        return { ...reference, capturedAt, lines: reference.lines.map(line => ({ ...line })), reference: { ...reference.reference } };
    }
    return null;
}
