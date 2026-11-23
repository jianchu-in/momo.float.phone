import { isIOSDevice } from "@/components/chat/voice-input-platform";
import { createSTTSession, isBrowserSpeechRecognitionSupported, type STTCallbacks, type STTSession } from "./stt-service";
import { isCallRecordingSupported, resolveCloudSttConfig, transcribeAudioBlob } from "./stt-cloud";

type VoiceCallbacks = STTCallbacks & { onTranscribing: () => void };
type AudioContextConstructor = new () => AudioContext;
function audioContextConstructor(): AudioContextConstructor | undefined {
  return typeof window === "undefined" ? undefined : window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
}

/** One utterance: release the microphone before transcription and character playback. */
export function createFacingVoiceSession(callbacks: VoiceCallbacks, characterId: string, preferBrowser: boolean): STTSession {
  const cloud = resolveCloudSttConfig(characterId);
  const browser = isBrowserSpeechRecognitionSupported();
  const Context = audioContextConstructor();
  if (browser && (preferBrowser || isIOSDevice() || !cloud || !isCallRecordingSupported() || !Context)) return createSTTSession(callbacks);
  if (!cloud || !isCallRecordingSupported() || !Context) return {
    isSupported: false, start: () => callbacks.onError("实时对话需要浏览器语音识别，或配置云端语音识别并允许麦克风。"), stop() {}, abort() {},
  };

  let stream: MediaStream | undefined, recorder: MediaRecorder | undefined, context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined, analyser: AnalyserNode | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let active = true, started = false, finishing = false, heard = false, speechMs = 0;
  const chunks: Blob[] = [], request = new AbortController();
  function release() {
    clearInterval(timer);
    stream?.getTracks().forEach(track => track.stop());
    source?.disconnect(); analyser?.disconnect();
    void context?.close().catch(() => {});
  }
  function fail(cause: unknown) {
    if (!active) return;
    active = false; release();
    if (recorder?.state === "recording") recorder.stop();
    callbacks.onError(cause instanceof Error && cause.name === "NotAllowedError" ? "麦克风权限被拒绝，请在浏览器或应用设置中允许录音后重试。"
      : cause instanceof Error ? cause.message : "无法开始实时收音，请检查麦克风权限。");
  }
  function finish() {
    if (!active || finishing || !recorder) return;
    finishing = true;
    clearInterval(timer);
    try { recorder.stop(); } catch (cause) { fail(cause); }
    // Stop tracks immediately, including when the recorder's final data event is delayed.
    release();
  }
  return {
    isSupported: true,
    start() {
      if (started || !active) return;
      started = true;
      // Construct/resume synchronously within the initial user gesture (mobile browsers).
      context = new Context();
      const resumed = context.resume();
      void (async () => {
        await resumed;
        if (!active) return;
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (!active) { release(); return; }
        source = context!.createMediaStreamSource(stream);
        analyser = context!.createAnalyser(); analyser.fftSize = 1024;
        source.connect(analyser);
        const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
        recorder = mime ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32_000 }) : new MediaRecorder(stream);
        recorder.ondataavailable = event => { if (active && event.data.size) chunks.push(event.data); };
        recorder.onerror = () => fail(new Error("录音失败，请重新开启实时对话。"));
        recorder.onstop = () => {
          release();
          if (!active) return;
          if (!heard) { active = false; callbacks.onNoSpeech(); return; }
          const blob = new Blob(chunks, { type: recorder!.mimeType || "audio/webm" });
          if (!blob.size) { fail(new Error("没有录到声音，请重新说一次。")); return; }
          callbacks.onTranscribing();
          void transcribeAudioBlob(blob, cloud, request.signal).then(text => {
            if (!active) return;
            active = false;
            if (text.trim()) callbacks.onFinal(text.trim()); else callbacks.onNoSpeech();
          }).catch(fail);
        };
        recorder.start();
        const samples = new Uint8Array(analyser.fftSize), began = Date.now();
        let lastVoice = began;
        timer = setInterval(() => {
          if (!active || finishing) return;
          analyser!.getByteTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
          const now = Date.now();
          if (rms > .018) { speechMs += 80; lastVoice = now; if (speechMs >= 240) heard = true; }
          else if (!heard) speechMs = 0;
          if ((heard && now - lastVoice >= 1300) || (!heard && now - began >= 15_000) || now - began >= 60_000) finish();
        }, 80);
      })().catch(fail);
    },
    stop: finish,
    abort() {
      active = false; request.abort(); release();
      if (recorder?.state === "recording") recorder.stop();
    },
  };
}
