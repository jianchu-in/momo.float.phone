import {loadFacingAtlases,mapPlacePath,mapCharacterResidence} from "./facing-map-storage";
import {getCharacterWorldGroup} from "./character-world-storage";
import {bigMapPlace} from "./facing-place-life";
import {FACING_SHARED_CHARACTER_ID,loadFacingAssets,facingMeetingPosition,facingParticipantIds,FACING_MEETING_PREFIX,type FacingMeeting} from "./facing-storage";
import {kvUpdatePersisted} from "./kv-db";

export function facingLocationCandidates(characterId:string) {
 const world=mapCharacterResidence(characterId)??getCharacterWorldGroup(characterId)?.id??characterId;
 return loadFacingAtlases(world).flatMap(atlas=>atlas.pages.flatMap(page=>page.places.map(place=>({atlas,place,path:mapPlacePath(atlas,place.id)}))));
}
export function facingMeetingLocationCandidates(meeting: FacingMeeting) {
 const all=facingParticipantIds(meeting).flatMap(facingLocationCandidates);
 return [...new Map(all.map(item=>[`${item.atlas.id}:${item.place.id}`,item])).values()];
}
/** Explicit visit links and stable backdrop IDs precede name matching. */
export function resolveFacingLocation(meeting:FacingMeeting) {
 const position=facingMeetingPosition(meeting),candidates=facingMeetingLocationCandidates(meeting);
 const selectedAsset=position.sceneId?[...facingParticipantIds(meeting),FACING_SHARED_CHARACTER_ID].flatMap(loadFacingAssets).find(asset=>asset.id===position.sceneId):undefined;
 const privateScene=selectedAsset&&selectedAsset.characterId!==FACING_SHARED_CHARACTER_ID;
 const sceneOwner=privateScene?selectedAsset.characterId:meeting.characterId;
 const old=meeting.mapContext&&candidates.find(item=>item.atlas.id===meeting.mapContext!.atlasId&&item.place.id===meeting.mapContext!.placeId);
 if(old&&meeting.mapContext?.sceneName===position.sceneName)return old;
 const exact=candidates.filter(item=>position.sceneId&&item.place.sceneBinding?.sceneId===position.sceneId);
 if(exact.length===1)return exact[0];
 const name=position.sceneName.split(" · ").at(-1)?.trim();
 const ownerMatches=(item:typeof candidates[number])=>!privateScene||!bigMapPlace(item.atlas,item.place.id)?.homeCharacterIds?.length||bigMapPlace(item.atlas,item.place.id)?.homeCharacterIds?.includes(sceneOwner);
 if(old&&ownerMatches(old)&&(position.sceneName===old.path||name===old.place.name||position.sceneId&&position.sceneId===old.place.sceneBinding?.sceneId))return old;
 let matching=candidates.filter(item=>(item.path===position.sceneName||item.place.name===name)&&ownerMatches(item));
 if(old&&ownerMatches(old)){const root=bigMapPlace(old.atlas,old.place.id);const same=matching.filter(item=>item.atlas.id===old.atlas.id&&bigMapPlace(item.atlas,item.place.id)?.id===root?.id);if(same.length===1)return same[0];}
 if(matching.length===1)return matching[0];
 matching=matching.filter(item=>bigMapPlace(item.atlas,item.place.id)?.homeCharacterIds?.includes(sceneOwner));
 if(matching.length===1)return matching[0];
 const ownScene=loadFacingAssets(sceneOwner).some(asset=>asset.category==="scene"&&(asset.id===position.sceneId||asset.name===name));
 const homeRooms=/^(客厅|卧室|主卧|次卧|厨房|浴室|卫生间|书房|阳台|餐厅|衣帽间|玄关|走廊)$/;
 const homes=candidates.filter(item=>item.place.homeCharacterIds?.includes(sceneOwner)&&bigMapPlace(item.atlas,item.place.id)?.id===item.place.id);
 return ownScene&&name&&homeRooms.test(name)&&homes.length===1?homes[0]:undefined;
}
export async function bindFacingLocation(meeting:FacingMeeting,location?:{atlasId:string;placeId:string}) {
 let saved=meeting;
 await kvUpdatePersisted(FACING_MEETING_PREFIX+meeting.id,raw=>{
  if(!raw)throw new Error("见面记录不存在。");
  const current=JSON.parse(raw) as FacingMeeting;
  if(current.deletedAt)return raw;
  const target=location&&facingMeetingLocationCandidates(current).find(item=>item.atlas.id===location.atlasId&&item.place.id===location.placeId);
  if(location&&!target)throw new Error("地图地点已移除，请重新选择。");
  const prior=current.mapContext;
  saved={...current,mapContext:target?{atlasId:target.atlas.id,placeId:target.place.id,participantIds:facingParticipantIds(current),secret:prior?.atlasId===target.atlas.id&&prior.placeId===target.place.id?prior.secret:false,description:target.place.description,sceneName:facingMeetingPosition(current).sceneName}:undefined};
  return JSON.stringify(saved);
 });
 return saved;
}
