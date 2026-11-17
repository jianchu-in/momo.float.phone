"use client";

import { useEffect, useRef, useState, type FormEvent, type CSSProperties } from "react";
import { ArrowUp, ChevronLeft, Eye, EyeOff, ImagePlus, Keyboard, Mic, Settings2, Volume2, VolumeX, X } from "lucide-react";
import { useHoldToTalk } from "@/components/chat/use-hold-to-talk";
import { isIOSDevice } from "@/components/chat/voice-input-platform";
import type { Character } from "@/lib/character-types";
import { generateFacingReply } from "@/lib/facing-engine";
import { appendFacingTurn, changeFacingTurns, facingCompletedRounds, facingId, facingReplyVersion, facingScenePosition, FACING_DEFAULT_APPEARANCE, shouldCheckFacingVisual, type FacingAsset, type FacingCharacterSettings, type FacingHotspot, type FacingMeeting, type FacingSceneGroup, type FacingScenePosition, type FacingTurn } from "@/lib/facing-storage";
import { isCallRecordingSupported, resolveCloudSttConfig } from "@/lib/stt-cloud";
import { createSTTSession, isBrowserSpeechRecognitionSupported, type STTSession } from "@/lib/stt-service";
import { playAudioBlob, playAudioBlobViaMediaElement, resolveVoiceConfig, synthesizeSpeech, unlockAudioPlayback } from "@/lib/tts-service";
import { FacingStage } from "./facing-stage";
import { FacingMessage } from "./facing-message";
import { useFacingViewportInset } from "./use-facing-viewport-inset";
import { ShownImage } from "@/components/ui/shown-image";
import { splitVisibleCallActions } from "@/lib/call-action-text";
import { storeShownImage } from "@/lib/shown-image";

