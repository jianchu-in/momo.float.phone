"use client";
import {useState} from "react";
import type {Character} from "@/lib/character-types";
import {FACING_SHARED_CHARACTER_ID,loadFacingAssets} from "@/lib/facing-storage";
import {scanMapScenes,saveMapSceneBindings} from "@/lib/facing-map-scenes";
import type {FacingAtlas,FacingMapPage,MapPlace} from "@/lib/facing-map-storage";
import {MapSheet} from "./facing-map-panels";
export function MapSceneMatcher({atlas,page,characters,initialCharacterId,onClose,onSave}:{atlas:FacingAtlas;page:FacingMapPage;characters:Character[];initialCharacterId:string;onClose:()=>void;onSave:(atlas:FacingAtlas)=>void}){
 const [owner,setOwner]=useState(initialCharacterId),[places,setPlaces]=useState<MapPlace[]>(page.places),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const sources=[...characters.map(character=>({id:character.id,name:character.name})),{id:FACING_SHARED_CHARACTER_ID,name:"通用场景素材"}];
 const options=sources.flatMap(source=>loadFacingAssets(source.id).filter(asset=>asset.category==="scene").map(asset=>({owner:source.id,id:asset.id,name:`${source.name} · ${asset.name}`,sceneName:asset.name})));
 async function save(){if(busy)return;setBusy(true);setError("");try{onSave(await saveMapSceneBindings(atlas.id,page.id,places));onClose();}catch(e){setError(e instanceof Error?e.message:"保存失败");}finally{setBusy(false);}}
 return <MapSheet title="地点匹配场景素材" onClose={()=>{if(!busy)onClose();}}><p>按地点名称扫描匹配，不调用API。先预览，再保存；每个地点也可单独选择默认或其他素材。</p><label>扫描素材来源<select value={owner} disabled={busy} onChange={e=>setOwner(e.target.value)}>{sources.map(source=><option key={source.id} value={source.id}>{source.name}</option>)}</select></label><button type="button" disabled={busy} onClick={()=>setPlaces(scanMapScenes(page.places,owner))}>扫描匹配本页地点</button>
 <p>已匹配 {places.filter(place=>place.sceneBinding?.sceneId).length} / {places.length} 个地点，未匹配的使用默认场景。</p>
 {places.map(place=><label key={place.id}>{place.name}<select disabled={busy} aria-label={`${place.name}的场景`} value={place.sceneBinding?.sceneId?`${place.sceneBinding.characterId}|${place.sceneBinding.sceneId}`:"default"} onChange={e=>{const choice=options.find(o=>`${o.owner}|${o.id}`===e.target.value);setPlaces(old=>old.map(p=>p.id===place.id?{...p,sceneBinding:choice?{source:choice.owner===FACING_SHARED_CHARACTER_ID?"shared":"character",characterId:choice.owner,sceneId:choice.id,sceneName:choice.sceneName}:{source:"default"}}:p));}}><option value="default">默认场景</option>{options.map(option=><option key={`${option.owner}|${option.id}`} value={`${option.owner}|${option.id}`}>{option.name}</option>)}</select></label>)}
 <button type="button" disabled={busy} onClick={()=>void save()}>保存地点与场景的对应</button>{error&&<p role="alert">{error}</p>}</MapSheet>;
}
