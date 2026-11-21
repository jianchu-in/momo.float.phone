"use client";

import { useState } from "react";
import { findChatSessionById, loadChatSessions, saveChatSessions, type ChatSession } from "@/lib/chat-storage";

export function VideoCallActionToggle({ session }: { session: ChatSession }) {
  const [enabled, setEnabled] = useState(() => (findChatSessionById(session.id) ?? session).videoCallActions === true);

  function toggle() {
    const next = !enabled;
    saveChatSessions(loadChatSessions().map(item => item.id === session.id ? { ...item, videoCallActions: next } : item));
    setEnabled(next);
  }

  return <button type="button" className="videocall-actions-toggle" role="switch" aria-label="动作描述"
    aria-checked={enabled} onClick={toggle}>动作描述 <span aria-hidden="true">{enabled ? "开" : "关"}</span></button>;
}
