import { FACING_SHARED_CHARACTER_ID, facingScenePosition, groupFacingScenes, loadFacingAssets, loadFacingSettings, loadFacingUsableAssets, type FacingAsset } from "./facing-storage";
import { mapPlace, updateFacingAtlas, type FacingAtlas, type MapPlace } from "./facing-map-storage";
import {bigMapPlace} from "./facing-place-life";
export type MapSceneBinding = { source:"default"|"character"|"shared"; characterId?:string; sceneId?:string; sceneName?:string };
const key=(value:string)=>value.normalize("NFKC").toLowerCase().replace(/[\s·・/\\／_—-]/g,"");
export function matchPlaceScene(place:Pick<MapPlace,"name">, assets:FacingAsset[]) {
  const name=key(place.name);
  return assets.filter(asset=>asset.category==="scene").map(asset=>{const label=key(asset.location||asset.name);return {asset,score:label===name?10000:label.length>=2&&name.length>=2&&(name.includes(label)||label.includes(name))?Math.min(label.length,name.length):0};}).filter(item=>item.score>0).sort((a,b)=>b.score-a.score)[0]?.asset;
}
export function scanMapScenes(places:MapPlace[], owner:string) {
  const assets=loadFacingAssets(owner);
  return places.map(place=>{const scene=matchPlaceScene(place,assets);return {...place,sceneBinding:scene?{source:owner===FACING_SHARED_CHARACTER_ID?"shared" as const:"character" as const,characterId:owner,sceneId:scene.id,sceneName:scene.name}:{source:"default" as const}};});
}
export async function saveMapSceneBindings(atlasId:string,pageId:string,places:MapPlace[]) {
  const bindings=new Map(places.map(place=>[place.id,place.sceneBinding]));
  return updateFacingAtlas(atlasId,current=>({...current,pages:current.pages.map(page=>page.id===pageId?{...page,places:page.places.map(place=>bindings.has(place.id)?{...place,sceneBinding:bindings.get(place.id)}:place)}:page)}));
}
export function sceneForMapPlace(atlas:FacingAtlas,placeId:string,characterId:string) {
  const place=mapPlace(atlas,placeId)?.place, binding=place?.sceneBinding;
  const usable=loadFacingUsableAssets(characterId), groups=groupFacingScenes(usable,loadFacingSettings().characters[characterId]?.portraitId);
  if(binding?.source==="default"){
    const settings=loadFacingSettings().characters[characterId];
    return facingScenePosition(groups.find(group=>group.backdrop?.id===settings?.sceneId)||groups[0]);
  }
  if(binding?.source==="character"||binding?.source==="shared"){
    const assets=loadFacingAssets(binding.characterId||FACING_SHARED_CHARACTER_ID);
    const scene=assets.find(asset=>asset.id===binding.sceneId&&asset.category==="scene")||assets.find(asset=>asset.category==="scene"&&asset.name===binding.sceneName);
    if(scene){const portraits=usable.filter(asset=>asset.category==="portrait"&&!asset.generated&&asset.composition!=="full");
      const group=groupFacingScenes([{...scene,portraitIds:scene.characterId===characterId?scene.portraitIds:undefined},...portraits],loadFacingSettings().characters[characterId]?.portraitId)[0];return facingScenePosition(group);}
  }
  const homeOwner=bigMapPlace(atlas,placeId)?.homeCharacterIds?.[0];
  const scene=place?(homeOwner?matchPlaceScene(place,loadFacingAssets(homeOwner)):undefined)??matchPlaceScene(place,usable):undefined;
  if(scene){const portraits=usable.filter(asset=>asset.category==="portrait"&&!asset.generated&&asset.composition!=="full");return facingScenePosition(groupFacingScenes([{...scene,portraitIds:scene.characterId===characterId?scene.portraitIds:undefined},...portraits])[0]);}
  return facingScenePosition(groups[0]);
}
