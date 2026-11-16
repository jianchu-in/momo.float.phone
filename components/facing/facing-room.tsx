"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, ChevronLeft, Keyboard, Mic, PhoneOff, Settings2, Volume2, VolumeX } from "lucide-react";
import { useHoldToTalk } from "@/components/chat/use-hold-to-talk";
import { useCallKeyboardOffsetStyle } from "@/components/chat/use-call-keyboard-offset";
import type { Character } from "@/lib/character-types";
import { generateFacingReply } from "@/lib/facing-engine";
import { appendFacingTurn, facingId, facingScenePosition, type FacingAsset, type FacingCharacterSettings, type FacingMeeting, type FacingSceneGroup, type FacingScenePosition, type FacingTurn } from "@/lib/facing-storage";
import { isCallRecordingSupported, resolveCloudSttConfig } from "@/lib/stt-cloud";
import { createSTTSession, type STTSession } from "@/lib/stt-service";
import { playAudioBlobViaMediaElement, resolveVoiceConfig, synthesizeSpeech, unlockAudioPlayback } from "@/lib/tts-service";
import { FacingStage } from "./facing-stage";

export function FacingRoom({ character, meeting, settings, portrait, scene, position, scenes, onMeeting, onSettings, onEnd, onVoice }: {
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
}) {
  const prior = meeting.turns.filter(turn => turn.role === "assistant").at(-1);
  const [reply, setReply] = useState(prior?.text ?? "");
  const [reactionLabel, setReactionLabel] = useState("");
  const [reaction, setReaction] = useState<FacingAsset>();
  const [draft, setDraft] = useState("");
  const [voiceInput, setVoiceInput] = useState(false);
  const [browserListening, setBrowserListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const recording = useRef<STTSession | null>(null);
  const playback = useRef<ReturnType<typeof playAudioBlobViaMediaElement> | null>(null);
  const audioRequest = useRef(0);
  const cloudStt = !!resolveCloudSttConfig(character.id, "facing") && isCallRecordingSupported();
  const voiceOn = settings.voice !== false;
  const points = settings.touch === false ? [] : settings.hotspots?.[portrait?.id ?? "avatar"] ?? [];
  const failedTurn = meeting.turns.at(-1);

  useEffect(() => () => {
    controller.current?.abort();
    recording.current?.abort();
    audioRequest.current++;
    playback.current?.abort();
  }, []);

  useEffect(() => {
    if (!reaction) return;
    const timer = window.setTimeout(() => { setReaction(undefined); setReactionLabel(""); }, reaction.durationMs);
    return () => window.clearTimeout(timer);
  }, [reaction]);

  useEffect(() => {
    if (voiceOn) return;
    audioRequest.current++;
    playback.current?.abort();
  }, [voiceOn]);

  function stopReaction() {
    setReaction(undefined);
    setReactionLabel("");
  }

  async function speak(text: string, run: AbortSignal) {
    if (!text || !voiceOn) return;
    const voice = resolveVoiceConfig(character.id, "facing");
    if (!voice) return;
    const request = ++audioRequest.current;
    try {
      const audio = await synthesizeSpeech(text, voice);
      if (!audio || audioRequest.current !== request || run.aborted) return;
      playback.current = playAudioBlobViaMediaElement(audio);
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
        id: facingId(), role: "assistant", kind: "reply", text: result.dialogue,
        at: new Date().toISOString(), replyTo: user.id, reactionId: result.reaction?.id, reactionName: result.reaction?.name,
      });
      if (run.signal.aborted) return;
      onMeeting(saved);
      setReply(result.dialogue);
      setReaction(result.reaction);
      setReactionLabel(result.reaction?.name ?? "");
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
    characterId: character.id, appId: "facing", canStart: () => !controller.current,
    onRecordingStart: () => { audioRequest.current++; playback.current?.abort(); setError(""); },
    onTranscript: text => { void send(text, "voice"); },
    onError: setError,
  });
  const keyboardOffset = useCallKeyboardOffsetStyle();

  function toggleSpeechRecognition() {
    if (browserListening) { recording.current?.stop(); return; }
    audioRequest.current++;
    playback.current?.abort();
    unlockAudioPlayback();
    setError("");
    const finish = () => { setBrowserListening(false); recording.current = null; };
    const session = createSTTSession({
      onInterim: () => {},
      onFinal: text => { finish(); void send(text, "voice"); },
      onError: message => { finish(); setError(message); },
      onEnd: finish,
      onNoSpeech: () => { finish(); setError("没有识别到语音，请再说一次。"); },
    });
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
      {(reply || reactionLabel || busy || error) && <div className="facing-caption facing-glass" aria-live="polite">
        <small>{character.name}{reactionLabel ? ` · ${reactionLabel}` : ""}</small>
        {reply && <p>{reply}</p>}
        {busy && <p>正在回应…</p>}
        {error && <p role="alert">{error}</p>}
        {!busy && failedTurn?.role === "user" && <button type="button" className="facing-glass facing-retry"
          onClick={() => void send(failedTurn.text, failedTurn.kind, failedTurn)}>重试回复</button>}
      </div>}
      {!reply && !reactionLabel && !busy && !error && failedTurn?.role === "user" &&
        <button type="button" className="facing-glass facing-retry" onClick={() => void send(failedTurn.text, failedTurn.kind, failedTurn)}>重试回复</button>}
      <div className="facing-controls facing-glass">
        <form onSubmit={submit}>
          <button type="button" className="facing-glass facing-icon" disabled={listening}
            aria-label={voiceInput ? "切换文字输入" : "切换语音输入"} onClick={() => { setVoiceInput(!voiceInput); setError(""); }}>
            {voiceInput ? <Keyboard size={18} /> : <Mic size={18} />}
          </button>
          {voiceInput ? cloudStt
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
        <button type="button" className="facing-glass facing-end" onClick={onEnd}><PhoneOff size={16} />结束</button>
      </div>
    </div>
  </section>;
}
