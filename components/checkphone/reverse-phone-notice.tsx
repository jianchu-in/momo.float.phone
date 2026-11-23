"use client";
import { useEffect, useRef, useState } from "react";
import { CHAT_SCOPE_UPDATED_EVENT } from "@/lib/chat-scope-storage";
import { acknowledgeReverseNotices, assertReverseScope, pendingStealthNotices, reverseScope } from "@/lib/reverse-phone-storage";
import type { ReverseSession } from "@/lib/reverse-phone-types";
import { ReversePhoneLayer } from "./reverse-phone-layer";
import { useReverseRecords } from "./use-reverse-records";

function NoticeDialog({ records, busy, error, onAction }: { records: ReverseSession[]; busy: boolean; error: string; onAction: (view: boolean) => void }) {
  const panel = useRef<HTMLElement>(null), record = records[0];
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>("button:last-child")?.focus();
    return () => { if(previous?.isConnected)previous.focus(); };
  }, []);
  return <div className="rp-notice-overlay" onClick={event => { if(event.target===event.currentTarget&&!busy)onAction(false); }} onKeyDown={event => {
    if(event.key==="Escape"&&!busy){event.stopPropagation();onAction(false);}
    if(event.key==="Tab"){
      const buttons=[...panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")??[]];
      if(!buttons.length){event.preventDefault();return;}
      if(event.shiftKey&&document.activeElement===buttons[0]){event.preventDefault();buttons.at(-1)?.focus();}
      else if(!event.shiftKey&&document.activeElement===buttons.at(-1)){event.preventDefault();buttons[0].focus();}
    }
  }}>
    <section ref={panel} className="rp-notice-dialog" role="dialog" aria-modal="true" aria-label="偷偷查岗提醒">
      <span className="rp-avatar">{record.characterAvatar?<img src={record.characterAvatar} alt=""/>:record.characterName.slice(0,1)}</span>
      <h2>有人偷偷来看过你的手机</h2>
      <p>{record.characterName} 在 <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString("zh-CN")}</time> 偷偷查看了你的手机哦。</p>
      {records.length>1&&<p className="rp-muted">有 {records.length} 条新的查岗记录，先查看最近一次，其他记录可在查岗记录里查看。</p>}
      {record.status!=="completed"&&<p className="rp-muted">这次查岗未全部完成，可以查看已经发生的过程。</p>}
      {error&&<p role="alert">{error}</p>}
      <div className="rp-notice-actions"><button type="button" className="rp-primary" disabled={busy} onClick={()=>onAction(true)}>点击查看</button><button type="button" disabled={busy} onClick={()=>onAction(false)}>返回</button></div>
    </section>
  </div>;
}

export function ReversePhoneNotice({ characterId, blocked, onView }: { characterId: string; blocked?: boolean; onView: (id: string) => void }) {
  const [scope,setScope] = useState(reverseScope), records = useReverseRecords(scope);
  const [visible,setVisible]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const alive=useRef(true),working=useRef(false);
  useEffect(()=>{
    alive.current=true;
    const change=()=>setVisible(!document.hidden);change();
    const changeScope=()=>setScope(reverseScope());
    document.addEventListener("visibilitychange",change);window.addEventListener("pageshow",change);window.addEventListener(CHAT_SCOPE_UPDATED_EVENT,changeScope);
    return()=>{alive.current=false;document.removeEventListener("visibilitychange",change);window.removeEventListener("pageshow",change);window.removeEventListener(CHAT_SCOPE_UPDATED_EVENT,changeScope);};
  },[]);
  const pending=pendingStealthNotices(records,characterId);
  async function act(view:boolean){
    if(working.current||!pending.length)return;
    working.current=true;setBusy(true);setError("");
    try{
      await acknowledgeReverseNotices(pending);
      assertReverseScope(scope);
      if(alive.current&&view)onView(pending[0].id);
    }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:"提醒状态保存失败，请重试。");}
    finally{working.current=false;if(alive.current)setBusy(false);}
  }
  if(blocked||!visible||!pending.length)return null;
  return <ReversePhoneLayer overlay><NoticeDialog records={pending} busy={busy} error={error} onAction={view=>void act(view)}/></ReversePhoneLayer>;
}
