import {mapPlace,mapResidentIds,updateFacingAtlas,type FacingAtlas,type MapAmbience} from "./facing-map-storage";
import {storeMediaBlob,deleteMediaRef} from "./media-cache-storage";

/** Resolve a place through every interior level to its top-level location. */
export function bigMapPlace(atlas:FacingAtlas,placeId?:string){
 if(!placeId)return;
 let found=mapPlace(atlas,placeId);const seen=new Set<string>();
 while(found?.page.parentPlaceId){if(seen.has(found.place.id))return;seen.add(found.place.id);found=mapPlace(atlas,found.page.parentPlaceId);}
 return found?.place;
}
export async function savePlaceLife(atlasId:string,placeId:string,patch:{homeCharacterIds?:string[];ambience?:MapAmbience|null}){
 return updateFacingAtlas(atlasId,current=>{
  const root=bigMapPlace(current,placeId);if(!root)throw new Error("地点已被删除，请返回地图重新选择。");
  const homeCharacterIds=patch.homeCharacterIds? [...new Set(patch.homeCharacterIds)]:root.homeCharacterIds;
  if(patch.homeCharacterIds?.some(id=>!mapResidentIds(current).includes(id)))throw new Error("只能选择在这个世界生活的角色。");
  return {...current,pages:current.pages.map(page=>({...page,places:page.places.map(place=>place.id===root.id?{
   ...place,homeCharacterIds,...("ambience" in patch?{ambience:patch.ambience??undefined}:{})
  }:place)}))};
 });
}
export async function uploadPlaceAmbience(atlasId:string,placeId:string,file:Blob&{name?:string}){
 const formats:Record<string,string>={mp3:"audio/mpeg",m4a:"audio/mp4",aac:"audio/aac",wav:"audio/wav",ogg:"audio/ogg",flac:"audio/flac",webm:"audio/webm"};
 const mime=file.type.startsWith("audio/")?file.type:formats[file.name?.split(".").at(-1)?.toLowerCase()??""];
 if(!mime||!file.size||file.size>30*1024*1024)throw new Error("请选择不超过30 MB的音频文件。");
 const mediaRef=await storeMediaBlob(file,mime,"audio");
 try{return await savePlaceLife(atlasId,placeId,{ambience:{mediaRef,name:file.name||"氛围音",volume:.25}});}
 catch(cause){await deleteMediaRef(mediaRef);throw cause;}
}
