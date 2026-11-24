"use client";
import { useEffect, useRef, useState } from "react";
import { hydrateKvDb } from "@/lib/kv-db";
import { hydrateChatStorage, loadChatSessions, loadChatMessages, pushChatMessage } from "@/lib/chat-storage";
import { chatDb } from "@/lib/chat-db";
import { hydrateSettingsDb } from "@/lib/settings-db";
import { loadCharacters } from "@/lib/character-storage";
import { CHAT_SCOPE_UPDATED_EVENT } from "@/lib/chat-scope-storage";
import { bgSetInterval } from "@/lib/bg-timer";
import { claimStealthReverse, resolveReverseAutomation, reversePhoneBusy, REVERSE_SETTINGS_EVENT } from "@/lib/reverse-phone-automation";
import { loadReverseSession, reverseScope, saveReverseSession } from "@/lib/reverse-phone-storage";
import type { ReverseSession } from "@/lib/reverse-phone-types";
import { ReversePhoneApp } from "./reverse-phone-app";

export function ReversePhoneAutomation() {
  const [record,setRecord]=useState<ReverseSession|null>(null),busy=useRef(false),alive=useRef(true);
  useEffect(()=>{
    alive.current=true;let ready=false,checking=false,disposed=false;
    const check=async()=>{
      if(disposed||!ready||checking||busy.current)return;
      checking=true;
      try {
        const scope=reverseScope();if(reversePhoneBusy(scope))return;
        const sessions=loadChatSessions().filter(s=>!s.isGroup&&!s.isBlacklisted&&(s.chatAccountId??null)===scope.chatAccountId);
        for(const character of loadCharacters()) {
          if(disposed||!alive.current||busy.current)return;
          const session=sessions.find(s=>s.contactId===character.id);
          if(!session||!resolveReverseAutomation(character.id,scope).stealth)continue;
          const claimed=await claimStealthReverse(character,scope);
          if(!claimed)continue;
          const next={...claimed,inviteSessionId:session.id};await saveReverseSession(next);
          if(disposed||!alive.current)return;
          busy.current=true;setRecord(next);break;
        }
      } catch(error) { console.warn("自主查岗计划检查失败",error); }
      finally{checking=false;}
    };
    void Promise.all([hydrateKvDb(),hydrateSettingsDb(),hydrateChatStorage()]).then(()=>{ready=true;if(!disposed&&alive.current)void check();});
    const poll=()=>void check(),visible=()=>{if(document.visibilityState==="visible")poll();};
    const reset=()=>{setRecord(null);busy.current=false;poll();};
    const cancel=bgSetInterval(poll,60000);
    window.addEventListener(REVERSE_SETTINGS_EVENT,poll);window.addEventListener("pageshow",poll);window.addEventListener(CHAT_SCOPE_UPDATED_EVENT,reset);document.addEventListener("visibilitychange",visible);
    return()=>{disposed=true;alive.current=false;cancel();window.removeEventListener(REVERSE_SETTINGS_EVENT,poll);window.removeEventListener("pageshow",poll);window.removeEventListener(CHAT_SCOPE_UPDATED_EVENT,reset);document.removeEventListener("visibilitychange",visible);};
  },[]);
  async function finished(value:ReverseSession) {
    try {
      const saved=loadReverseSession(value.id, false)??value;
      const target=loadChatSessions().find(s=>s.id===saved.inviteSessionId);
      if(target&&!loadChatMessages(target.id).some(m=>m.mediaData?.reversePhoneOperationId===saved.id+":notice")) {
        const message=pushChatMessage({role:"assistant",sessionId:target.id,senderName:saved.characterName,content:"查岗记录",mediaType:"app_card",mediaData:{appId:"reverse-phone",appName:"查岗记录",appCardTitle:"偷偷查岗记录",appCardBody:saved.status==="completed"?"已完成 · 点击回放":"已暂停 · 点击查看已发生的过程",appSceneId:saved.id,reversePhoneOperationId:saved.id+":notice"}});
        await chatDb.messages.put(message);
        window.dispatchEvent(new CustomEvent("chat-messages-updated",{detail:{sessionId:target.id}}));
      }
    } finally { if(alive.current){setRecord(null);busy.current=false;} }
  }
  // Keep real page dimensions for the existing visible-page extraction and click simulator.
  // The runner is outside the user's viewport and cannot receive pointer or keyboard input.
  return record?<div aria-hidden inert style={{position:"fixed",left:-20000,top:0,width:390,height:780,pointerEvents:"none",overflow:"hidden"}}><ReversePhoneApp key={record.id} initialCharacterId={record.characterId} resumeSessionId={record.id} autoContinue background onFinished={value=>void finished(value)} onClose={()=>{setRecord(null);busy.current=false;}}/></div>:null;
}
