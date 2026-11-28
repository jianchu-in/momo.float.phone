import { useEffect, useRef, useState } from "react";
import type { STTCallbacks, STTSession } from "@/lib/stt-service";

type Phase = "off" | "listening" | "transcribing" | "replying" | "paused";
type Options = {
  createSession: (callbacks: STTCallbacks & { onTranscribing: () => void }) => STTSession;
  onTranscript: (text: string) => Promise<boolean>;
  onError: (message: string) => void;
};

/** Only one recognition/reply cycle may own the microphone. Late callbacks are discarded. */
export function useFacingLiveVoice(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [phase, setPhase] = useState<Phase>("off");
  const [transcript, setTranscript] = useState("");
  const state = useRef<Phase>("off"), session = useRef<STTSession | undefined>(undefined);
  const generation = useRef(0), empty = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function transition(next: Phase) { state.current = next; setPhase(next); }
  function invalidate() {
    generation.current++; clearTimeout(timer.current);
    const previous = session.current; session.current = undefined; previous?.abort();
    setTranscript("");
  }
  function stop() { invalidate(); transition("off"); }
  function pause() { if (state.current !== "off") { invalidate(); transition("paused"); } }
  function listen() {
    invalidate();
    const token = generation.current, began = Date.now();
    let settled = false, interim = "";
    const valid = () => token === generation.current && !settled;
    const settle = () => { settled = true; const previous = session.current; session.current = undefined; previous?.abort(); setTranscript(""); };
    const noSpeech = () => {
      if (!valid()) return;
      settle();
      // Normal silence is expected in a call. Only guard against an engine that
      // repeatedly ends immediately, rather than timing out after listening.
      empty.current = Date.now() - began < 1500 ? empty.current + 1 : 0;
      if (empty.current >= 3) {
        transition("paused"); latest.current.onError("语音识别连续提前结束，已暂停。请检查识别配置后点击继续。");
      } else timer.current = setTimeout(() => { if (generation.current === token) listen(); }, 1000);
    };
    const finish = async (value: string) => {
      if (!valid()) return;
      const text = value.trim();
      if (!text) { noSpeech(); return; }
      settle(); empty.current = 0; transition("replying");
      try {
        const success = await latest.current.onTranscript(text);
        if (token !== generation.current) return;
        if (!success) { transition("paused"); return; }
        timer.current = setTimeout(() => { if (generation.current === token) listen(); }, 550);
      } catch (cause) {
        if (token !== generation.current) return;
        transition("paused"); latest.current.onError(cause instanceof Error ? cause.message : "实时对话失败，点击继续可重新收音。");
      }
    };
    transition("listening");
    try {
      const next = latest.current.createSession({
        onInterim: text => { if (valid()) { interim = text; setTranscript(text); } },
        onTranscribing: () => { if (valid()) transition("transcribing"); },
        onFinal: text => { void finish(text); }, onEnd: () => { void finish(interim); }, onNoSpeech: noSpeech,
        onError: message => { if (valid()) { settle(); transition("paused"); latest.current.onError(message); } },
      });
      session.current = next;
      if (!next.isSupported) { settle(); transition("paused"); latest.current.onError("当前环境无法实时收音，请检查语音识别配置或使用文字输入。"); return; }
      next.start();
    } catch (cause) {
      if (valid()) { settle(); transition("paused"); latest.current.onError(cause instanceof Error ? cause.message : "麦克风开启失败。"); }
    }
  }
  function start() { empty.current = 0; listen(); }
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("facing-live-microphone", { detail: phase === "listening" }));
    return () => { window.dispatchEvent(new CustomEvent("facing-live-microphone", { detail: false })); };
  }, [phase]);
  useEffect(() => {
    const hide = () => { if (document.hidden) pause(); };
    const leave = () => pause();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    return () => {
      generation.current++; clearTimeout(timer.current); session.current?.abort();
      document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", leave);
    };
  }, []);
  return { phase, enabled: phase !== "off", transcript, start, pause, stop,
    finish: () => { if (state.current === "listening") session.current?.stop(); } };
}
