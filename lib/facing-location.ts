import {loadFacingAtlases,mapPlacePath,mapCharacterResidence} from "./facing-map-storage";
import {getCharacterWorldGroup} from "./character-world-storage";
import {bigMapPlace} from "./facing-place-life";
import {loadFacingAssets,facingMeetingPosition,facingParticipantIds,FACING_MEETING_PREFIX,type FacingMeeting} from "./facing-storage";
import {kvUpdatePersisted} from "./kv-db";

export function facingLocationCandidates(characterId:string) {
 const world=mapCharacterResidence(characterId)??getCharacterWorldGroup(characterId)?.id??characterId;
 return loadFacingAtlases(world).flatMap(atlas=>atlas.pages.flatMap(page=>page.places.map(place=>({atlas,place,path:mapPlacePath(atlas,place.id)}))));
}
/** Resolve only unambiguous names/bindings, never assume every room belongs to a home. */
export function resolveFacingLocation(meeting:FacingMeeting) {
 const position=facingMeetingPosition(meeting),candidates=facingLocationCandidates(meeting.characterId);
 const old=meeting.mapContext&&candidates.find(item=>item.atlas.id===meeting.mapContext!.atlasId&&item.place.id===meeting.mapContext!.placeId);
 const name=position.sceneName.split(" · ").at(-1)?.trim();
 if(old&&(meeting.mapContext?.sceneName===position.sceneName||position.sceneName===old.path||name===old.place.name||position.sceneId&&position.sceneId===old.place.sceneBinding?.sceneId))return old;
 let matching=candidates.filter(item=>position.sceneId&&item.place.sceneBinding?.sceneId===position.sceneId||item.path===position.sceneName||item.place.name===name);
 if(old){const root=bigMapPlace(old.atlas,old.place.id);const same=matching.filter(item=>item.atlas.id===old.atlas.id&&bigMapPlace(item.atlas,item.place.id)?.id===root?.id);if(same.length===1)return same[0];}
 if(matching.length===1)return matching[0];
 matching=matching.filter(item=>bigMapPlace(item.atlas,item.place.id)?.homeCharacterIds?.includes(meeting.characterId));
 if(matching.length===1)return matching[0];
 // A manually configured home scene can exist before its rooms are added to the map.
 const ownScene=loadFacingAssets(meeting.characterId).some(asset=>asset.category==="scene"&&(asset.id===position.sceneId||asset.name===name));
 const homeRooms=/^(客厅|卧室|主卧|次卧|厨房|浴室|卫生间|书房|阳台|餐厅|衣帽间|玄关|走廊)$/;
 const homes=candidates.filter(item=>item.place.homeCharacterIds?.includes(meeting.characterId)&&bigMapPlace(item.atlas,item.place.id)?.id===item.place.id);
 return ownScene&&name&&homeRooms.test(name)&&homes.length===1?homes[0]:undefined;
}
export async function bindFacingLocation(meeting:FacingMeeting,location?:{atlasId:string;placeId:string}) {
 let saved=meeting;
 await kvUpdatePersisted(FACING_MEETING_PREFIX+meeting.id,raw=>{
  if(!raw)throw new Error("见面记录不存在。");
  const current=JSON.parse(raw) as FacingMeeting;
  if(current.deletedAt)return raw;
  const target=location&&facingLocationCandidates(current.characterId).find(item=>item.atlas.id===location.atlasId&&item.place.id===location.placeId);
  if(location&&!target)throw new Error("地图地点已移除，请重新选择。");
  const prior=current.mapContext;
  saved={...current,mapContext:target?{atlasId:target.atlas.id,placeId:target.place.id,participantIds:facingParticipantIds(current),secret:prior?.atlasId===target.atlas.id&&prior.placeId===target.place.id?prior.secret:false,description:target.place.description,sceneName:facingMeetingPosition(current).sceneName}:undefined};
  return JSON.stringify(saved);
 });
 return saved;
}
