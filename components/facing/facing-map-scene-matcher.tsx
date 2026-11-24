"use client";
import {useState} from "react";
import type {Character} from "@/lib/character-types";
import {FACING_SHARED_CHARACTER_ID,loadFacingAssets} from "@/lib/facing-storage";
import {mapSceneScope,scanMapScenes,saveScopedMapScenes} from "@/lib/facing-map-scenes";
import {mapPlace,type FacingAtlas,type FacingMapPage,type MapPlace} from "@/lib/facing-map-storage";
import {MapSheet} from "./facing-map-panels";
import {bigMapPlace} from "@/lib/facing-place-life";
export function MapSceneMatcher({atlas,page,placeId,characters,onClose,onSave}:{atlas:FacingAtlas;page:FacingMapPage;placeId?:string;characters:Character[];initialCharacterId:string;onClose:()=>void;onSave:(atlas:FacingAtlas)=>void}){
 const initial=placeId??page.parentPlaceId??page.places[0]?.id;
 const [target,setTarget]=useState(initial??"");
 const root=mapPlace(atlas,target)?.place,home=bigMapPlace(atlas,target);
 const [owner,setOwner]=useState(root?.sceneBinding?.characterId??home?.homeCharacterIds?.[0]??FACING_SHARED_CHARACTER_ID);
 const [places,setPlaces]=useState<MapPlace[]>(()=>initial?mapSceneScope(atlas,initial):[]);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const sources=[{id:FACING_SHARED_CHARACTER_ID,name:"通用场景素材"},...characters.map(character=>({id:character.id,name:character.name+(home?.homeCharacterIds?.includes(character.id)?" · 此家的角色":"")}))];
 const options=loadFacingAssets(owner).filter(asset=>asset.category==="scene");
 function chooseTarget(id:string){setTarget(id);setPlaces(mapSceneScope(atlas,id));const place=mapPlace(atlas,id)?.place;setOwner(place?.sceneBinding?.characterId??bigMapPlace(atlas,id)?.homeCharacterIds?.[0]??FACING_SHARED_CHARACTER_ID);setError("");}
 function select(place:MapPlace,choice:string){const asset=options.find(asset=>asset.id===choice);setPlaces(old=>old.map(item=>item.id===place.id?{...item,sceneBinding:asset?{source:owner===FACING_SHARED_CHARACTER_ID?"shared":"character",characterId:owner,sceneId:asset.id,sceneName:asset.name}:{source:"default"}}:item));}
 function picker(place:MapPlace,isDefault=false){const binding=place.sceneBinding;const value=binding?.sceneId?`${binding.characterId}|${binding.sceneId}`:"default";return <label key={place.id}>{isDefault?"大地点默认背景":place.name}<select disabled={busy} aria-label={isDefault?"大地点默认背景":`${place.name}的场景`} value={value} onChange={e=>select(place,e.target.value.split("|").at(-1)!)}><option value="default">{isDefault?"未指定背景（沿用原有场景）":`沿用「${root?.name}」默认背景`}</option>{binding?.sceneId&&!options.some(asset=>asset.id===binding.sceneId&&asset.characterId===binding.characterId)&&<option value={value}>已保存：{binding.sceneName??"原场景"}（保留）</option>}{options.map(asset=><option key={asset.id} value={`${owner}|${asset.id}`}>{asset.name}</option>)}</select></label>;}
 async function save(){if(busy||!target)return;setBusy(true);setError("");try{onSave(await saveScopedMapScenes(atlas.id,target,places));onClose();}catch(e){setError(e instanceof Error?e.message:"保存失败");}finally{setBusy(false);}}
 return <MapSheet title={`${root?.name??"地点"} · 场景匹配`} onClose={()=>{if(!busy)onClose();}}>
 {!placeId&&!page.parentPlaceId&&<label>配置地点<select value={target} disabled={busy} onChange={e=>chooseTarget(e.target.value)}>{page.places.map(place=><option key={place.id} value={place.id}>{place.name}</option>)}</select></label>}
 <p>只配置「{root?.name??"当前地点"}」及其内部地点。有细分背景时使用细分，没有时沿用这里的默认背景。</p>
 <label>素材来源<select value={owner} disabled={busy} onChange={e=>setOwner(e.target.value)}>{!sources.some(source=>source.id===owner)&&<option value={owner}>原素材来源（已移除）</option>}{sources.map(source=><option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
 {!options.length&&<p className="fmap-note">这个来源还没有场景背景，可先去场景素材中添加。更换来源不会清除已保存的匹配。</p>}
 {places[0]&&picker(places[0],true)}
 <h3>细分地点匹配</h3>
 <button type="button" className="facing-small fmap-outline" disabled={busy||places.length<2||!options.length} onClick={()=>setPlaces(old=>[old[0],...scanMapScenes(old.slice(1),owner)])}>扫描未配置的细分地点</button>
 <p className="fmap-note">按名称匹配，不调用API。已有单独背景保留，扫描后需点击保存才生效。</p>
 {places.slice(1).map(place=>picker(place))}
 {places.length<2&&<p>暂无细分地点，可以先设置默认背景，或在内部地图中添加地点。</p>}
 <button type="button" className="facing-primary" disabled={busy||!target} onClick={()=>void save()}>{busy?"正在保存…":"保存场景匹配"}</button>{error&&<p role="alert">{error}</p>}
 </MapSheet>;
}
