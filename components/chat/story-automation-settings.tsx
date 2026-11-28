"use client";
import "@/styles/reverse-phone.css";
import { useState } from "react";
import { resolveStoryAutomation, type StoryAutomation } from "@/lib/chat-automation";
import { loadChatAppSettings, type ChatSession } from "@/lib/chat-storage";

export function StoryAutomationSettings({session,onChange,onClose}:{session?:ChatSession;onChange:(value:Partial<StoryAutomation>|undefined)=>void;onClose:()=>void}) {
  const initial=session?.storyAutomation??(!session?loadChatAppSettings().storyAutomation:undefined);
  const [value,setValue]=useState<Partial<StoryAutomation>>(initial??{});
  const effective=resolveStoryAutomation(session?{...session,storyAutomation:value}:undefined);
  const global=loadChatAppSettings().storyAutomation;
  const display=session?effective:{...effective,...value};
  const change=(patch:Partial<StoryAutomation>)=>{const next={...value,...patch};setValue(next);onChange(next);};
  return <section className="rp-panel rp-settings" aria-label="自动进入剧情设置"><header className="rp-header"><button onClick={onClose}>返回</button><h2>自动进入剧情</h2></header><main className="rp-scroll">
    <p>目标：剧情 APP。角色专属设置优先，未修改的项目继承全局。</p>
    {([ ["proactive","允许角色主动带入剧情"], ["arrival","检测已见面后自动进入"] ] as const).map(([key,title])=><label className="rp-setting" key={key}><span>{title}</span>{session?<select aria-label={title} value={value[key]===undefined?"inherit":String(value[key])} onChange={e=>{if(e.target.value==="inherit"){const next={...value};delete next[key];setValue(next);onChange(next);}else change({[key]:e.target.value==="true"});}}><option value="inherit">跟随全局（{key==="proactive"&&session.allowForcedOfflineStory!==undefined?session.allowForcedOfflineStory?"开启":"关闭":global?.[key]?"开启":"关闭"}）</option><option value="true">开启</option><option value="false">关闭</option></select>:<input aria-label={title} type="checkbox" checked={display[key]} onChange={e=>change({[key]:e.target.checked})}/>}</label>)}
    <label>触发强度<select aria-label="剧情触发强度" value={session&&value.intensity===undefined?"inherit":display.intensity} onChange={e=>{if(e.target.value==="inherit"){const next={...value};delete next.intensity;setValue(next);onChange(next);}else change({intensity:e.target.value as StoryAutomation["intensity"]});}}>{session&&<option value="inherit">跟随全局</option>}<option value="low">低 · 明确确认后进入</option><option value="medium">中 · 自然识别与推进</option><option value="high">高 · 更积极主动</option></select></label>
    <p className="rp-muted">结合最近对话判断人物、地点和时间。仅出发、未来计划、回忆或他人到达不算已见面；判断随正常回复完成，不额外请求检测接口。</p><p className="rp-muted">进入前显示提示，可取消本次。同一次见面只自动进入一次；暂时返回私聊不会反复跳转。明确离开现场后才能触发下一次见面。</p>
    {session&&<button onClick={()=>{setValue({});onChange(undefined);}}>全部恢复跟随全局</button>}
  </main></section>;
}
