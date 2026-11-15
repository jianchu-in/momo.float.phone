"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type PointerEvent } from "react";
import { Ellipsis, FileText, MessagesSquare, SlidersHorizontal, X } from "lucide-react";
import { DebugPromptPanel } from "@/components/debug-prompt-panel";
import { QuickActionFloat } from "@/components/quick-action-float";
import { RoleplayDiscussionDialog } from "@/components/roleplay-discussion-dialog";
import { CHAT_APP_SETTINGS_UPDATED_EVENT, loadChatAppSettings } from "@/lib/chat-storage";
import { kvGet, kvSet } from "@/lib/kv-db";
import { getMascotContext, subscribeMascotContext, type MascotPageContext } from "@/lib/mascot-context";
import { OPEN_FLOATING_TOOL } from "@/lib/roleplay-discussion";

const BALL_SIZE = 48;
const EDGE_GAP = 12;
const TOP_GAP = 50;

type BallPosition = { x: number; y: number };

function clampRatio(value: number) {
  return Math.min(1, Math.max(0, value));
}

function loadBallPosition(key: string): BallPosition | null {
  try {
    const raw: unknown = JSON.parse(kvGet(key) || "null");
    if (raw && typeof raw === "object" && "x" in raw && "y" in raw &&
      typeof raw.x === "number" && typeof raw.y === "number" && Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
      return { x: clampRatio(raw.x), y: clampRatio(raw.y) };
    }
  } catch {
    // Use the standard position if an old saved position cannot be read.
  }
  return null;
}

function useBallDrag(key: string, onActivate: () => void, onDragStart?: () => void) {
  const [position, setPosition] = useState(() => loadBallPosition(key));
  const gesture = useRef<{
    id: number; startX: number; startY: number; left: number; top: number;
    scaleX: number; scaleY: number; maxX: number; maxY: number; position: BallPosition | null;
  } | null>(null);
  const suppressClick = useRef(false);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    const ball = event.currentTarget.parentElement;
    const parent = ball?.offsetParent;
    if (!ball || !(parent instanceof HTMLElement)) return;
    const rect = parent.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    event.stopPropagation();
    suppressClick.current = false;
    gesture.current = {
      id: event.pointerId, startX: event.clientX, startY: event.clientY, left: ball.offsetLeft, top: ball.offsetTop,
      scaleX: parent.clientWidth / rect.width, scaleY: parent.clientHeight / rect.height,
      maxX: Math.max(1, parent.clientWidth - BALL_SIZE - EDGE_GAP * 2),
      maxY: Math.max(1, parent.clientHeight - BALL_SIZE - EDGE_GAP - TOP_GAP),
      position: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.position) {
      if (Math.hypot(dx, dy) < 5) return;
      onDragStart?.();
    }
    drag.position = {
      x: clampRatio((drag.left + dx * drag.scaleX - EDGE_GAP) / drag.maxX),
      y: clampRatio((drag.top + dy * drag.scaleY - TOP_GAP) / drag.maxY),
    };
    setPosition(drag.position);
  }

  function onPointerEnd(event: PointerEvent<HTMLButtonElement>) {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    gesture.current = null;
    if (drag.position) {
      suppressClick.current = true;
      kvSet(key, JSON.stringify(drag.position));
    } else if (event.type === "pointerup" && event.pointerType === "touch") {
      // A touch released under pointer capture may end without a native click.
      event.stopPropagation();
      suppressClick.current = true;
      onActivate();
    }
  }

  function onClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!suppressClick.current || event.detail === 0) onActivate();
    suppressClick.current = false;
  }

  return {
    style: position ? {
      left: `calc(${position.x * 100}% + ${EDGE_GAP - position.x * (BALL_SIZE + EDGE_GAP * 2)}px)`,
      top: `calc(${position.y * 100}% + ${TOP_GAP - position.y * (BALL_SIZE + EDGE_GAP + TOP_GAP)}px)`,
      right: "auto",
    } : undefined,
    onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd,
    onLostPointerCapture: onPointerEnd, onClick,
  };
}

