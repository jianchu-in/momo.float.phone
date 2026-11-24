"use client";
import {useEffect,useState} from "react";
import {MapSheet} from "./facing-map-panels";
import {bigMapPlace,savePlaceLife,uploadPlaceAmbience} from "@/lib/facing-place-life";
import type {FacingAtlas} from "@/lib/facing-map-storage";
import type {Character} from "@/lib/character-types";
export function FacingPlaceSettings({atlas,placeId,characters,onSave,onClose,onMatch}:{atlas:FacingAtlas;placeId:string;characters:Character[];onSave:(atlas:FacingAtlas)=>void;onClose:()=>void;onMatch:(atlas:FacingAtlas,placeId:string)=>void}){
 const root=bigMapPlace(atlas,placeId),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [level,setLevel]=useState(root?.ambience?.volume??.25);
 useEffect(()=>setLevel(root?.ambience?.volume??.25),[root?.ambience?.mediaRef,root?.ambience?.volume]);
 function saveVolume(){if(root?.ambience&&level!==root.ambience.volume)void run(()=>savePlaceLife(atlas.id,root!.id,{ambience:{...root!.ambience!,volume:level}}));}
 async function run(action:()=>Promise<FacingAtlas>){if(busy)return;setBusy(true);setError("");try{onSave(await action());}catch(e){setError(e instanceof Error?e.message:"保存失败");}finally{setBusy(false);}}
 if(!root)return null;
 return <MapSheet title={`${root.name} · 家与氛围音`} onClose={()=>{if(!busy)onClose();}}>
  <p>这些设置应用于该大地点，以及它全部层级的内部地图。</p>
  <fieldset disabled={busy}><legend>设为角色的家 · 可选择同住角色</legend>{characters.map(char=><label key={char.id}><input type="checkbox" checked={root.homeCharacterIds?.includes(char.id)??false} onChange={e=>{const ids=e.target.checked?[...(root.homeCharacterIds??[]),char.id]:(root.homeCharacterIds??[]).filter(id=>id!==char.id);void run(()=>savePlaceLife(atlas.id,root.id,{homeCharacterIds:ids}));}}/>{char.name}</label>)}</fieldset>
  {root&&<button type="button" className="facing-small fmap-outline" disabled={busy} onClick={()=>onMatch(atlas,root.id)}>设置默认背景与细分场景</button>}
  <label>上传该大地点的氛围音<input type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac,.webm" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void run(()=>uploadPlaceAmbience(atlas.id,root.id,file));}}/></label>
  {root.ambience&&<><p>当前：{root.ambience.name}</p><label>音量<input type="range" min="0" max="1" step=".05" value={level} disabled={busy} onChange={e=>setLevel(Number(e.target.value))} onPointerUp={saveVolume} onKeyUp={saveVolume} onBlur={saveVolume}/></label><button type="button" className="facing-small facing-delete" disabled={busy} onClick={()=>void run(()=>savePlaceLife(atlas.id,root.id,{ambience:null}))}>移除氛围音</button></>}
  <p>浏览器未允许自动播放时，点击地图或对话页的「播放氛围音」即可。</p>{error&&<p role="alert">{error}</p>}
 </MapSheet>;
}
