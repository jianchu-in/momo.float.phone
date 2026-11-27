"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type CSSProperties } from "react";
import { ArrowUp, Plus, UsersRound, ChevronLeft, Eye, EyeOff, ImagePlus, Keyboard, Map as MapIcon, Mic, Settings2, Square, Phone, PhoneOff, Pause, X } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import { useHoldToTalk } from "@/components/chat/use-hold-to-talk";
import { isIOSDevice } from "@/components/chat/voice-input-platform";
import type { Character } from "@/lib/character-types";
import { generateFacingReply } from "@/lib/facing-engine";
import { isFacingCgVisible, markFacingCgShown, toggleFacingCg, appendFacingTurn, appendFacingTurns, facingParticipantIds, loadFacingSettings, changeFacingTurns, facingCompletedRounds, facingId, facingReplyVersion, facingScenePosition, FACING_DEFAULT_APPEARANCE, shouldCheckFacingVisual, type FacingAsset, type FacingCharacterSettings, type FacingHotspot, type FacingMeeting, type FacingSceneGroup, type FacingScenePosition, type FacingTurn } from "@/lib/facing-storage";
import { isCallRecordingSupported, resolveCloudSttConfig } from "@/lib/stt-cloud";
import { createSTTSession, isBrowserSpeechRecognitionSupported, type STTSession } from "@/lib/stt-service";
import { unlockAudioPlayback } from "@/lib/tts-service";
import type { FacingAmbienceControl } from "./facing-ambience";
import type { facingLocationCandidates } from "@/lib/facing-location";
import { FacingStage } from "./facing-stage";
import { FacingMessage } from "./facing-message";
import { useFacingSpeaker } from "./use-facing-speaker";
import { useFacingSpeech } from "./use-facing-speech";
import { useFacingLiveVoice } from "./use-facing-live-voice";
import { createFacingVoiceSession } from "@/lib/facing-voice-input";
import { FacingStoryDialog } from "./facing-story-dialog";
import { useFacingViewportInset } from "./use-facing-viewport-inset";
import { ShownImage } from "@/components/ui/shown-image";
import {facingSegmentText,facingVisibleSegments,parseFacingQuotedEdit,parseFacingReplyParts,summarizeFacingSegments} from "@/lib/facing-reply-format";
import { splitVisibleCallActions } from "@/lib/call-action-text";
import { storeShownImage } from "@/lib/shown-image";