const floatItems = [
  { id: "prompt-viewer", label: "提示词查看器", Icon: FileText, offset: [82, 0] },
  { id: "quick-action", label: "快捷操作", Icon: SlidersHorizontal, offset: [58, 58] },
  { id: "discussion", label: "破壁聊天", Icon: MessagesSquare, offset: [0, 82] },
] as const;

export function FloatingTools() {
  const [settings, setSettings] = useState(loadChatAppSettings);
  const [expanded, setExpanded] = useState<{ x: number; y: number } | null>(null);
  const [discussion, setDiscussion] = useState<MascotPageContext | null>(null);
  const context = useSyncExternalStore(subscribeMascotContext, getMascotContext, getMascotContext);
  const fan = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const { style: radialStyle, ...radialDrag } = useBallDrag("ai_phone_combined_ball_position_v1", toggleRadial, () => setExpanded(null));
  const { style: discussionStyle, ...discussionDrag } = useBallDrag("ai_phone_discussion_ball_position_v1", () => setDiscussion(context));

  useEffect(() => {
    const sync = () => {
      const current = loadChatAppSettings();
      setSettings(current);
      if (!current.combinedFloatingTools) setExpanded(null);
      if (!current.roleplayDiscussionEnabled) setDiscussion(null);
    };
    window.addEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, sync);
    return () => window.removeEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (!fan.current?.contains(event.target as Node)) setExpanded(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(null); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [expanded]);

  function toggleRadial() {
    const ball = fan.current;
    const parent = ball?.offsetParent;
    if (expanded || !ball || !(parent instanceof HTMLElement)) {
      setExpanded(null);
      return;
    }
    setExpanded({
      x: ball.offsetLeft + BALL_SIZE / 2 < parent.clientWidth / 2 ? 1 : -1,
      y: ball.offsetTop + BALL_SIZE / 2 < parent.clientHeight / 2 ? 1 : -1,
    });
  }

  function closeDiscussion() {
    setDiscussion(null);
    window.requestAnimationFrame(() => launcher.current?.focus());
  }

  const enabled = [settings.promptViewerEnabled, settings.quickActionEnabled, settings.roleplayDiscussionEnabled];
  const combined = settings.combinedFloatingTools === true;
  return <>
    <DebugPromptPanel combined={combined} />
    <QuickActionFloat combined={combined} />
    {combined && enabled.some(Boolean) && !discussion && <div className="phone-tools-anchor phone-tools-radial" ref={fan} style={radialStyle}>
      {expanded && floatItems.map(({ id, label, Icon, offset }, index) => enabled[index] && <button type="button"
        className="phone-tools-satellite" key={id} aria-label={label} title={label}
        style={{ transform: `translate(${offset[0] * expanded.x}px, ${offset[1] * expanded.y}px)` }} onClick={() => {
          setExpanded(null);
          if (id === "discussion") setDiscussion(context);
          else window.dispatchEvent(new CustomEvent(OPEN_FLOATING_TOOL, { detail: id }));
        }}><Icon size={20} /></button>)}
      <button ref={launcher} type="button" className="phone-tools-drag-handle" aria-label="三合一悬浮球" aria-expanded={!!expanded} {...radialDrag}>
        {expanded ? <X size={21} /> : <Ellipsis size={25} />}
      </button>
    </div>}
    {!combined && settings.roleplayDiscussionEnabled && !discussion && <div className="phone-tools-anchor" style={discussionStyle}>
      <button ref={launcher} type="button" className="phone-tools-drag-handle" aria-label="打开破壁聊天" {...discussionDrag}>
        <MessagesSquare size={21} />
      </button>
    </div>}
    {discussion && <RoleplayDiscussionDialog context={discussion} onClose={closeDiscussion} />}
  </>;
}
