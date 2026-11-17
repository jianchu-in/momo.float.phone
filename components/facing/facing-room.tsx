"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, ChevronLeft, Keyboard, Mic, PhoneOff, Settings2, Volume2, VolumeX } from "lucide-react";
import { useHoldToTalk } from "@/components/chat/use-hold-to-talk";
import { useCallKeyboardOffsetStyle } from "@/components/chat/use-call-keyboard-offset";
import { isIOSDevice } from "@/components/chat/voice-input-platform";
import type { Character } from "@/lib/character-types";
import { generateFacingReply } from "@/lib/facing-engine";
import { appendFacingTurn, facingId, facingScenePosition, type FacingAsset, type FacingCharacterSettings, type FacingMeeting, type FacingSceneGroup, type FacingScenePosition, type FacingTurn } from "@/lib/facing-storage";
import { isCallRecordingSupported, resolveCloudSttConfig } from "@/lib/stt-cloud";
import { createSTTSession, isBrowserSpeechRecognitionSupported, type STTSession } from "@/lib/stt-service";
import { playAudioBlob, playAudioBlobViaMediaElement, resolveVoiceConfig, synthesizeSpeech, unlockAudioPlayback } from "@/lib/tts-service";
import { FacingStage } from "./facing-stage";

export function FacingRoom({ character, meeting, settings, portrait, scene, position, scenes, onMeeting, onSettings, onEnd, onVoice, onSpeechInput }: {
  character: Character;
  meeting: FacingMeeting;
  settings: FacingCharacterSettings;
  portrait?: FacingAsset;
  scene?: FacingAsset;
  position: FacingScenePosition;
  scenes: FacingSceneGroup[];
  onMeeting: (meeting: FacingMeeting) => void;
  onSettings: () => void;
  onEnd: () => void;
  onVoice: (enabled: boolean) => void;
  onSpeechInput: (mode: NonNullable<FacingCharacterSettings["speechInput"]>) => void;
}) {
  const [reaction, setReaction] = useState<FacingAsset>();
  const [draft, setDraft] = useState("");
  const [voiceInput, setVoiceInput] = useState(false);
  const [browserListening, setBrowserListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const recording = useRef<STTSession | null>(null);
  const interim = useRef("");
  const log = useRef<HTMLDivElement>(null);
  const followLog = useRef(true);
  const playback = useRef<ReturnType<typeof playAudioBlobViaMediaElement> | null>(null);
  const audioRequest = useRef(0);
  const iosDevice = useRef(isIOSDevice()).current;
  const cloudAvailable = !iosDevice && isCallRecordingSupported() && !!resolveCloudSttConfig(character.id);
  const browserAvailable = isBrowserSpeechRecognitionSupported();
  const useCloudStt = cloudAvailable && (settings.speechInput !== "browser" || !browserAvailable);
  const voiceOn = settings.voice !== false;
  const points = settings.touch === false ? [] : settings.hotspots?.[portrait?.id ?? "avatar"] ?? [];
  const failedTurn = meeting.turns.at(-1);

  useEffect(() => {
    if (log.current && (followLog.current || failedTurn?.role === "user")) log.current.scrollTop = log.current.scrollHeight;
  }, [failedTurn, busy, interimText, error]);

  useEffect(() => () => {
    controller.current?.abort();
    recording.current?.abort();
    audioRequest.current++;
    playback.current?.abort();
  }, []);

  useEffect(() => {
    if (!reaction) return;
    const timer = window.setTimeout(() => setReaction(undefined), reaction.durationMs);
    return () => window.clearTimeout(timer);
  }, [reaction]);

  useEffect(() => {
    if (voiceOn) return;
    audioRequest.current++;
    playback.current?.abort();
  }, [voiceOn]);

  function stopReaction() {
    setReaction(undefined);
  }

  async function speak(text: string, run: AbortSignal) {
    if (!text || !voiceOn) return;
    const voice = resolveVoiceConfig(character.id, "facing");
    if (!voice) return;
    const request = ++audioRequest.current;
    try {
      const audio = await synthesizeSpeech(text, voice);
      if (!audio || audioRequest.current !== request || run.aborted) return;
      playback.current = (iosDevice ? playAudioBlob : playAudioBlobViaMediaElement)(audio);
      await playback.current.promise;
    } catch {
      if (audioRequest.current === request && !run.aborted) setError("角色语音播放失败，台词已保存。");
    }
  }

  async function send(text: string, kind: FacingTurn["kind"], retry?: FacingTurn) {
    const content = text.trim();
    if (!content || controller.current) return;
    const run = new AbortController();
    controller.current = run;
    audioRequest.current++;
    playback.current?.abort();
    unlockAudioPlayback();
    setBusy(true);
    setError("");
    stopReaction();
    if (!retry) followLog.current = true;
    let stored = Boolean(retry);
    const user: FacingTurn = retry ?? { ...position, id: facingId(), role: "user", kind, text: content, at: new Date().toISOString() };
    try {
      const current = retry ? meeting : await appendFacingTurn(meeting, user);
      stored = true;
      if (run.signal.aborted) return;
      onMeeting(current);
      const result = await generateFacingReply({ character, meeting: current, settings, scene: position.sceneName, scenes, signal: run.signal });
      if (run.signal.aborted) return;
      const saved = await appendFacingTurn(current, {
        ...(result.nextScene ? facingScenePosition(result.nextScene) : position),
        id: facingId(), role: "assistant", kind: "reply", text: result.dialogue, action: result.action,
        at: new Date().toISOString(), replyTo: user.id, reactionId: result.reaction?.id, reactionName: result.reaction?.name,
      });
      if (run.signal.aborted) return;
      onMeeting(saved);
      setReaction(result.reaction);
      void speak(result.dialogue, run.signal);
    } catch (cause) {
      if (!run.signal.aborted) {
        setError(stored ? (cause instanceof Error ? cause.message : "角色回复失败。") : "消息保存失败，请重试。");
        if (!stored && kind !== "touch") setDraft(content);
      }
    } finally {
      if (controller.current === run) {
        controller.current = null;
        if (!run.signal.aborted) setBusy(false);
      }
    }
  }

  const hold = useHoldToTalk({
    characterId: character.id, canStart: () => !controller.current,
    onRecordingStart: () => { audioRequest.current++; playback.current?.abort(); setError(""); },
    onTranscript: text => { void send(text, "voice"); },
    onError: message => {
      if (/^语音识别 API 错误 (401|403)\b|令牌无效|invalid (?:token|api[ _-]?key)/i.test(message)) {
        if (browserAvailable) {
          onSpeechInput("browser");
          setError("云端语音识别认证失败，已切换到浏览器识别，请重新说一次。");
        } else {
          setError("云端语音识别认证失败，请检查语音识别配置的地址和密钥。");
        }
        return;
      }
      setError(message);
    },
  });
  const keyboardOffset = useCallKeyboardOffsetStyle();

  function toggleSpeechRecognition() {
    if (browserListening) { recording.current?.stop(); return; }
    audioRequest.current++;
    playback.current?.abort();
    unlockAudioPlayback();
    setError("");
    interim.current = "";
    const finish = (text = "", issue = "") => {
      if (recording.current !== session) return;
      recording.current = null;
      interim.current = "";
      setInterimText("");
      setBrowserListening(false);
      if (text.trim()) void send(text, "voice");
      else setError(issue || "没有识别到语音，请再说一次。");
    };
    const session = createSTTSession({
      onInterim: text => { interim.current = text; setInterimText(text); },
      onFinal: text => finish(text),
      onError: message => { finish("", message); setVoiceInput(false); },
      onEnd: () => finish(interim.current),
      onNoSpeech: () => finish(),
    }, "zh-CN");
    recording.current = session;
    setBrowserListening(session.isSupported);
    session.start();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !draft.trim()) return;
    void send(draft, "text");
    setDraft("");
  }

  const listening = browserListening || hold.recState !== "idle";
  return <section className="facing-room" style={keyboardOffset} aria-label={`与${character.name}见面`}>
    <FacingStage portrait={portrait} scene={scene} reaction={reaction} fallback={character.avatar}
      name={character.name} points={busy || listening ? [] : points} onPoint={point => void send(point.label, "touch")}
      onReactionEnd={stopReaction} />
    <header className="facing-room-top">
      <button type="button" className="facing-glass facing-icon" aria-label="返回" onClick={onEnd}><ChevronLeft size={22} /></button>
      <span className="facing-glass facing-room-scene" aria-label="当前场景">{position.sceneName}</span>
      <div>
        <button type="button" className="facing-glass facing-icon" aria-label={voiceOn ? "关闭角色语音" : "开启角色语音"}
          aria-pressed={voiceOn} onClick={() => { unlockAudioPlayback(); onVoice(!voiceOn); }}>{voiceOn ? <Volume2 size={19} /> : <VolumeX size={19} />}</button>
        <button type="button" className="facing-glass facing-icon" aria-label="设置" disabled={busy || listening} onClick={onSettings}><Settings2 size={19} /></button>
      </div>
    </header>
    <div className="facing-room-bottom">
      {(meeting.turns.length > 0 || busy || error || interimText) && <div ref={log} className="facing-room-log" role="log"
        aria-label="对话记录" tabIndex={0} onScroll={event => {
          const area = event.currentTarget;
          followLog.current = area.scrollHeight - area.scrollTop - area.clientHeight < 48;
        }}>
        {meeting.turns.map(turn => <article key={turn.id} className="facing-glass facing-message" data-role={turn.role}>
          <small>{turn.role === "assistant" ? character.name : "你"}{turn.kind === "voice" ? " · 语音转写" : ""}</small>
          {turn.action && <p className="facing-action">{turn.action}</p>}
          {turn.text && <p>{turn.kind === "touch" ? `（触碰了${turn.text}）` : turn.text}</p>}
          {!turn.action && !turn.text && <p className="facing-action">{turn.reactionName ? `（${turn.reactionName}）` : `来到${turn.sceneName}`}</p>}
        </article>)}
        {interimText && <div className="facing-glass facing-message" data-role="user"><small>语音识别中</small><p>{interimText}</p></div>}
        {busy && <div className="facing-glass facing-message facing-log-status">正在回应…</div>}
        {error && <p className="facing-glass facing-message facing-log-status" role="alert">{error}</p>}
        {!busy && !listening && failedTurn?.role === "user" && <button type="button" className="facing-glass facing-retry"
          onClick={() => void send(failedTurn.text, failedTurn.kind, failedTurn)}>重试回复</button>}
      </div>}
      <div className="facing-controls facing-glass">
        <form onSubmit={submit}>
          <button type="button" className="facing-glass facing-icon" disabled={listening}
            aria-label={voiceInput ? "切换文字输入" : "切换语音输入"} onClick={() => {
              if (!cloudAvailable && !browserAvailable) { setError("当前浏览器无法直接识别语音。可以配置云端语音识别，或使用文字输入。"); return; }
              setVoiceInput(!voiceInput);
              setError("");
            }}>
            {voiceInput ? <Keyboard size={18} /> : <Mic size={18} />}
          </button>
          {voiceInput ? useCloudStt
            ? <button type="button" className="facing-glass facing-hold" disabled={busy || hold.recState === "transcribing"} {...hold.pressHandlers}>
                {hold.recState === "recording" ? "松开发送" : hold.recState === "transcribing" ? "正在识别…" : "按住说话"}
              </button>
            : <button type="button" className="facing-glass facing-hold" disabled={busy} onClick={toggleSpeechRecognition}>
                {browserListening ? "说完了" : "开始说话"}
              </button>
            : <>
              <input value={draft} onChange={event => setDraft(event.target.value)} placeholder="和他说句话…" aria-label="对话内容" maxLength={4000} />
              <button type="submit" className="facing-glass facing-icon facing-send" aria-label="发送" disabled={busy || !draft.trim()}><ArrowUp size={20} /></button>
            </>}
        </form>
        {voiceInput && cloudAvailable && browserAvailable && <button type="button" className="facing-glass facing-stt-mode" disabled={busy || listening}
          onClick={() => { onSpeechInput(useCloudStt ? "browser" : "cloud"); setError(""); }}>
          {useCloudStt ? "改用浏览器识别" : "改用云端识别"}
        </button>}
        <button type="button" className="facing-glass facing-end" onClick={onEnd}><PhoneOff size={16} />结束</button>
      </div>
    </div>
  </section>;
}
