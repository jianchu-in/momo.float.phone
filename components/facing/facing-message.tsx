"use client";
import {facingSegmentText,facingVisibleSegments} from "@/lib/facing-reply-format";
import { formatChatUiTime } from "@/lib/chat-time";

import { memo, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Volume2, Square } from "lucide-react";
import { ShownImage } from "@/components/ui/shown-image";
import type { FacingTurn } from "@/lib/facing-storage";

export const FacingMessage = memo(function FacingMessage({ turn, characterName, busy, onMenu, onVersion, playing, onReplay }: {
  playing?: boolean; onReplay?: () => void;
  turn: FacingTurn; characterName: string; busy: boolean; onMenu: () => void; onVersion: (index: number) => void;
}) {
  const press = useRef<{ x: number; y: number; timer: number } | undefined>(undefined);
  function stopPress() {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = undefined;
  }
  useEffect(() => () => stopPress(), []);
  const count = turn.versions?.length ?? 0;
  const version = turn.versionIndex ?? 0;
  return <article className="facing-glass facing-message" data-role={turn.role} tabIndex={0}
    onContextMenu={event => { event.preventDefault(); stopPress(); if (!busy) onMenu(); }}
    onKeyDown={event => { if (!busy && event.target === event.currentTarget && ["Enter", "ContextMenu"].includes(event.key)) { event.preventDefault(); onMenu(); } }}
    onPointerDown={event => {
      if (busy || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
      stopPress();
      press.current = { x: event.clientX, y: event.clientY, timer: window.setTimeout(() => { stopPress(); onMenu(); }, 480) };
    }}
    onPointerMove={event => {
      if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) stopPress();
    }} onPointerUp={stopPress} onPointerCancel={stopPress} onPointerLeave={stopPress}>
    <small>{turn.role === "assistant" ? characterName : "你"}{turn.kind === "voice" ? " · 语音转写" : ""}</small>
    {turn.imageRef && <ShownImage className="facing-message-photo" mediaRef={turn.imageRef} />}
    {!!turn.touches?.length && <p className="facing-action">{turn.touches.map(part => `（触碰了${part}）`).join(" ")}</p>}
    {facingVisibleSegments(turn).map((part,index)=><p key={index} className={part.type==="action"?"facing-action":undefined}>{turn.kind==="touch"&&!turn.touches?.length&&part.type==="dialogue"?`（触碰了${part.text}）`:facingSegmentText(part,turn.role==="assistant"?turn.dialogueNotation:undefined)}</p>)}
    {!turn.action && !turn.text && !turn.imageRef && !turn.touches?.length &&
      <p className="facing-action">{turn.reactionName ? `（${turn.reactionName}）` : `来到${turn.sceneName}`}</p>}
    <time className="facing-message-time" dateTime={turn.at}>{formatChatUiTime(turn.at)}</time>
    {turn.role === "assistant" && <div className="facing-audio-nav"><button type="button" aria-label={playing ? "停止播放语音" : "回放语音"}
      title={turn.audioRef ? "播放已保存的语音" : "本条未保存语音"} disabled={!turn.audioRef || busy} onClick={onReplay}>
      {playing ? <Square size={13} /> : <Volume2 size={15} />}
    </button></div>}
    {count > 1 && <div className="facing-version-nav" aria-label="回复版本">
      <button type="button" aria-label="上一版回复" disabled={busy || version === 0} onClick={() => onVersion(version - 1)}><ChevronLeft size={15} /></button>
      <span>{version + 1} / {count}</span>
      <button type="button" aria-label="下一版回复" disabled={busy || version >= count - 1} onClick={() => onVersion(version + 1)}><ChevronRight size={15} /></button>
    </div>}
  </article>;
});
