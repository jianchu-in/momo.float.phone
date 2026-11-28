"use client";
import { useRef, useState } from "react";
import { reverseScope } from "@/lib/reverse-phone-storage";
import { useReversePhone } from "./use-reverse-phone";
import "@/styles/reverse-phone.css";

/** Keep the invitation and the actual answer in the private chat, before opening the shared phone. */
export function ReversePhoneInvitation({ characterId, chatSessionId, resumeSessionId, onAccepted, onClose }: {
  characterId: string; chatSessionId: string; resumeSessionId?: string; onAccepted: (sessionId: string) => void; onClose: () => void;
}) {
  const [scope] = useState(reverseScope), host = useRef<HTMLDivElement>(null);
  const run = useReversePhone(scope, host, characterId, chatSessionId, resumeSessionId, { invitationOnly: true, onAccepted });
  const declined = run.session?.accepted === false;
  return <div ref={host} className="rp-invitation-status" role="status" aria-live="polite">
    <span>{run.error || (declined ? "角色暂未同意共享屏幕" : run.session?.accepted ? "已收到同意回复，正在进入共享屏幕…" : "已邀请，等待角色回复是否同意共享屏幕…")}</span>
    {run.error && <button onClick={() => void run.execute()}>重试邀请</button>}
    <button onClick={() => { void run.stop().finally(onClose); }}>{declined ? "关闭" : "取消"}</button>
  </div>;
}