export function FacingRoom({ character, meeting, settings, portrait, scene, position, scenes, autoAsset, autoProgress, onCompleted,
  onMeeting, onSettings, onEnd, onVoice, onSpeechInput }: {
  character: Character;
  meeting: FacingMeeting;
  settings: FacingCharacterSettings;
  portrait?: FacingAsset;
  scene?: FacingAsset;
  position: FacingScenePosition;
  scenes: FacingSceneGroup[];
  autoAsset?: FacingAsset;
  autoProgress?: { message?: string; activity?: { id: string; label: string; sceneName: string } };
  onCompleted: (meeting: FacingMeeting) => void;
  onMeeting: (meeting: FacingMeeting) => void;
  onSettings: () => void;
  onEnd: () => void;
  onVoice: (enabled: boolean) => void;
  onSpeechInput: (mode: NonNullable<FacingCharacterSettings["speechInput"]>) => void;
}) {
  const [reaction, setReaction] = useState<FacingAsset>();
  const [expiredVisual, setExpiredVisual] = useState<string>();
  const [draft, setDraft] = useState("");
  const [hidden, setHidden] = useState(false);
  const [photo, setPhoto] = useState<File>();
  const [touches, setTouches] = useState<FacingHotspot[]>([]);
  const [touchEffect, setTouchEffect] = useState<{ label: string; x: number; y: number; id: string }>();
  const [menuId, setMenuId] = useState<string>();
  const [messageDialog, setMessageDialog] = useState<"edit" | "instruction" | "delete">();
  const [messageDraft, setMessageDraft] = useState("");
  const [actionDraft, setActionDraft] = useState("");
  const photoPicker = useRef<HTMLInputElement>(null);
  const roomRef = useRef<HTMLElement>(null);
  const touchTap = useRef<{ id: string; at: number } | undefined>(undefined);

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
  const displayedVisual = settings.autoVisual?.enabled && meeting.visual?.sceneName === position.sceneName && meeting.visual.activityId !== expiredVisual
    && (meeting.visual.expiresAt === undefined || meeting.visual.expiresAt > Date.now()) ? autoAsset : undefined;
  const pendingActivity = autoProgress?.activity?.sceneName === position.sceneName ? autoProgress.activity : undefined;
  const existingActivity = displayedVisual && meeting.visual && meeting.visual.expiresAt === undefined
    ? { id: meeting.visual.activityId, label: displayedVisual.name } : undefined;

  useEffect(() => {
    if (log.current && (followLog.current || failedTurn?.role === "user")) log.current.scrollTop = log.current.scrollHeight;
  }, [failedTurn, busy, hidden, interimText, error]);

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
    if (!meeting.visual?.expiresAt) return;
    const { activityId, expiresAt } = meeting.visual;
    const timer = window.setTimeout(() => setExpiredVisual(activityId), Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [meeting.visual]);

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

  async function send(text: string, kind: FacingTurn["kind"], options?: {
    retry?: FacingTurn; previous?: FacingTurn; instruction?: string; photo?: File; touches?: FacingHotspot[];
  }) {
    const content = text.trim();
    if ((!content && !options?.photo && !options?.touches?.length && !options?.retry) || controller.current) return;
    const run = new AbortController();
    controller.current = run;
    audioRequest.current++;
    playback.current?.abort();
    unlockAudioPlayback();
    setBusy(true);
    setError("");
    stopReaction();
    if (!options?.retry) followLog.current = true;
    let stored = !!options?.retry;
    try {
      const user: FacingTurn = options?.retry ?? {
        ...position, id: facingId(), role: "user", kind, text: content, at: new Date().toISOString(),
        touches: options?.touches?.map(point => point.label),
        imageRef: options?.photo ? await storeShownImage(options.photo) : undefined,
      };
      if (run.signal.aborted) return;
      const current = options?.retry ? meeting : await appendFacingTurn(meeting, user);
      stored = true;
      if (run.signal.aborted) return;
      onMeeting(current);
      const end = current.turns.findIndex(turn => turn.id === user.id);
      if (end < 0) throw new Error("找不到要重试的原消息。");
      const context = { ...current, turns: current.turns.slice(0, end + 1) };
      const activity = options?.retry || !settings.autoVisual?.enabled ? undefined : pendingActivity ?? existingActivity;
      const deferVisual = !options?.previous && end === current.turns.length - 1 && settings.autoVisual?.skipNsfw === true
        && shouldCheckFacingVisual(facingCompletedRounds(current) + 1, settings.autoVisual);
      const result = await generateFacingReply({ character, meeting: context, settings, scene: user.sceneName, scenes,
        signal: run.signal, retryInstruction: options?.instruction, visualActivity: activity?.label, deferVisual });
      if (run.signal.aborted) return;
      const response: FacingTurn = {
        ...(result.nextScene ? facingScenePosition(result.nextScene) : { sceneName: user.sceneName, sceneId: user.sceneId, portraitId: user.portraitId }),
        id: facingId(), role: "assistant", kind: "reply", text: result.dialogue, action: result.action,
        at: new Date().toISOString(), replyTo: user.id, reactionId: result.reaction?.id, reactionName: result.reaction?.name,
        visualContinuityId: deferVisual && existingActivity ? existingActivity.id : result.visualContinues ? activity?.id : undefined,
      };
      const previous = options?.previous;
      const saved = previous ? await changeFacingTurns(current, turns => turns.map(turn => {
        if (turn.id !== previous.id) return turn;
        const versions = [...(turn.versions ?? [facingReplyVersion(turn)]), facingReplyVersion(response)];
        return { ...turn, ...facingReplyVersion(response), versions, versionIndex: versions.length - 1 };
      })) : await appendFacingTurn(current, response);
      if (run.signal.aborted) return;
      onMeeting(saved);
      if (saved.turns.at(-1)?.id === (previous?.id ?? response.id)) {
        setReaction(result.reaction);
        void speak(result.dialogue, run.signal);
        if (!previous) onCompleted(saved);
      }
    } catch (cause) {
      if (!run.signal.aborted) {
        setError(cause instanceof Error ? cause.message : stored ? "角色回复失败。" : "消息保存失败，请重试。");
        if (!stored && options?.photo) setPhoto(options.photo);
        if (!stored && options?.touches?.length) setTouches(current => [...options.touches!, ...current]);
        if (!stored && kind !== "touch") setDraft(content);
      }
    } finally {
      if (controller.current === run) {
        controller.current = null;
        if (!run.signal.aborted) setBusy(false);
      }
    }
  }

  function consumeTouches() {
    touchTap.current = undefined;
    setTouches([]);
    return touches;
  }

  function submitVoice(text: string) {
    void send(text, "voice", { photo, touches: consumeTouches() });
    setPhoto(undefined);
  }

  function retryMessage(selected: FacingTurn, instruction?: string) {
    const index = meeting.turns.findIndex(turn => turn.id === selected.id);
    const user = selected.role === "user" ? selected : meeting.turns.find(turn => turn.id === selected.replyTo)
      ?? meeting.turns.slice(0, index).reverse().find(turn => turn.role === "user");
    const previous = selected.role === "assistant" ? selected : meeting.turns.find(turn => turn.replyTo === selected.id);
    if (!user) { setError("这条回复对应的用户消息已删除。"); return; }
    void send(user.text, user.kind, { retry: user, previous, instruction });
  }

  async function updateTurns(update: (turns: FacingTurn[]) => FacingTurn[]) {
    if (controller.current) return;
    const operation = new AbortController();
    controller.current = operation;
    setBusy(true);
    setError("");
    try {
      const saved = await changeFacingTurns(meeting, update);
      if (!operation.signal.aborted) { stopReaction(); onMeeting(saved); }
    } catch {
      if (!operation.signal.aborted) setError("消息修改未保存，请重试。");
    } finally {
      if (controller.current === operation) controller.current = null;
      if (!operation.signal.aborted) setBusy(false);
    }
  }

  function changeVersion(turn: FacingTurn, versionIndex: number) {
    void updateTurns(turns => turns.map(item => item.id === turn.id && item.versions?.[versionIndex]
      ? { ...item, ...item.versions[versionIndex], versionIndex } : item));
  }

  function handleTouch(point: FacingHotspot, coordinates?: { x: number; y: number }) {
    const bounds = roomRef.current?.getBoundingClientRect();
    if (bounds) setTouchEffect({ label: point.label, x: (coordinates?.x ?? bounds.left + bounds.width / 2) - bounds.left,
      y: (coordinates?.y ?? bounds.top + bounds.height / 2) - bounds.top, id: facingId() });
    const mode = settings.touchMode ?? "instant";
    const now = Date.now();
    const double = mode === "double" && touchTap.current?.id === point.id && now - touchTap.current.at < 380;
    touchTap.current = double ? undefined : { id: point.id, at: now };
    if (mode === "instant" || double) {
      if (double) setTouches(current => current.filter(item => item.id !== point.id));
      void send(point.label, "touch");
      return;
    }
    setTouches(current => current.some(item => item.id === point.id) ? current : [...current, point]);
  }

  useEffect(() => {
    if (!touchEffect) return;
    const timer = window.setTimeout(() => setTouchEffect(undefined), 1400);
    return () => window.clearTimeout(timer);
  }, [touchEffect]);

  const hold = useHoldToTalk({
    characterId: character.id, canStart: () => !controller.current,
    onRecordingStart: () => { audioRequest.current++; playback.current?.abort(); setError(""); },
    onTranscript: submitVoice,
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
  const viewportInset = useFacingViewportInset(roomRef);

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
      if (text.trim()) submitVoice(text);
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
    if (busy || (!draft.trim() && !photo && !touches.length)) return;
    void send(draft, "text", { photo, touches: consumeTouches() });
    setDraft("");
    setPhoto(undefined);
  }

  const listening = browserListening || hold.recState !== "idle";
  const selectedMessage = meeting.turns.find(turn => turn.id === menuId);
  const appearance = settings.appearance;
  const roomStyle = { "--facing-viewport-inset": `${viewportInset}px`, "--facing-bubble-color": appearance?.bubbleColor ?? FACING_DEFAULT_APPEARANCE.bubbleColor,
    "--facing-bubble-opacity": `${appearance?.opacity ?? FACING_DEFAULT_APPEARANCE.opacity}%`, "--facing-message-color": appearance?.textColor ?? FACING_DEFAULT_APPEARANCE.textColor,
    "--facing-user-bubble-color": appearance?.bubbleColor ?? "#3d2f50", "--facing-user-bubble-opacity": `${appearance?.opacity ?? 49}%`,
    "--facing-message-size": `${appearance?.textSize ?? FACING_DEFAULT_APPEARANCE.textSize}px` } as CSSProperties;
  function closeMenu() { setMenuId(undefined); setMessageDialog(undefined); }
  function applyMessageDialog() {
    if (!selectedMessage) return;
    if (messageDialog === "instruction") retryMessage(selectedMessage, messageDraft);
    if (messageDialog === "delete") void updateTurns(turns => turns.filter(turn => turn.id !== selectedMessage.id)
      .map(turn => turn.replyTo === selectedMessage.id ? { ...turn, replyTo: undefined } : turn));
    if (messageDialog === "edit") void updateTurns(turns => turns.map(turn => {
      if (turn.id !== selectedMessage.id) return turn;
      const action = splitVisibleCallActions(actionDraft);
      const visibleAction = [...action.actions, ...(action.speech ? [`（${action.speech}）`] : [])].join(" ");
      const updated = { ...turn, text: messageDraft.trim(), action: turn.role === "assistant" ? visibleAction || undefined : turn.action };
      const versions = turn.versions?.map((version, index) => index === (turn.versionIndex ?? 0) ? facingReplyVersion(updated) : version);
      return { ...updated, versions };
    }));
    closeMenu();
  }
  return <section ref={roomRef} className="facing-room" style={roomStyle} aria-label={`与${character.name}见面`}>
    <FacingStage portrait={portrait} scene={scene} reaction={reaction ?? displayedVisual} fallback={character.avatar}
      name={character.name} points={busy || listening ? [] : points} onPoint={handleTouch}
      retainPoints={!reaction && !!displayedVisual} onReactionEnd={stopReaction} />
    {touchEffect && <div key={touchEffect.id} className="facing-touch-feedback" style={{ left: touchEffect.x, top: touchEffect.y }} role="status">
      <span aria-hidden="true" /><small>你触碰了他的{touchEffect.label}</small>
    </div>}
    <header className="facing-room-top">
      <button type="button" className="facing-glass facing-icon" aria-label="返回" onClick={onEnd}><ChevronLeft size={22} /></button>
      <div className="facing-room-location">
        <span className="facing-glass facing-room-scene" aria-label="当前场景">{position.sceneName}</span>
        {settings.autoVisual?.enabled && autoProgress?.message && <small className="facing-glass facing-visual-status" role="status">{autoProgress.message}</small>}
      </div>
      <div>
        <button type="button" className="facing-glass facing-icon" aria-label={hidden ? "显示对话" : "隐藏对话"}
          aria-pressed={hidden} onClick={() => { setHidden(value => !value); followLog.current = true; }}>
          {hidden ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>
        <button type="button" className="facing-glass facing-icon" aria-label={voiceOn ? "关闭角色语音" : "开启角色语音"}
          aria-pressed={voiceOn} onClick={() => { unlockAudioPlayback(); onVoice(!voiceOn); }}>{voiceOn ? <Volume2 size={19} /> : <VolumeX size={19} />}</button>
        <button type="button" className="facing-glass facing-icon" aria-label="设置" disabled={busy || listening} onClick={onSettings}><Settings2 size={19} /></button>
      </div>
    </header>
    {!hidden && <div className="facing-room-bottom">
      {(meeting.turns.length > 0 || busy || error || interimText) && <div ref={log} className="facing-room-log" role="log"
        aria-label="对话记录" tabIndex={0} onScroll={event => {
          const area = event.currentTarget;
          followLog.current = area.scrollHeight - area.scrollTop - area.clientHeight < 48;
        }}>
        {meeting.turns.map(turn => <FacingMessage key={turn.id} turn={turn} characterName={character.name} busy={busy || listening}
          onMenu={() => { setMenuId(turn.id); setMessageDialog(undefined); }} onVersion={index => changeVersion(turn, index)} />)}
        {interimText && <div className="facing-glass facing-message" data-role="user"><small>语音识别中</small><p>{interimText}</p></div>}
        {busy && <div className="facing-glass facing-message facing-log-status">正在回应…</div>}
        {error && <p className="facing-glass facing-message facing-log-status" role="alert">{error}</p>}
        {!busy && !listening && failedTurn?.role === "user" && <button type="button" className="facing-glass facing-retry"
          onClick={() => retryMessage(failedTurn)}>重试回复</button>}
      </div>}
      <div className="facing-controls facing-glass">
        {(touches.length > 0 || photo) && <div className="facing-drafts">
          {touches.map(point => <button type="button" key={point.id} className="facing-touch-chip" aria-label={`移除${point.label}`}
            onClick={() => { touchTap.current = undefined; setTouches(items => items.filter(item => item.id !== point.id)); }}>
            <X size={13} />{point.label}
          </button>)}
          {photo && <div className="facing-photo-draft"><ShownImage file={photo} />
            <button type="button" aria-label="移除图片" onClick={() => setPhoto(undefined)}><X size={14} /></button></div>}
        </div>}
        <input ref={photoPicker} type="file" accept="image/*" hidden onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) setPhoto(file);
        }} />
        <form className="facing-composer-row" data-voice={voiceInput ? "true" : undefined} onSubmit={submit}>
          <button type="button" className="facing-glass facing-icon" aria-label="当面展示图片" disabled={busy || listening}
            onClick={() => { setVoiceInput(false); photoPicker.current?.click(); }}><ImagePlus size={20} /></button>
          <div className="facing-input">
            {voiceInput ? useCloudStt
              ? <button type="button" className="facing-hold" disabled={busy || hold.recState === "transcribing"} {...hold.pressHandlers}>
                  {hold.recState === "recording" ? "松开发送" : hold.recState === "transcribing" ? "正在识别…" : "按住说话"}
                </button>
              : <button type="button" className="facing-hold" disabled={busy} onClick={toggleSpeechRecognition}>
                  {browserListening ? "说完了" : "开始说话"}
                </button>
              : <input value={draft} onChange={event => setDraft(event.target.value)} placeholder="和他说句话…" aria-label="对话内容" maxLength={4000} />}
            <button type="button" className="facing-input-mic" disabled={listening}
              aria-label={voiceInput ? "切换文字输入" : "切换语音输入"} onClick={() => {
                if (!cloudAvailable && !browserAvailable) { setError("当前浏览器无法直接识别语音。可以配置云端语音识别，或使用文字输入。"); return; }
                setVoiceInput(!voiceInput);
                setError("");
              }}>{voiceInput ? <Keyboard size={14} /> : <Mic size={14} />}</button>
          </div>
          {!voiceInput && <button type="submit" className="facing-glass facing-icon facing-send" aria-label="发送"
            disabled={busy || (!draft.trim() && !photo && !touches.length)}><ArrowUp size={19} /></button>}
        </form>
        {voiceInput && cloudAvailable && browserAvailable && <button type="button" className="facing-glass facing-stt-mode" disabled={busy || listening}
          onClick={() => { onSpeechInput(useCloudStt ? "browser" : "cloud"); setError(""); }}>
          {useCloudStt ? "改用浏览器识别" : "改用云端识别"}
        </button>}
      </div>
    </div>}
    {selectedMessage && <div className="facing-overlay" onClick={closeMenu}>
      <section className="facing-sheet" role="dialog" aria-modal="true" aria-label="消息操作" onClick={event => event.stopPropagation()}>
        <header><h2>{messageDialog === "edit" ? "编辑消息" : messageDialog === "instruction" ? "指令重试" : messageDialog === "delete" ? "删除这条消息？" : "消息操作"}</h2>
          <button type="button" className="facing-icon" aria-label="关闭消息操作" onClick={closeMenu}><X size={18} /></button></header>
        {messageDialog ? <>
          {messageDialog !== "delete" && <textarea className="facing-message-editor" aria-label={messageDialog === "edit" ? "消息内容" : "重试指令"}
            value={messageDraft} rows={4} maxLength={4000} onChange={event => setMessageDraft(event.target.value)} />}
          {messageDialog === "edit" && selectedMessage.role === "assistant" && <textarea className="facing-message-editor" aria-label="动作描述"
            placeholder="（动作描述）" value={actionDraft} rows={2} maxLength={2000} onChange={event => setActionDraft(event.target.value)} />}
          <button type="button" className="facing-primary" onClick={applyMessageDialog}
            disabled={messageDialog === "instruction" && !messageDraft.trim()}>{messageDialog === "delete" ? "确认删除" : messageDialog === "edit" ? "保存" : "重新生成"}</button>
        </> : <div className="facing-list">
          <button type="button" onClick={() => { closeMenu(); retryMessage(selectedMessage); }}>重试</button>
          <button type="button" onClick={() => { setMessageDraft(selectedMessage.text); setActionDraft(selectedMessage.action ?? ""); setMessageDialog("edit"); }}>编辑</button>
          <button type="button" onClick={() => { setMessageDraft(""); setMessageDialog("instruction"); }}>指令重试</button>
          <button type="button" className="facing-delete" onClick={() => setMessageDialog("delete")}>删除</button>
        </div>}
      </section>
    </div>}
  </section>;
}
