import { useEffect, useRef, useState } from "react";
import { changeFacingTurns, type FacingMeeting, type FacingTurn } from "@/lib/facing-storage";
import { loadMediaBlob, storeMediaBlob } from "@/lib/media-cache-storage";
import { playAudioBlob, playAudioBlobViaMediaElement, resolveVoiceConfig, synthesizeSpeech } from "@/lib/tts-service";

export function useFacingSpeech(ios: boolean, enabled: boolean, onMeeting: (meeting: FacingMeeting) => void, onError: (text: string) => void) {
  const playback = useRef<ReturnType<typeof playAudioBlob> | null>(null);
  const request = useRef(0);
  const voiceOn = useRef(enabled);
  voiceOn.current = enabled;
  const [playingId, setPlayingId] = useState<string>();
  function speaking(active:boolean){window.dispatchEvent(new CustomEvent("facing-voice-playback",{detail:active}));}
  function stop() { request.current++; playback.current?.abort(); playback.current = null; setPlayingId(undefined); speaking(false); }
  useEffect(() => () => { request.current++; playback.current?.abort(); speaking(false); }, []);
  useEffect(() => { if (!enabled) stop(); }, [enabled]);

  async function play(turn: FacingTurn, meeting: FacingMeeting, signal?: AbortSignal, replay = false): Promise<boolean> {
    if (signal?.aborted || (!replay && !voiceOn.current) || !turn.text.trim()) return false;
    const token = ++request.current;
    playback.current?.abort();
    const cancelled = () => request.current !== token || signal?.aborted;
    const abort = () => { if (request.current === token) stop(); };
    signal?.addEventListener("abort", abort, { once: true });
    setPlayingId(turn.id);
    try {
      let audio = turn.audioRef ? (await loadMediaBlob(turn.audioRef))?.blob : undefined;
      if (!audio && replay) throw new Error("这条消息没有保存的语音，无法回放。");
      if (!audio) {
        const voice = resolveVoiceConfig(turn.speakerId ?? meeting.characterId, "facing");
        if (!voice) return false;
        audio = await synthesizeSpeech(turn.text, voice) ?? undefined;
        if (cancelled() || !voiceOn.current) return false;
        if (audio) {
          const audioRef = await storeMediaBlob(audio, audio.type || "audio/mpeg", "audio");
          const saved = await changeFacingTurns(meeting, turns => turns.map(item => {
            if (item.id !== turn.id || item.text !== turn.text || item.versionIndex !== turn.versionIndex) return item;
            return { ...item, audioRef, versions: item.versions?.map((version, i) => i === (item.versionIndex ?? 0) ? { ...version, audioRef } : version) };
          }));
          if (!cancelled()) onMeeting(saved);
        }
      }
      if (!audio || cancelled() || (!replay && !voiceOn.current)) return false;
      speaking(true);
      playback.current = (ios ? playAudioBlob : playAudioBlobViaMediaElement)(audio);
      await playback.current.promise;
      return !cancelled();
    } catch (cause) {
      if (!cancelled()) onError(cause instanceof Error ? cause.message : "语音播放失败，台词已保存。");
      return false;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (request.current === token) { playback.current = null; setPlayingId(undefined); speaking(false); }
    }
  }
  return { play, stop, playingId };
}
