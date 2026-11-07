import type { MusicListeningContext } from "./music-listening";

export type MusicChatSharePayload = {
    type: "music";
    title: string;
    artist: string;
    coverUrl?: string;
    lyricMode?: "share" | "quote";
    listeningContext?: MusicListeningContext;
};

export type ChatSharePayload = MusicChatSharePayload;
