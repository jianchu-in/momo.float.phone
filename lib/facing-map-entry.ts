import { loadCharacters } from "./character-storage";
import { facingCastScenes, resolveFacingScene, loadFacingUsableAssets, type FacingMeeting, type FacingSceneGroup } from "./facing-storage";
import { facingLocationCandidates } from "./facing-location";
import { loadFacingAtlas, mapActivitySnapshot, mapPlacePath, saveMapArrival, type MapTrip } from "./facing-map-storage";
import { sceneForMapPlace } from "./facing-map-scenes";

export const facingSceneChoiceId = (group: FacingSceneGroup) => group.choiceId ?? group.name;

/** A map place is selectable even if nobody has generated a background for it. */
export function facingDestinationGroups(ids: string[], names: Record<string, string>): FacingSceneGroup[] {
  const material = facingCastScenes(ids, names);
  if (!ids.length) return material;
  const places = [...new Map(ids.flatMap(facingLocationCandidates).map(item => [`${item.atlas.id}|${item.place.id}`, item])).values()];
  const assets = ids.flatMap(loadFacingUsableAssets);
  return [...material, ...places.map(({ atlas, place, path }) => {
    const scene = sceneForMapPlace(atlas, place.id, ids[0]);
    const {backdrop,portrait}=resolveFacingScene(scene,[],assets);
    return { name: path, label: `${atlas.name} · ${path}`, choiceId: `map:${atlas.id}|${place.id}`,
      mapLocation: { atlasId: atlas.id, placeId: place.id }, assets: backdrop ? [backdrop] : [], backdrop, portrait, reactions: [],
    } satisfies FacingSceneGroup;
  })];
}

export async function enterFacingMapPlace(options: {
  atlasId: string; trip: MapTrip; visitId: string; leadId: string; identityId: string | null;
  seed?: FacingMeeting; previousMeeting?: FacingMeeting;
}) {
  const atlas = loadFacingAtlas(options.atlasId);
  if (!atlas) throw new Error("地图已移除，请重新选择。");
  const characters = new Set(loadCharacters().map(item => item.id));
  const companions = [...new Set(options.trip.characterIds)].filter(id => characters.has(id));
  if (companions.length !== new Set(options.trip.characterIds).size) throw new Error("同行角色已被移除，请重新选择。");
  const residents = options.trip.targetCharacterId ? [options.trip.targetCharacterId]
    : mapActivitySnapshot(atlas)?.entries.filter(entry => entry.placeId === options.trip.placeId).map(entry => entry.characterId) ?? [];
  const participants = [...new Set([...companions, ...residents.filter(id => characters.has(id))])];
  const primaryId = companions[0] ?? residents.find(id => characters.has(id)) ?? options.leadId;
  if (!characters.has(primaryId)) throw new Error("请选择仍在角色库中的角色。");
  const scene = { ...sceneForMapPlace(atlas, options.trip.placeId, primaryId), sceneName: mapPlacePath(atlas, options.trip.placeId) };
  return saveMapArrival(atlas.id, { ...options.trip, characterIds: companions }, options.visitId, primaryId, options.identityId,
    participants, scene, options.previousMeeting, options.seed);
}