export function FacingRoom({ character, meeting, settings, portrait, scene, position, scenes, autoAsset, autoProgress, onCompleted,
  onMeeting, onSettings, onEnd, onSpeechInput, onMap, onScene, onPortraitLayout, onStory,initialDraft,initialPhoto,onDraft,ambience,locationOptions,onLocation,onRetryCg }: {
  ambience?:FacingAmbienceControl;
  locationOptions?:ReturnType<typeof facingLocationCandidates>;
  onLocation?:(location?:{atlasId:string;placeId:string})=>Promise<void>;
  onRetryCg?:()=>void;
  initialDraft?:string;
  initialPhoto?:File;
  onDraft?:(text:string,photo?:File)=>void;
  onScene: (name:string) => Promise<void>;
  onPortraitLayout: (characterId:string, assetId:string, layout:{x:number;y:number;scale:number}) => Promise<void>;
  onStory:()=>Promise<void>;
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
  onMap: () => void;
  onEnd: () => void;
  onSpeechInput: (mode: NonNullable<FacingCharacterSettings["speechInput"]>) => void;
}) {
  const [reaction, setReaction] = useState<FacingAsset>();
  const [expiredVisual, setExpiredVisual] = useState<string>();
  const cast = useMemo(()=>loadCharacters().filter(item => facingParticipantIds(meeting).includes(item.id)),[meeting.participantIds,meeting.characterId]);
  const multi = cast.length > 1;
  const [activeTurnId, setActiveTurnId] = useState<string>();
  const [queuedIds, setQueuedIds] = useState<string[]>([]);
  const activeTurn = meeting.turns.find(item => item.id === activeTurnId) ?? meeting.turns.slice().reverse().find(item => item.role === "assistant");
  const speaker = cast.find(item => item.id === activeTurn?.speakerId) ?? character;
  const speakerVisualId = !meeting.visual?.replacement && activeTurn && meeting.visual && activeTurn.id === meeting.turns.at(-1)?.id && meeting.visual.sceneName === activeTurn.sceneName && activeTurn.sceneName === position.sceneName
    && meeting.visual.activityId !== expiredVisual && (meeting.visual.expiresAt === undefined || meeting.visual.expiresAt > Date.now()) ? meeting.visual.assetId : undefined;
  const speakerVisual = useFacingSpeaker(speaker, position.sceneName, multi, speakerVisualId ?? activeTurn?.reactionId);
  const storedReaction = scenes.find(group => group.name === position.sceneName)?.reactions.find(asset => asset.id === activeTurn?.reactionId);
  const [draft, setDraft] = useState(initialDraft??"");
  const draftRef=useRef(draft);draftRef.current=draft;
  useEffect(()=>()=>{onDraft?.(draftRef.current,photoRef.current);},[]);
  const [hidden, setHidden] = useState(false);
  const [fullConversation, setFullConversation] = useState(false);
  const [toolsOpen,setToolsOpen]=useState(false);
  const [optimisticTurn,setOptimisticTurn]=useState<FacingTurn>();
  const [scenePicker,setScenePicker]=useState(false);
  const [storyConfirm,setStoryConfirm]=useState(false);
  const [photo, setPhoto] = useState<File|undefined>(initialPhoto);
  const photoRef=useRef(photo);photoRef.current=photo;
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
  const [generating, setGenerating] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const recording = useRef<STTSession | null>(null);
  const interim = useRef("");
  const log = useRef<HTMLDivElement>(null);
  const followLog = useRef(true);
  const iosDevice = useRef(isIOSDevice()).current;
  const cloudAvailable = !iosDevice && isCallRecordingSupported() && !!resolveCloudSttConfig(character.id);
  const browserAvailable = isBrowserSpeechRecognitionSupported();
  const useCloudStt = cloudAvailable && (settings.speechInput !== "browser" || !browserAvailable);
  const voiceOn = settings.voice !== false;
  const live = useFacingLiveVoice({
    createSession: callbacks => createFacingVoiceSession(callbacks, character.id, settings.speechInput === "browser"),
    onTranscript: async text => {
      const selected = photoRef.current;
      setPhoto(undefined);
      return await send(text, "voice", { photo: selected, touches: consumeTouches() });
    },
    onError: setError,
  });
  const speech = useFacingSpeech(iosDevice, voiceOn || live.enabled, onMeeting, setError);
  const speakerSettings = useMemo(()=>multi ? loadFacingSettings().characters[speaker.id] ?? {} : settings,[multi,speaker.id,settings]);
  const points: FacingHotspot[] = [];
  const selectedPortrait=multi?speakerVisual.portrait:portrait;
  const stagePortrait=selectedPortrait ? {...selectedPortrait,layout:{...selectedPortrait.layout,...speakerSettings.portraitLayouts?.[selectedPortrait.id]}} : undefined;
  const failedTurn = meeting.turns.at(-1);
  const displayedVisual = isFacingCgVisible(meeting,settings.autoVisual) ? autoAsset : undefined;
  const pendingActivity = autoProgress?.activity?.sceneName === position.sceneName ? autoProgress.activity : undefined;
  const existingActivity = displayedVisual && meeting.visual && !meeting.visual.replacement && meeting.visual.expiresAt === undefined
    ? { id: meeting.visual.activityId, label: displayedVisual.name } : undefined;

  useEffect(() => {
    if (log.current && (followLog.current || failedTurn?.role === "user")) log.current.scrollTop = log.current.scrollHeight;
  }, [failedTurn, generating, stopped, hidden, interimText, error, queuedIds.length]);

  useEffect(() => () => {
    controller.current?.abort();
    recording.current?.abort();
  }, []);

  useEffect(() => {
    if (!reaction || reaction.composition !== "full") return;
    const timer = window.setTimeout(() => setReaction(undefined), reaction.durationMs);
    return () => window.clearTimeout(timer);
  }, [reaction]);

  useEffect(() => {
    if (!meeting.visual?.expiresAt) return;
    const { activityId, expiresAt } = meeting.visual;
    const timer = window.setTimeout(() => setExpiredVisual(activityId), Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [meeting.visual]);

  function stopReaction() {
    setReaction(undefined);
  }

  function stopGeneration() {
    live.pause();
    const request = controller.current;
    if (!request) return;
    controller.current = null;
    request.abort();
    speech.stop();
    setQueuedIds([]);
    setGenerating(false);
    setBusy(false);
    setStopped(true);
  }

  async function send(text: string, kind: FacingTurn["kind"], options?: {
    retry?: FacingTurn; previous?: FacingTurn; instruction?: string; photo?: File; touches?: FacingHotspot[];
  }) {
    const content = text.trim();
    if ((!content && !options?.photo && !options?.touches?.length && !options?.retry) || controller.current) return false;
    const run = new AbortController();
    controller.current = run;
    speech.stop();
    unlockAudioPlayback();
    setBusy(true);
    setGenerating(true);
    setStopped(false);
    setError("");
    stopReaction();
    if (!options?.retry) followLog.current = true;
    const pendingId=facingId();
    if(!options?.retry)setOptimisticTurn({...position,id:pendingId,role:"user",kind,text:content,at:new Date().toISOString()});
    let stored = !!options?.retry;
    try {
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      const user: FacingTurn = options?.retry ?? {
        ...position, id: pendingId, role: "user", kind, text: content, at: new Date().toISOString(),
        touches: options?.touches?.map(point => point.label),
        imageRef: options?.photo ? await storeShownImage(options.photo) : undefined,
      };
      if (run.signal.aborted) return false;
      const current = options?.retry ? meeting : await appendFacingTurn(meeting, user);
      stored = true;
      onMeeting(current);
      setOptimisticTurn(undefined);
      if (run.signal.aborted) return false;
      const end = current.turns.findIndex(turn => turn.id === user.id);
      if (end < 0) throw new Error("找不到要重试的原消息。");
      const context = { ...current, turns: current.turns.slice(0, end + 1) };
      const activity = options?.retry || !settings.autoVisual?.enabled ? undefined : pendingActivity ?? existingActivity;
      const illustrate = !options?.previous && end === current.turns.length - 1 && shouldCheckFacingVisual(facingCompletedRounds(current) + 1, settings.autoVisual);
      const deferVisual = false;
      setGenerating(true);
      const result = await generateFacingReply({ character, meeting: context, settings, scene: user.sceneName, scenes,
        signal: run.signal, retryInstruction: options?.instruction, speakerId: options?.previous?.speakerId, visualActivity: activity?.label, deferVisual, illustrate });
      if (run.signal.aborted) return false;
      const responses: FacingTurn[] = result.replies.map(reply => ({
        ...(reply.nextScene ? facingScenePosition(reply.nextScene) : { sceneName: user.sceneName, sceneId: user.sceneId, portraitId: user.portraitId }),
        id: facingId(), role: "assistant", kind: "reply", text: reply.dialogue, action: reply.action, segments: reply.segments,
        dialogueNotation: settings.dialogueNotation ?? "plain",
        speakerId: reply.speakerId, speakerName: reply.speakerName,
        at: new Date().toISOString(), replyTo: user.id, reactionId: reply.reaction?.id, reactionName: reply.reaction?.name,
        visualDescription: reply.visualDescription, visualRating: reply.visualRating, visualReferenceMode: settings.autoVisual?.referenceMode ?? "depicted", visualReferenceSource: settings.autoVisual?.referenceSource ?? "character", depictedCharacterIds: reply.depictedCharacterIds, userVisible: reply.userVisible,
        visualContinuityId: deferVisual && existingActivity ? existingActivity.id : reply.visualContinues ? activity?.id : undefined,
      }));
      const previous = options?.previous;
      const saved = previous ? await changeFacingTurns(current, turns => turns.map(turn => {
        if (turn.id !== previous.id) return turn;
        const response = responses.find(item => item.speakerId === previous.speakerId) ?? responses[0];
        const versions = [...(turn.versions ?? [facingReplyVersion(turn)]), facingReplyVersion(response)];
        return { ...turn, ...facingReplyVersion(response), versions, versionIndex: versions.length - 1 };
      })) : await appendFacingTurns(current, responses);
      if (run.signal.aborted) return false;
      const displayed = previous ? [saved.turns.find(item => item.id === previous.id)!] : responses.filter(item => saved.turns.some(turn => turn.id === item.id));
      setQueuedIds(displayed.map(item => item.id));
      onMeeting(saved);
      if(!previous)onCompleted(saved);
      let spoken = displayed.length > 0;
      for (const response of displayed) {
        if (run.signal.aborted) return false;
        setActiveTurnId(response.id);
        setQueuedIds(ids => ids.filter(id => id !== response.id));
        setReaction(result.replies.find(item => item.speakerId === response.speakerId)?.reaction);
        const played = await speech.play(response, saved, run.signal);
        if (!played) spoken = false;
        if (!played && multi && !run.signal.aborted) await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); run.signal.removeEventListener("abort", done); resolve(); };
          const timer = window.setTimeout(done, 650); run.signal.addEventListener("abort", done, { once: true });
        });
      }

      if (live.enabled && !spoken) setError(current => current || "回复已保存，但语音未能播放。请检查角色语音配置，再点击继续收音。");
      return !run.signal.aborted && (!live.enabled || spoken);
    } catch (cause) {
      if (!run.signal.aborted) {
        setError(cause instanceof Error ? cause.message : stored ? "角色回复失败。" : "消息保存失败，请重试。");
        if (!stored && options?.photo) setPhoto(options.photo);
        if (!stored && options?.touches?.length) setTouches(current => [...options.touches!, ...current]);
        if (!stored && kind !== "touch") setDraft(content);
      }
      return false;
    } finally {
      if(!stored&&run.signal.aborted){if(kind==="text")setDraft(current=>current||content);if(options?.photo)setPhoto(options.photo);}
      setOptimisticTurn(undefined);
      if (controller.current === run) {
        controller.current = null;
        if (!run.signal.aborted) { setQueuedIds([]); setGenerating(false); setBusy(false); }
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
    speech.stop();
    const operation = new AbortController();
    controller.current = operation;
    setBusy(true);
    setGenerating(true);
    setStopped(false);
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
      ? { ...item, ...item.versions[versionIndex], dialogueNotation: item.versions[versionIndex].dialogueNotation, versionIndex } : item));
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
    characterId: character.id, canStart: () => !controller.current && !live.enabled,
    onRecordingStart: () => { speech.stop(); setError(""); },
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
    speech.stop();
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
    if (busy || live.enabled || (!draft.trim() && !photo && !touches.length)) return;
    void send(draft, "text", { photo, touches: consumeTouches() });
    setDraft("");
    setPhoto(undefined);
  }

  const manualListening = browserListening || hold.recState !== "idle";
  const listening = manualListening || live.phase === "listening" || live.phase === "transcribing";
  const liveLabel = live.phase === "listening" ? "正在听你说话…" : live.phase === "transcribing" ? "正在识别…" : live.phase === "replying" ? "等角色说完，再自动收音" : "已暂停 · 点击继续说话";
  const showComposerAction = !voiceInput || generating;
  const selectedMessage = meeting.turns.find(turn => turn.id === menuId);
  const appearance = settings.appearance;
  const roomStyle = { "--facing-viewport-inset": `${viewportInset}px`, "--facing-bubble-color": appearance?.bubbleColor ?? FACING_DEFAULT_APPEARANCE.bubbleColor,
    "--facing-bubble-opacity": `${appearance?.opacity ?? FACING_DEFAULT_APPEARANCE.opacity}%`, "--facing-message-color": appearance?.textColor ?? FACING_DEFAULT_APPEARANCE.textColor,
    "--facing-user-bubble-color": appearance?.bubbleColor ?? "#3d2f50", "--facing-user-bubble-opacity": `${appearance?.opacity ?? 49}%`,
    "--facing-message-size": `${appearance?.textSize ?? FACING_DEFAULT_APPEARANCE.textSize}px` } as CSSProperties;
  function closeMenu() { setMenuId(undefined); setMessageDialog(undefined); }
  function applyMessageDialog() {
    if (!selectedMessage) return;
    let quotedEdit: ReturnType<typeof parseFacingReplyParts> | undefined;
    if (messageDialog === "edit" && selectedMessage.role === "assistant" && selectedMessage.dialogueNotation === "quoted") {
      try { const segments = parseFacingQuotedEdit(messageDraft); quotedEdit = {...summarizeFacingSegments(segments),segments}; }
      catch (cause) { setError(cause instanceof Error ? cause.message : "请检查对话符号。"); return; }
    }
    if (messageDialog === "instruction") retryMessage(selectedMessage, messageDraft);
    if (messageDialog === "delete") void updateTurns(turns => turns.filter(turn => turn.id !== selectedMessage.id)
      .map(turn => turn.replyTo === selectedMessage.id ? { ...turn, replyTo: undefined } : turn));
    if (messageDialog === "edit") void updateTurns(turns => turns.map(turn => {
      if (turn.id !== selectedMessage.id) return turn;
      const action = splitVisibleCallActions(actionDraft);
      const visibleAction = [...action.actions, ...(action.speech ? [`（${action.speech}）`] : [])].join(" ");
      const ordered=quotedEdit??(turn.role==="assistant"&&turn.segments?.length?parseFacingReplyParts({dialogue:messageDraft}):undefined);
      const updated = { ...turn, audioRef: undefined, text: ordered?.dialogue??messageDraft.trim(), action: ordered?ordered.action:turn.role === "assistant" ? visibleAction || undefined : turn.action, segments: ordered?.segments };
      const versions = turn.versions?.map((version, index) => index === (turn.versionIndex ?? 0) ? facingReplyVersion(updated) : version);
      return { ...updated, versions };
    }));
    closeMenu();
  }
  const messageNodes=useMemo(()=>meeting.turns.filter(turn => !queuedIds.includes(turn.id)).map(turn => <FacingMessage key={turn.id} turn={turn} characterName={turn.speakerName ?? character.name} busy={busy || listening}
          playing={speech.playingId === turn.id} onReplay={() => {
            live.pause();
            if (speech.playingId === turn.id) speech.stop();
            else { unlockAudioPlayback(); setActiveTurnId(turn.id); stopReaction(); void speech.play(turn, meeting, undefined, true); }
          }}
          onMenu={() => { live.pause();setMenuId(turn.id); setMessageDialog(undefined); }} onVersion={index => {live.pause();changeVersion(turn, index);}} />),[meeting.turns,queuedIds,busy,listening,speech.playingId,character.name]);
  return <section ref={roomRef} className="facing-room" data-full-conversation={fullConversation || undefined} style={roomStyle} aria-label={`与${character.name}见面`}>
    <FacingStage portrait={stagePortrait} scene={scene}
      reaction={displayedVisual ?? (multi ? (reaction?.characterId === speaker.id ? reaction : speakerVisual.reaction) : reaction ?? storedReaction)}
      fallback={multi ? speakerVisual.portrait ? undefined : speakerVisual.reference || speaker.avatar : scene ? undefined : character.avatar} hideBlank={false}
      name={speaker.name} points={[]}
      onDisplayed={assetId=>{void markFacingCgShown(meeting.id,assetId).then(saved=>{if(saved)onMeeting(saved);}).catch(()=>setError("CG展示进度保存失败。"));}}
      onActivate={() => { setFullConversation(true); setHidden(false); followLog.current = true; }}
      onLayout={busy||listening||!selectedPortrait||displayedVisual?.composition === "full"?undefined:layout=>{if(selectedPortrait)void onPortraitLayout(speaker.id,selectedPortrait.id,layout).catch(e=>setError(e instanceof Error?e.message:"立绘位置保存失败"));}}
      retainPoints={!reaction && !!displayedVisual} onReactionEnd={stopReaction} />
    {touchEffect && <div key={touchEffect.id} className="facing-touch-feedback" style={{ left: touchEffect.x, top: touchEffect.y }} role="status">
      <span aria-hidden="true" /><small>你触碰了他的{touchEffect.label}</small>
    </div>}
    <header className="facing-room-top">
      <button type="button" className="facing-glass facing-icon" aria-label="返回" onClick={()=>{live.stop();onEnd();}}><ChevronLeft size={22} /></button>
      <div className="facing-room-location">
        <button type="button" className="facing-glass facing-room-scene" title={position.sceneName} aria-label="更换当前场景" disabled={busy||listening} onClick={()=>{live.pause();setScenePicker(v=>!v);}}>{position.sceneName} ▾</button>
        {settings.autoVisual?.enabled && autoProgress?.message && <small className="facing-glass facing-visual-status" role="status">{autoProgress.message}{onRetryCg&&!autoProgress.message.includes("正在")&&<button type="button" onClick={onRetryCg}>调整并重试CG</button>}</small>}
      </div>
      <div className="facing-room-actions">
        {fullConversation && <button type="button" className="facing-glass facing-icon" aria-label="返回场景对话" onClick={() => setFullConversation(false)}>场景</button>}
        {facingParticipantIds(meeting).length===1&&<button type="button" className="facing-glass facing-icon" aria-label="进入剧情" disabled={busy||listening} onClick={()=>{live.pause();setStoryConfirm(true);}}>剧情</button>}
        <button type="button" className="facing-glass facing-icon" aria-label="世界地图" disabled={busy || listening} onClick={()=>{live.stop();onMap();}}><MapIcon size={18} /></button>
        <button type="button" className="facing-glass facing-icon" aria-label={hidden ? "显示对话" : "隐藏对话"}
          aria-pressed={hidden} onClick={() => { if(!hidden){live.pause();setFullConversation(false);}setHidden(value => !value); followLog.current = true; }}>
          {hidden ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>
        <button type="button" className="facing-glass facing-icon" aria-label={displayedVisual?"恢复背景与立绘":"显示最近的CG图"} aria-pressed={!!displayedVisual} onClick={()=>{if(!(meeting.visual?.replacement||meeting.lastCg?.replacement)||!autoAsset){setError("当前对话还没有生成 CG 图。");return;}void toggleFacingCg(meeting.id,!displayedVisual).then(onMeeting).catch(e=>setError(String(e)));}}><UsersRound size={19}/></button>
        <button type="button" className="facing-glass facing-icon" aria-label="设置" disabled={busy || listening} onClick={()=>{live.stop();onSettings();}}><Settings2 size={19} /></button>
      </div>
    </header>
    {storyConfirm&&facingParticipantIds(meeting).length===1&&<FacingStoryDialog onClose={()=>setStoryConfirm(false)} onConfirm={onStory} />}
    {scenePicker&&<div className="facing-scene-picker" role="dialog" aria-label="更换场景"><h3>更换场景</h3>{onLocation&&<label>关联地图地点<select aria-label="关联地图地点" value={meeting.mapContext?`${meeting.mapContext.atlasId}|${meeting.mapContext.placeId}`:""} onChange={e=>{const [atlasId,placeId]=e.target.value.split("|");void onLocation(atlasId&&placeId?{atlasId,placeId}:undefined).catch(e=>setError(String(e)));}}><option value="">未关联地点</option>{locationOptions?.map(item=><option key={`${item.atlas.id}|${item.place.id}`} value={`${item.atlas.id}|${item.place.id}`}>{item.atlas.name} · {item.path}</option>)}</select></label>}<div className="facing-list">{scenes.map(group=><button type="button" key={group.name} onClick={()=>void onScene(group.name).then(()=>setScenePicker(false)).catch(e=>setError(String(e)))}>{group.name}</button>)}</div>{!scenes.length&&<p>请先在场景素材中添加背景。</p>}{selectedPortrait && <button type="button" disabled={busy || listening} onClick={() => { void onPortraitLayout(speaker.id, selectedPortrait.id, { x: 50, y: 100, scale: 100 }).then(() => setScenePicker(false)).catch(e => setError(String(e))); }}>重置立绘位置</button>}<button type="button" onClick={()=>setScenePicker(false)}>取消</button></div>}
    {!hidden && <div className="facing-room-bottom">
      {multi && !speakerVisual.portrait && !speakerVisual.reference && <div className="facing-speaker-badge facing-glass" aria-label={`当前发言：${speaker.name}`}>
        {speaker.avatar ? <img src={speaker.avatar} alt={speaker.name} /> : <span>{speaker.name.slice(0, 1)}</span>}<small>{speaker.name}</small>
      </div>}
      {(fullConversation || meeting.turns.length > 0 || busy || error || interimText) && <div ref={log} className="facing-room-log" role="log"
        aria-label="对话记录" tabIndex={0} onScroll={event => {
          const area = event.currentTarget;
          followLog.current = area.scrollHeight - area.scrollTop - area.clientHeight < 48;
        }}>
        {messageNodes}
        {interimText&&<div className="facing-glass facing-message" data-role="user"><small>语音识别中</small><p>{interimText}</p></div>}
        {optimisticTurn&&!meeting.turns.some(turn=>turn.id===optimisticTurn.id)&&<FacingMessage turn={optimisticTurn} characterName={character.name} busy onMenu={()=>{}} onVersion={()=>{}}/>}

        {generating && <div className="facing-glass facing-message facing-log-status">{speech.playingId ? "正在说话…" : queuedIds.length ? "准备下一位回应…" : "正在回应…"}</div>}
        {stopped && <div className="facing-glass facing-message facing-log-status" role="status">已停止生成</div>}
        {error && <p className="facing-glass facing-message facing-log-status" role="alert">{error}</p>}
        {!busy && !listening && failedTurn?.role === "user" && <button type="button" className="facing-glass facing-retry"
          onClick={() => retryMessage(failedTurn)}>重试回复</button>}
      </div>}
      <div className="facing-controls facing-glass">
        {live.enabled && <div className="facing-live-voice" data-phase={live.phase}>
          <button type="button" className="facing-live-speak" disabled={live.phase === "transcribing" || live.phase === "replying" || busy || !!speech.playingId || storyConfirm || scenePicker || !!menuId}
            aria-label={live.phase === "paused" ? "继续实时收音" : "说完了，立即发送"}
            onClick={()=>{unlockAudioPlayback();if(live.phase === "paused"){setError("");live.start();}else live.finish();}}>
            <span className="facing-live-mic"><Mic size={26} /></span>
            <span><strong>{liveLabel}</strong><small>{live.transcript || (live.phase === "listening" ? "说完会自动发送，也可点此结束说话" : "自动收音 → 发送 → 回复 → 继续收音")}</small></span>
          </button>
          {live.phase !== "paused" && <button type="button" className="facing-live-pause" aria-label="暂停实时收音" onClick={live.pause}><Pause size={18}/></button>}
        </div>}
        {(touches.length > 0 || photo) && <div className="facing-drafts">
          {touches.map(point => <button type="button" key={point.id} className="facing-touch-chip" aria-label={`移除${point.label}`}
            onClick={() => { touchTap.current = undefined; setTouches(items => items.filter(item => item.id !== point.id)); }}>
            <X size={13} />{point.label}
          </button>)}
          {photo && <div className="facing-photo-draft"><ShownImage file={photo} alt="场景参考图预览" />
            <button type="button" aria-label="移除图片" onClick={() => setPhoto(undefined)}><X size={14} /></button>
            <small>可参考衣服、食物、物件或环境，具体用途由你的文字和当前情境决定。</small></div>}
        </div>}
        <input ref={photoPicker} type="file" accept="image/*" hidden onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) setPhoto(file);
        }} />
        {toolsOpen&&<div className="facing-tools-panel facing-glass" role="group" aria-label="对话功能">
          <button type="button" className="facing-small" disabled={busy||listening||live.enabled} onClick={()=>{setVoiceInput(false);photoPicker.current?.click();setToolsOpen(false);}}><ImagePlus size={20}/>添加参考图</button>
        <button type="button" className="facing-small" aria-label={live.enabled ? "结束实时对话" : "开启实时对话"}
          title={live.enabled ? "结束实时对话" : "开启实时对话"} disabled={!live.enabled && (busy || manualListening || storyConfirm || scenePicker || !!menuId)}
          aria-pressed={live.enabled} onClick={() => {
            if(live.enabled){stopGeneration();live.stop();speech.stop();return;}
            unlockAudioPlayback();speech.stop();setError("");setHidden(false);setVoiceInput(false);live.start();setToolsOpen(false);
          }}>{live.enabled ? <PhoneOff size={18} /> : <Phone size={18} />}{live.enabled?"结束实时对话":"实时对话"}</button>
          <button type="button" className="facing-small" disabled={!ambience?.ready} onClick={()=>ambience?.toggle()}>{ambience?.configured?(ambience.playing?"暂停氛围音":"播放氛围音"):"当前地点未配置氛围音"}{ambience?.location?` · ${ambience.location}`:""}</button>
          {ambience?.error&&<p role="alert">{ambience.error}</p>}
          <button type="button" className="facing-small" onClick={()=>setToolsOpen(false)}>收起</button>
        </div>}
        <form className="facing-composer-row" data-voice={showComposerAction ? undefined : "true"} onSubmit={submit}>
          <button type="button" className="facing-glass facing-icon" aria-label="展开对话功能" aria-expanded={toolsOpen} onClick={()=>setToolsOpen(value=>!value)}><Plus size={20}/></button>
          <div className="facing-input">
            {voiceInput ? useCloudStt
              ? <button type="button" className="facing-hold" disabled={busy || hold.recState === "transcribing"} {...hold.pressHandlers}>
                  {hold.recState === "recording" ? "松开发送" : hold.recState === "transcribing" ? "正在识别…" : "按住说话"}
                </button>
              : <button type="button" className="facing-hold" disabled={busy} onClick={toggleSpeechRecognition}>
                  {browserListening ? "说完了" : "开始说话"}
                </button>
              : <input value={draft} disabled={live.enabled} onChange={event => setDraft(event.target.value)} placeholder={live.enabled ? "结束实时对话后可打字" : "和他说句话…"} aria-label="对话内容" maxLength={4000} />}
            <button type="button" className="facing-input-mic" disabled={listening || live.enabled}
              aria-label={voiceInput ? "切换文字输入" : "切换语音输入"} onClick={() => {
                if (!cloudAvailable && !browserAvailable) { setError("当前浏览器无法直接识别语音。可以配置云端语音识别，或使用文字输入。"); return; }
                setVoiceInput(!voiceInput);
                setError("");
              }}>{voiceInput ? <Keyboard size={14} /> : <Mic size={14} />}</button>
          </div>
          {showComposerAction && <button type={generating ? "button" : "submit"} className="facing-glass facing-icon facing-send"
            aria-label={generating ? "停止生成" : "发送"} onClick={generating ? stopGeneration : undefined}
            disabled={!generating && (busy || live.enabled || (!draft.trim() && !photo && !touches.length))}>
            {generating ? <Square size={13} fill="currentColor" aria-hidden="true" /> : <ArrowUp size={19} />}
          </button>}
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
          {messageDialog==="edit"&&!!selectedMessage.segments?.length&&<p>{selectedMessage.dialogueNotation === "quoted" ? "按展示顺序编辑：中文双引号内为台词，引号外为动作描述。" : "按展示顺序编辑：括号内为动作，括号外为台词。"}</p>}
          {messageDialog !== "delete" && <textarea className="facing-message-editor" aria-label={messageDialog === "edit" ? "消息内容" : "重试指令"}
            value={messageDraft} rows={4} maxLength={14000} onChange={event => {setMessageDraft(event.target.value);setError("");}} />}
          {messageDialog === "edit" && error && <p className="facing-error" role="alert">{error}</p>}
          {messageDialog === "edit" && selectedMessage.role === "assistant" && !selectedMessage.segments?.length && <textarea className="facing-message-editor" aria-label="动作描述"
            placeholder="（动作描述）" value={actionDraft} rows={2} maxLength={2000} onChange={event => setActionDraft(event.target.value)} />}
          <button type="button" className="facing-primary" onClick={applyMessageDialog}
            disabled={messageDialog === "instruction" && !messageDraft.trim()}>{messageDialog === "delete" ? "确认删除" : messageDialog === "edit" ? "保存" : "重新生成"}</button>
        </> : <div className="facing-list">
          <button type="button" onClick={() => { closeMenu(); retryMessage(selectedMessage); }}>重试</button>
          <button type="button" onClick={() => { setMessageDraft(selectedMessage.segments?.length?facingVisibleSegments(selectedMessage).map(part=>facingSegmentText(part,selectedMessage.dialogueNotation)).join("\n"):selectedMessage.text); setActionDraft(selectedMessage.action ?? ""); setMessageDialog("edit"); }}>编辑</button>
          <button type="button" onClick={() => { setMessageDraft(""); setMessageDialog("instruction"); }}>指令重试</button>
          <button type="button" className="facing-delete" onClick={() => setMessageDialog("delete")}>删除</button>
        </div>}
      </section>
    </div>}
  </section>;
}
