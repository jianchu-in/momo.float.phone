import type { ChatMessage, ChatSession } from "./chat-storage";
import { applyListeningRoomReply, getListeningRoom, type ListeningRoom } from "./listen-together";
import { getMusicControlBridge } from "./music-control-bridge";

export function pendingListeningInvite(session: ChatSession, history: ChatMessage[]): ListeningRoom | null {
    const current = getListeningRoom();
    const invitationMessage = history.filter(message => message.role === "user" && !(message as any).isRetracted && message.mediaData?.listeningInvite).at(-1);
    if (!current || current.sessionId !== session.id
        || current.initiator === "character" || current.userJoined === false || current.status === "declined"
        || invitationMessage?.mediaData?.listeningInvite?.roomId !== current.id
        || history.slice(history.indexOf(invitationMessage) + 1).some(message => message.role === "assistant" && !(message as any).isRetracted)) return null;
    if (Boolean(session.isGroup) !== Boolean(current.isGroup)) return null;
    return current.isGroup
        ? current.members?.some(member => member.status === "invited") ? current : null
        : current.status === "invited" && current.characterId === session.contactId ? current : null;
}

export function listeningInviteFirstInstruction(current: ListeningRoom): string {
    const snapshot = getMusicControlBridge()?.getState();
    const track = snapshot?.currentTrack;
    const compact = (value?: string) => value?.replace(/\s+/g, " ").trim().slice(0, 180) || undefined;
    const song = track || current.song;
    const metadata = song ? JSON.stringify({
        title: compact(song.title), artist: compact(song.artist),
        album: track ? compact(track.album) : undefined,
        durationSeconds: track && Number.isFinite(track.duration) && track.duration > 0 ? track.duration : undefined,
        playing: track ? snapshot?.isPlaying : undefined,
    }) : "暂无曲目";
    const decision = `[一起听:${current.id}:接受]或[一起听:${current.id}:拒绝]`;
    return `用户发出一起听邀请。依据人设、关系和当前对话自主接受或拒绝。${current.isGroup
        ? `保持[角色名]:格式；每位回应成员在自己的发言段开头先输出${decision}，仅决定自己。`
        : `本轮正文先输出${decision}，再自然回复。`}
先给出决定，不在标记前输出分析、内心或状态栏；本轮不调用工具、不搜索歌曲或歌词。歌曲信息是背景，无需强行点评，不虚构未知信息或歌词。
播放器曲目信息：${metadata}`;
}
