import { FACING_SHARED_CHARACTER_ID, facingScenePosition, groupFacingScenes, loadFacingAssets, loadFacingSettings, loadFacingUsableAssets, type FacingAsset } from "./facing-storage";
import { mapPlace, updateFacingAtlas, type FacingAtlas, type MapPlace } from "./facing-map-storage";
import {bigMapPlace} from "./facing-place-life";
export type MapSceneBinding = { source:"default"|"character"|"shared"; characterId?:string; sceneId?:string; sceneName?:string };
const key=(value:string)=>value.normalize("NFKC").toLowerCase().replace(/[\s·・/\\／_—-]/g,"");
export function matchPlaceScene(place:Pick<MapPlace,"name">, assets:FacingAsset[]) {
  const name=key(place.name);
  return assets.filter(asset=>asset.category==="scene").map(asset=>{const label=key(asset.location||asset.name);return {asset,score:label===name?10000:label.length>=2&&name.length>=2&&(name.includes(label)||label.includes(name))?Math.min(label.length,name.length):0};}).filter(item=>item.score>0).sort((a,b)=>b.score-a.score)[0]?.asset;
}
export function scanMapScenes(places:MapPlace[], owner:string, overwrite = false) {
  const assets=loadFacingAssets(owner);
  return places.map(place=>{if(!overwrite && place.sceneBinding?.sceneId)return place;const scene=matchPlaceScene(place,assets);return {...place,sceneBinding:scene?{source:owner===FACING_SHARED_CHARACTER_ID?"shared" as const:"character" as const,characterId:owner,sceneId:scene.id,sceneName:scene.name}:{source:"default" as const}};});
}
export async function saveMapSceneBindings(atlasId:string,pageId:string,places:MapPlace[]) {
  const bindings=new Map(places.map(place=>[place.id,place.sceneBinding]));
  return updateFacingAtlas(atlasId,current=>({...current,pages:current.pages.map(page=>page.id===pageId?{...page,places:page.places.map(place=>bindings.has(place.id)?{...place,sceneBinding:bindings.get(place.id)}:place)}:page)}));
}
/** A scope contains one place and its descendants, never sibling buildings. */
export function mapSceneScope(atlas: FacingAtlas, placeId: string): MapPlace[] {
  const result: MapPlace[] = [], seen = new Set<string>();
  function visit(id: string) {
    if (seen.has(id)) return;
    seen.add(id);
    const place = mapPlace(atlas, id)?.place;
    if (!place) return;
    result.push(place);
    for (const page of atlas.pages.filter(page => page.parentPlaceId === id)) for (const child of page.places) visit(child.id);
  }
  visit(placeId);
  return result;
}
export async function saveScopedMapScenes(atlasId: string, placeId: string, places: MapPlace[]) {
  return updateFacingAtlas(atlasId, current => {
    if (!mapPlace(current, placeId)) throw new Error("这个地点已被删除，请返回地图重新选择。");
    const allowed = new Set(mapSceneScope(current, placeId).map(place => place.id));
    const bindings = new Map(places.filter(place => allowed.has(place.id)).map(place => [place.id, place.sceneBinding]));
    return {...current, pages: current.pages.map(page => ({...page, places: page.places.map(place => bindings.has(place.id) ? {...place, sceneBinding: bindings.get(place.id)} : place)}))};
  });
}
export function sceneForMapPlace(atlas:FacingAtlas,placeId:string,characterId:string) {
  const place=mapPlace(atlas,placeId)?.place, root=bigMapPlace(atlas,placeId);
  const usable=loadFacingUsableAssets(characterId), settings=loadFacingSettings().characters[characterId];
  const groups=groupFacingScenes(usable,settings?.portraitId);
  const portraits=usable.filter(asset=>asset.category==="portrait"&&!asset.generated&&asset.composition!=="full");
  function resolve(binding?: MapSceneBinding) {
    if (!binding || binding.source === "default") return;
    const assets=loadFacingAssets(binding.characterId||FACING_SHARED_CHARACTER_ID);
    const scene=assets.find(asset=>asset.id===binding.sceneId&&asset.category==="scene")||assets.find(asset=>asset.category==="scene"&&asset.name===binding.sceneName);
    if (!scene) return;
    return facingScenePosition(groupFacingScenes([{...scene,portraitIds:scene.characterId===characterId?scene.portraitIds:undefined},...portraits],settings?.portraitId)[0]);
  }
  // An explicit detail wins; missing/deleted detail media inherits the building default.
  const bound=resolve(place?.sceneBinding) ?? (root?.id!==place?.id ? resolve(root?.sceneBinding) : undefined);
  if (bound) return bound;
  if(place?.sceneBinding?.source==="default") return facingScenePosition(groups.find(group=>group.backdrop?.id===settings?.sceneId)||groups[0]);
  const homeOwner=root?.homeCharacterIds?.[0];
  const scene=place?(homeOwner?matchPlaceScene(place,loadFacingAssets(homeOwner)):undefined)??matchPlaceScene(place,usable):undefined;
  if(scene)return facingScenePosition(groupFacingScenes([{...scene,portraitIds:scene.characterId===characterId?scene.portraitIds:undefined},...portraits],settings?.portraitId)[0]);
  return facingScenePosition(groups[0]);
}
