"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { markReverseRecordViewed, reverseRecordRevision } from "@/lib/reverse-phone-storage";
import { throwIfAborted } from "@/lib/abort-utils";
import DOMPurify from "dompurify";
import type { ReverseSession } from "@/lib/reverse-phone-types";

export function sanitizeReverseFrame(html:string) {
  return DOMPurify.sanitize(html,{FORBID_TAGS:["script","iframe","object","embed","audio","video","link","style","form"],FORBID_ATTR:["srcdoc","autoplay"]});
}
const frozenMedia=new Map<string,{promise:Promise<string>;size:number}>();
function trimFrozenMedia() { while (frozenMedia.size > 16 || [...frozenMedia.values()].reduce((sum,item)=>sum+item.size,0) > 8*1024*1024) frozenMedia.delete(frozenMedia.keys().next().value!); }
/** Blob URLs expire on reload; embed only local blob media into the recorded snapshot. */
export async function freezeReverseFrame(html:string, signal?:AbortSignal) {
  throwIfAborted(signal);
  let result=sanitizeReverseFrame(html);
  for(const url of new Set(result.match(/blob:[^"'()\s<>;]+/g)??[])) {
    if(!frozenMedia.has(url)) {
      const entry={promise:Promise.resolve(""),size:0};
      entry.promise=fetch(url).then(response=>response.blob()).then(blob=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob);})).catch(()=>"").then(data=>{entry.size=data.length*2;trimFrozenMedia();return data;});
      frozenMedia.set(url,entry);trimFrozenMedia();
      const data=await entry.promise;throwIfAborted(signal);result=result.split(url).join(data);
    } else { const data=await frozenMedia.get(url)!.promise;throwIfAborted(signal);result=result.split(url).join(data); }
  }
  return result;
}
export function ReversePhoneReplay({record,onClose}:{record:ReverseSession;onClose:()=>void}) {
  const [readError,setReadError]=useState("");
  const revision=reverseRecordRevision(record);
  useEffect(()=>{let live=true;void markReverseRecordViewed(record).catch(()=>{if(live)setReadError("已读状态保存失败，回放不受影响。");});return()=>{live=false;};},[record.id,revision]);
  const [index,setIndex]=useState(0),[playing,setPlaying]=useState(true),[speed,setSpeed]=useState(1);
  const host=useRef<HTMLDivElement>(null),frames=record.replay??[],frame=frames[index];
  const html=frames.slice(0,index+1).reverse().find(entry=>entry.html)?.html??"";
  const cleanHtml=useMemo(()=>sanitizeReverseFrame(html),[html]);
  useEffect(()=>{if(!playing||index>=frames.length-1)return;const wait=Math.max(250,Math.min(6000,(frames[index+1].at-frame.at)/speed));const timer=setTimeout(()=>setIndex(i=>i+1),wait);return()=>clearTimeout(timer);},[index,playing,speed,frames,frame]);
  useEffect(()=>{host.current?.querySelectorAll<HTMLElement>('[data-rp-scroll-top]').forEach(el=>{el.scrollTop=Number(el.dataset.rpScrollTop)||0;});},[frame]);
  return <section className="rp-app" aria-label="查岗历史回放"><header className="rp-top"><button onClick={onClose}>返回</button><strong>历史回放 · {record.characterName}</strong><small>{new Date(record.createdAt).toLocaleString("zh-CN")}</small></header>
    {frame?<div className="rp-stage"><div ref={host} className="rp-phone-content" inert dangerouslySetInnerHTML={{__html:cleanHtml}}/>{frame.touch?.visible&&<span className={`rp-touch ${frame.touch.pressed?"is-pressed":""}`} style={{transform:`translate(${frame.touch.x-14}px,${frame.touch.y-14}px)`}}/>}{(frame.speech||frame.loading)&&<div className="rp-reaction"><span className="rp-avatar">{record.characterAvatar?<img src={record.characterAvatar} alt={record.characterName}/>:record.characterName.slice(0,1)}</span><div className="rp-bubble">{frame.speech||frame.loading}</div></div>}</div>:<main className="rp-scroll"><p className="rp-muted">这条旧记录没有画面快照，可查看当时的文字记录。</p>{record.events.map(e=><p className="rp-card" key={e.id}>{e.text}</p>)}</main>}
    <footer className="rp-bottom"><p className="rp-muted">仅回放当时内容，不调用接口或重新执行操作。</p>{readError&&<p role="alert">{readError}</p>}{!!frames.length&&<><input aria-label="回放进度" type="range" min={0} max={frames.length-1} value={index} onChange={e=>setIndex(Number(e.target.value))}/><div className="rp-actions"><button onClick={()=>{if(index>=frames.length-1){setIndex(0);setPlaying(true);}else setPlaying(v=>!v);}}>{index>=frames.length-1?"重新播放":playing?"暂停":"继续"}</button><select aria-label="回放倍速" value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[1,1.5,2,3].map(v=><option key={v} value={v}>{v}倍速</option>)}</select><span>{index+1}/{frames.length}</span></div></>}<details><summary>完整查看与操作记录</summary><div style={{maxHeight:180,overflowY:"auto"}}>{record.events.map(e=><p key={e.id}>{e.text}</p>)}</div></details></footer>
  </section>;
}
