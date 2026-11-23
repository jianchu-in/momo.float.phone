"use client";
import { useState } from "react";
import { loadReverseSessions } from "@/lib/reverse-phone-storage";
import { REVERSE_APPS, type ReverseScope } from "@/lib/reverse-phone-types";
export function ReversePhoneHistory({scope,initialCharacterId,onReplay,onResume,onClose}:{scope:ReverseScope;initialCharacterId?:string;onReplay:(id:string)=>void;onResume:(id:string)=>void;onClose:()=>void}) {
  const [character,setCharacter]=useState(initialCharacterId??"");
  const records=loadReverseSessions(scope),people=[...new Map(records.map(record=>[record.characterId,record.characterName])).entries()];
  return <section className="rp-panel"><header className="rp-header"><button onClick={onClose}>返回</button><h2>查岗记录</h2><span/></header><main className="rp-scroll">
    <label>筛选角色<select aria-label="查岗记录角色" value={character} onChange={e=>setCharacter(e.target.value)}><option value="">全部角色</option>{people.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    {!records.some(r=>!character||r.characterId===character)&&<p className="rp-empty">还没有查岗记录</p>}
    {records.filter(r=>!character||r.characterId===character).map(record=><details className="rp-card" key={record.id}><summary>{record.characterName} · {new Date(record.createdAt).toLocaleString("zh-CN")}<small>{record.origin==="stealth"?"偷偷查岗":record.origin==="dialogue"?"对话触发":"手动邀请"} · {({running:"已暂停，可继续",paused:"已暂停，可继续",stopped:"已结束",completed:"已完成"})[record.status]}</small></summary><p>{record.tasks.filter(task=>task.kind==="app"&&task.state==="done"&&task.app).map(task=>REVERSE_APPS[task.app!]).join("、")||"尚未完成应用查看"}</p>{record.events.map(e=><p key={e.id}>{e.text}</p>)}<button onClick={()=>onReplay(record.id)}>回放这次查岗</button>{["running","paused"].includes(record.status)&&<button onClick={()=>onResume(record.id)}>恢复这次查岗</button>}</details>)}
  </main></section>;
}
