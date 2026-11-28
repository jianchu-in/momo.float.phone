"use client";
import { useState } from "react";
import { loadCharacters } from "@/lib/character-storage";
export type FacingCgDraft = { description:string; depictedCharacterIds:string[]; userVisible:boolean; referenceMode:"text"|"depicted" };
export function FacingCgEditor({ initial, participantIds, onGenerate, onCancel }: {
  initial:Partial<FacingCgDraft>;participantIds:string[];onGenerate:(draft:FacingCgDraft)=>Promise<void>;onCancel:()=>void;
}) {
  const [draft,setDraft]=useState<FacingCgDraft>({description:initial.description??"",depictedCharacterIds:initial.depictedCharacterIds??[],userVisible:initial.userVisible===true,referenceMode:initial.referenceMode??"depicted"});
  const [confirmed,setConfirmed]=useState(initial.depictedCharacterIds!==undefined),[busy,setBusy]=useState(false),[error,setError]=useState("");
  return <section className="facing-form" aria-label="调整本张CG的画面与参考"><h3>本张画面与出镜角色</h3>
    <textarea aria-label="CG画面描述" value={draft.description} disabled={busy} onChange={event=>setDraft({...draft,description:event.target.value})}/>
    <label>人物参考<select value={draft.referenceMode} disabled={busy} onChange={event=>setDraft({...draft,referenceMode:event.target.value as FacingCgDraft["referenceMode"]})}><option value="depicted">仅出镜角色</option><option value="text">纯文字</option></select></label>
    {draft.referenceMode==="depicted"&&<fieldset disabled={busy}><legend>实际出镜角色（未选者不附参考图）</legend>{participantIds.map(id=><label key={id}><input type="checkbox" checked={draft.depictedCharacterIds.includes(id)} onChange={event=>{setConfirmed(true);setDraft({...draft,depictedCharacterIds:event.target.checked?[...draft.depictedCharacterIds,id]:draft.depictedCharacterIds.filter(value=>value!==id)});}}/>{loadCharacters().find(item=>item.id===id)?.name??id}</label>)}
      <button type="button" onClick={()=>{setConfirmed(true);setDraft({...draft,depictedCharacterIds:[]});}}>环境空镜（无人物）</button>
      <label><input type="checkbox" checked={draft.userVisible} onChange={event=>setDraft({...draft,userVisible:event.target.checked})}/>用户本人实际出镜</label>
      {!confirmed&&<p>旧记录没有出镜名单，请选择角色或确认环境空镜。</p>}
    </fieldset>}
    <div className="facing-pair"><button type="button" disabled={busy} onClick={onCancel}>取消</button><button type="button" disabled={busy||!draft.description.trim()||(draft.referenceMode!=="text"&&!confirmed)} onClick={()=>{setBusy(true);setError("");void onGenerate(draft).catch(cause=>setError(cause instanceof Error?cause.message:"生成失败，请重试")).finally(()=>setBusy(false));}}>{busy?"生成中…":"按当前选择生成"}</button></div>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
