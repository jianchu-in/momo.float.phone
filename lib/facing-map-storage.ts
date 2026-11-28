import { kvGet, kvKeysWithPrefix, kvUpdatePersisted, kvUpdatePersistedEntries, kvDeletePersisted, registerDynamicPrefix, registerKvMigration } from "./kv-db";
import { loadCharacters } from "./character-storage";
import { facingArrival, facingArrivalText } from "./facing-arrival";
import { facingParticipantIds, facingId, FACING_MEETING_PREFIX, type FacingMeeting, type FacingScenePosition } from "./facing-storage";
import { deleteThemeAsset, saveThemeAssetFromBlob } from "./theme-storage";

export const FACING_MAP_PREFIX = "ai_phone_facing_map_v1:";
const MAP_PREFIX = FACING_MAP_PREFIX;
export const FACING_MAP_SETTINGS_KEY = "ai_phone_facing_map_settings_v1";
export const FACING_RESIDENTS_KEY = "ai_phone_facing_residents_v1";
registerKvMigration(FACING_RESIDENTS_KEY);
registerDynamicPrefix(MAP_PREFIX);
registerKvMigration(FACING_MAP_SETTINGS_KEY);

export type MapPoint = { x: number; y: number };
export type MapAmbience = { mediaRef: string; name: string; volume: number };
export type MapPlace = MapPoint & { id: string; name: string; description: string; tileId?: string; ambience?: MapAmbience; homeCharacterIds?: string[]; sceneBinding?: import("./facing-map-scenes").MapSceneBinding };
export type MapTile = MapPoint & { id: string; mediaId: string; width: number; height: number; pixelWidth: number; pixelHeight: number; name?: string; description?: string };
export type MapRoad = { id: string; from: string; to: string; points: MapPoint[] };
export type FacingMapPage = {
  id: string;
  parentPlaceId?: string;
  entryPlaceId?: string;
  name: string;
  description: string;
  tiles: MapTile[];
  places: MapPlace[];
  /** Retained for older backups; current travel uses straight lines. */
  roads: MapRoad[];
};
export type MapActivity = { characterId: string; placeId: string; activity: string; time: string };
export type MapSnapshot = { id: string; createdAt: string; entries: MapActivity[] };
export const FACING_MAP_SNAPSHOT_LIMIT = 10;
export type MapInvitation = {
  id: string; placeId: string; createdAt: string; identityId: string | null;
  chatAccountId?: string | null;
  recipients: { characterId: string; status: "waiting" | "accepted" | "declined" | "failed"; reply?: string; messageId?: string; sessionId?: string }[];
};
export type MapVisit = { id: string; identityId: string | null; placeId: string; characterIds: string[]; secret: boolean; at: string; meetingId: string };
export type MapTrip = { placeId: string; characterIds: string[]; secret: boolean; targetCharacterId?: string };
export type FacingAtlas = {
  id: string; worldId: string; name: string; characterIds: string[]; worldBookIds: string[];
  pages: FacingMapPage[]; snapshots: MapSnapshot[]; invitations: MapInvitation[]; visits: MapVisit[];
  deletedVisitIds?: string[];
  userPlaces: Record<string, string>; createdAt: string; updatedAt: string;
};
export type MapPreferences = {
  ambienceMuted?: boolean;
  descriptionPrompt: string; imagePrompt: string; width: number; height: number;
  animation: "route" | "car"; line: "solid" | "dashed"; duration: number;
};
const DEFAULTS: MapPreferences = { descriptionPrompt: "", imagePrompt: "", width: 1024, height: 1024, animation: "route", line: "dashed", duration: 4 };
function parse<T>(raw: string | null, fallback: T): T {
  try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
export function loadMapPreferences(): MapPreferences {
  return { ...DEFAULTS, ...parse<Partial<MapPreferences>>(kvGet(FACING_MAP_SETTINGS_KEY), {}) };
}
export async function saveMapPreferences(patch: Partial<MapPreferences>) {
  await kvUpdatePersisted(FACING_MAP_SETTINGS_KEY, raw => JSON.stringify({ ...DEFAULTS, ...parse(raw, {}), ...patch }));
}
function recentMapSnapshots(snapshots: MapSnapshot[]) {
  const time = (item: MapSnapshot) => Date.parse(item.createdAt) || 0;
  return [...snapshots].sort((a, b) => time(a) - time(b)).slice(-FACING_MAP_SNAPSHOT_LIMIT);
}
export function loadFacingAtlas(id: string) {
  const atlas = parse<FacingAtlas | null>(kvGet(MAP_PREFIX + id), null);
  return atlas ? { ...atlas, snapshots: recentMapSnapshots(atlas.snapshots) } : null;
}
export function loadFacingAtlases(worldId: string) {
  return kvKeysWithPrefix(MAP_PREFIX).map(key => parse<FacingAtlas | null>(kvGet(key), null))
    .filter((atlas): atlas is FacingAtlas => !!atlas && atlas.worldId === worldId)
    .map(atlas => ({ ...atlas, snapshots: recentMapSnapshots(atlas.snapshots) }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
type ResidentRegistry = Record<string, { characterIds: string[]; atlasIds: string[]; name: string }>;
function residentRegistry(raw = kvGet(FACING_RESIDENTS_KEY)): ResidentRegistry {
  const registry = parse<ResidentRegistry>(raw, {});
  for (const key of kvKeysWithPrefix(MAP_PREFIX)) {
    const atlas = parse<FacingAtlas | null>(kvGet(key), null);
    if (!atlas || registry[atlas.worldId]) continue;
    const maps = loadFacingAtlases(atlas.worldId);
    registry[atlas.worldId] = { name: atlas.name, characterIds: [...new Set(maps.flatMap(item => item.characterIds))], atlasIds: maps.map(item => item.id) };
  }
  return registry;
}
export function mapResidentIds(atlas: FacingAtlas) { return residentRegistry()[atlas.worldId]?.characterIds ?? atlas.characterIds; }
export function mapCharacterResidence(characterId: string) {
  return Object.entries(residentRegistry()).find(([, value]) => value.characterIds.includes(characterId))?.[0];
}
function assignResidents(registry: ResidentRegistry, worldId: string, ids: string[], atlasId: string, name: string) {
  for (const [other, value] of Object.entries(registry)) {
    if (other !== worldId && ids.some(id => value.characterIds.includes(id))) throw new Error(`部分角色已在「${value.name}」生活，请先从原世界移除。`);
  }
  registry[worldId] = { name, characterIds: [...new Set(ids)], atlasIds: [...new Set([...(registry[worldId]?.atlasIds ?? []), atlasId])] };
  return registry;
}
export async function saveMapResidents(atlas: FacingAtlas, ids: string[]) {
  const characterIds = [...new Set(ids)];
  await kvUpdatePersistedEntries({
    [FACING_RESIDENTS_KEY]: raw => JSON.stringify(assignResidents(residentRegistry(raw), atlas.worldId, characterIds, atlas.id, atlas.name)),
    ...Object.fromEntries(loadFacingAtlases(atlas.worldId).map(map => [MAP_PREFIX + map.id, (raw: string | null) => {
      const current = parse(raw, map);
      return JSON.stringify({ ...current, characterIds,pages:current.pages.map(page=>({...page,places:page.places.map(place=>place.homeCharacterIds?{...place,homeCharacterIds:place.homeCharacterIds.filter(id=>characterIds.includes(id))}:place)})), updatedAt: new Date().toISOString() });
    }])),
  });
  return loadFacingAtlas(atlas.id)!;
}
export async function updateFacingAtlas(id: string, update: (atlas: FacingAtlas) => FacingAtlas) {
  let result: FacingAtlas | undefined;
  await kvUpdatePersisted(MAP_PREFIX + id, raw => {
    const current = parse<FacingAtlas | null>(raw, null);
    if (!current) throw new Error("找不到这张地图。");
    const next = update(current);
    result = { ...next, snapshots: recentMapSnapshots(next.snapshots), updatedAt: new Date().toISOString() };
    return JSON.stringify(result);
  });
  return result!;
}
/** Persist the limit for older/imported maps without changing the map's activity timestamp. */
export async function trimFacingMapSnapshots(id: string) {
  await kvUpdatePersisted(MAP_PREFIX + id, raw => {
    const current = parse<FacingAtlas | null>(raw, null);
    if (!current) throw new Error("找不到这张地图。");
    return JSON.stringify({ ...current, snapshots: recentMapSnapshots(current.snapshots) });
  });
}
export async function renameFacingAtlas(id: string, name: string) {
  if (!name.trim()) throw new Error("请填写地图名称。");
  return updateFacingAtlas(id, atlas => ({ ...atlas, name: name.trim(), pages: atlas.pages.map(page =>
    !page.parentPlaceId && page.name === atlas.name ? { ...page, name: name.trim() } : page) }));
}
export async function deleteFacingAtlas(id: string) {
  // Original images can also belong to exported/custom templates; keep shared media intact.
  await kvDeletePersisted(MAP_PREFIX + id);
  await kvUpdatePersisted(FACING_RESIDENTS_KEY, raw => {
    const registry = residentRegistry(raw);
    for (const [world, data] of Object.entries(registry)) {
      data.atlasIds = data.atlasIds.filter(item => item !== id);
      if (!data.atlasIds.length) delete registry[world];
    }
    return JSON.stringify(registry);
  });
}
export async function createFacingAtlas(worldId: string, name: string, characterIds: string[], worldBookIds: string[], pages?: FacingMapPage[]) {
  const now = new Date().toISOString();
  const atlas: FacingAtlas = { id: facingId(), worldId, name, characterIds, worldBookIds,
    pages: pages ?? [{ id: facingId(), name, description: "", tiles: [], places: [], roads: [] }],
    snapshots: [], invitations: [], visits: [], userPlaces: {}, createdAt: now, updatedAt: now };
  await kvUpdatePersistedEntries({
    [FACING_RESIDENTS_KEY]: raw => {
      const registry = residentRegistry(raw);
      atlas.characterIds = [...new Set([...(registry[worldId]?.characterIds ?? []), ...characterIds])];
      return JSON.stringify(assignResidents(registry, worldId, atlas.characterIds, atlas.id, name));
    },
    [MAP_PREFIX + atlas.id]: () => JSON.stringify(atlas),
  });
  return atlas;
}
export function mapPlace(atlas: FacingAtlas, id: string) {
  for (const page of atlas.pages) {
    const place = page.places.find(item => item.id === id);
    if (place) return { page, place };
  }
}
export function mapPlacePath(atlas: FacingAtlas, id: string): string {
  const found = mapPlace(atlas, id);
  if (!found) return "";
  return [found.page.parentPlaceId ? mapPlacePath(atlas, found.page.parentPlaceId) : "", found.place.name].filter(Boolean).join(" · ");
}
export function placeOnMapPage(atlas: FacingAtlas, placeId: string, pageId: string): MapPlace | undefined {
  const visited = new Set<string>();
  let current = mapPlace(atlas, placeId);
  while (current && !visited.has(current.place.id)) {
    if (current.page.id === pageId) return current.place;
    visited.add(current.place.id);
    current = current.page.parentPlaceId ? mapPlace(atlas, current.page.parentPlaceId) : undefined;
  }
}
export function mapActivitySnapshot(atlas: FacingAtlas, snapshotId?: string): MapSnapshot | undefined {
  const saved = atlas.snapshots.find(item => item.id === snapshotId) ?? atlas.snapshots.at(-1);
  if (snapshotId || (!saved && !atlas.visits.length)) return saved;
  const entries = atlas.visits.filter(visit => visit.at >= (saved?.createdAt ?? "")).reduce((previous, visit) => [
    ...previous.filter(entry => !visit.characterIds.includes(entry.characterId)),
    ...visit.characterIds.map(characterId => ({ characterId, placeId: visit.placeId, activity: "和用户一起抵达这里", time: visit.at })),
  ], saved?.entries ?? []);
  return { id: saved?.id ?? "arrivals", createdAt: saved?.createdAt ?? atlas.updatedAt, entries: entries.filter(entry => mapResidentIds(atlas).includes(entry.characterId)) };
}
export async function saveMapPage(atlasId: string, page: FacingMapPage) {
  return updateFacingAtlas(atlasId, atlas => ({ ...atlas, pages: atlas.pages.map(item => item.id === page.id ? page : item) }));
}
export async function createMapInterior(atlasId: string, parent: MapPlace) {
  return updateFacingAtlas(atlasId, atlas => atlas.pages.some(page => page.parentPlaceId === parent.id) ? atlas : {
    ...atlas, pages: [...atlas.pages, { id: facingId(), parentPlaceId: parent.id, name: parent.name, description: parent.description, tiles: [], places: [], roads: [] }],
  });
}
export async function storeMapTile(file: Blob, position: MapPoint, logicalWidth = 1000): Promise<MapTile> {
  if (!file.type.startsWith("image/") || !file.size || file.size > 30 * 1024 * 1024) throw new Error("请选择不超过 30 MB 的地图图片。");
  const url = URL.createObjectURL(file);
  let width = 0, height = 0;
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("地图图片无法读取。")); image.src = url; });
    width = image.naturalWidth; height = image.naturalHeight;
  } finally { URL.revokeObjectURL(url); }
  if (!width || !height) throw new Error("地图图片尺寸无效。");
  const mediaId = await saveThemeAssetFromBlob(file, "facing_media");
  return { ...position, id: facingId(), mediaId, width: logicalWidth, height: logicalWidth * height / width, pixelWidth: width, pixelHeight: height };
}
export async function commitMapTile(atlasId: string, pageId: string, tile: MapTile, places: MapPlace[], description: string) {
  try {
    return await updateFacingAtlas(atlasId, atlas => {
      if (!atlas.pages.some(page => page.id === pageId)) throw new Error("地图已移除，请重新打开。");
      return { ...atlas, pages: atlas.pages.map(page => page.id !== pageId ? page : {
        ...page, description, tiles: [...page.tiles, tile], places: [...page.places, ...places],
      }) };
    });
  } catch (cause) { await deleteThemeAsset(tile.mediaId).catch(() => {}); throw cause; }
}
export function mapBounds(page: FacingMapPage) {
  const points = page.places;
  const left = Math.min(0, ...page.tiles.map(tile => tile.x), ...points.map(point => point.x - 60));
  const top = Math.min(0, ...page.tiles.map(tile => tile.y), ...points.map(point => point.y - 60));
  const right = Math.max(1000, ...page.tiles.map(tile => tile.x + tile.width), ...points.map(point => point.x + 60));
  const bottom = Math.max(700, ...page.tiles.map(tile => tile.y + tile.height), ...points.map(point => point.y + 60));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function mapBoundaryTile(page: FacingMapPage, direction: "left" | "right" | "top" | "bottom") {
  const edge = (tile: MapTile) => ({ left: -tile.x, right: tile.x + tile.width, top: -tile.y, bottom: tile.y + tile.height })[direction];
  return [...page.tiles].sort((a, b) => edge(b) - edge(a))[0];
}
export type MapRouteSegment = { pageId: string; points: MapPoint[] };
function routeLength(points: MapPoint[]) {
  return points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
}
export function mapRoute(page: FacingMapPage, fromId: string, toId: string): MapPoint[] | undefined {
  const from = page.places.find(place => place.id === fromId), to = page.places.find(place => place.id === toId);
  return from && to ? [from, to] : undefined;
}
function mapEntry(page: FacingMapPage): MapPoint {
  return page.places.find(place => place.id === page.entryPlaceId) ?? page.places[0] ?? { x: 500, y: 600 };
}
/** Straight movement on each displayed map. Legacy saved roads are not required or followed. */
export function mapJourneyRoute(atlas: FacingAtlas, fromId: string, toId: string): MapRouteSegment[] | undefined {
  const target = mapPlace(atlas, toId);
  if (!target) return;
  const start = mapPlace(atlas, fromId);
  if (!start) return [{ pageId: target.page.id, points: [mapEntry(target.page), target.place] }];
  function ancestors(page: FacingMapPage) {
    const result: FacingMapPage[] = [];
    const visited = new Set<string>();
    let current: FacingMapPage | undefined = page;
    while (current && !visited.has(current.id)) {
      visited.add(current.id); result.push(current);
      current = current.parentPlaceId ? mapPlace(atlas, current.parentPlaceId)?.page : undefined;
    }
    return result;
  }
  const sourcePages = ancestors(start.page), targetPages = ancestors(target.page);
  const common = sourcePages.find(page => targetPages.some(item => item.id === page.id));
  if (!common) return [{ pageId: start.page.id, points: [start.place, mapEntry(start.page)] },
    { pageId: target.page.id, points: [mapEntry(target.page), target.place] }];
  const sourceIndex = sourcePages.findIndex(page => page.id === common.id), targetIndex = targetPages.findIndex(page => page.id === common.id);
  const segments: MapRouteSegment[] = [];
  let point: MapPoint = start.place;
  for (const page of sourcePages.slice(0, sourceIndex)) {
    segments.push({ pageId: page.id, points: [point, mapEntry(page)] });
    point = mapPlace(atlas, page.parentPlaceId!)!.place;
  }
  const descending = targetPages.slice(0, targetIndex).reverse();
  segments.push({ pageId: common.id, points: [point, descending.length ? mapPlace(atlas, descending[0].parentPlaceId!)!.place : target.place] });
  for (let index = 0; index < descending.length; index++) {
    const page = descending[index], next = descending[index + 1];
    segments.push({ pageId: page.id, points: [mapEntry(page), next ? mapPlace(atlas, next.parentPlaceId!)!.place : target.place] });
  }
  return segments;
}
export function mapJourneyFrame(segments: MapRouteSegment[], progress: number) {
  if (!segments.length) return;
  const lengths = segments.map(segment => Math.max(80, routeLength(segment.points)));
  let left = lengths.reduce((sum, length) => sum + length, 0) * Math.max(0, Math.min(1, progress));
  for (let index = 0; index < segments.length; index++) {
    if (left < lengths[index] || index === segments.length - 1) {
      return { ...segments[index], progress: Math.max(0, Math.min(1, left / lengths[index])) };
    }
    left -= lengths[index];
  }
}

export function routePoint(points: MapPoint[], progress: number): MapPoint {
  if (!points.length) return { x: 0, y: 0 };
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  let left = lengths.reduce((sum, length) => sum + length, 0) * Math.min(1, Math.max(0, progress));
  for (let index = 0; index < lengths.length; index++) {
    if (left <= lengths[index] && lengths[index]) {
      const fraction = left / lengths[index];
      return { x: points[index].x + (points[index + 1].x - points[index].x) * fraction, y: points[index].y + (points[index + 1].y - points[index].y) * fraction };
    }
    left -= lengths[index];
  }
  return points.at(-1)!;
}

export async function saveMapArrival(atlasId: string, trip: MapTrip, visitId: string, characterId: string,
  identityId: string | null, participants: string[], scene: FacingScenePosition, previousMeeting?: FacingMeeting, seed?: FacingMeeting) {
  const now = new Date().toISOString();
  const atlas = loadFacingAtlas(atlasId);
  const target = atlas && mapPlace(atlas, trip.placeId);
  if (!atlas || !target) throw new Error("目的地已移除，请重新选择。");
  const destination = mapPlacePath(atlas, trip.placeId), names=Object.fromEntries(loadCharacters().map(item=>[item.id,item.name]));
  const roster=[...new Set([...trip.characterIds,...participants])];
  const arrival=facingArrival(visitId,trip.characterIds,roster), secret=arrival.companionIds.length?false:trip.secret;
  const meetingId=seed?.id??visitId;
  let result!:FacingMeeting;
  let repeatedVisit=false;
  const updates: Record<string, (raw: string | null) => string> = {
    [FACING_MEETING_PREFIX + meetingId]: raw => {
      const current=parse<FacingMeeting|undefined>(raw,seed);
      if(raw&&!current)throw new Error("当前见面记录已移除。");
      if(current?.deletedAt)throw new Error("当前见面记录已移除。");
      if(repeatedVisit){if(!current)throw new Error("原到达记录已移除，请重新前往。");result=current;return JSON.stringify(result);}
      if(raw&&(!seed||current?.mapContext?.arrival?.visitId===visitId)){
        if(current?.mapContext?.atlasId!==atlasId||current.mapContext.placeId!==trip.placeId)throw new Error("到达记录与当前目的地不一致，请重新前往。");
        result=current!;return JSON.stringify(result);
      }
      const priorRoster=current?facingParticipantIds(current):[];
      result={...current,id:meetingId,characterId,identityId,type:current?.type??"main",title:current?.title||destination,scene,
        participantIds:roster,groupId:current&&[...priorRoster].sort().join("|")===[...roster].sort().join("|")?current.groupId:undefined,
        participantHistoryIds:[...new Set([...(current?.participantHistoryIds??[]),...priorRoster,...roster])],
        createdAt:current?.createdAt??now,updatedAt:now,completedRounds:current?.completedRounds??0,
        sceneRevision:(current?.sceneRevision??0)+1,visual:undefined,
        mapContext:{atlasId,placeId:trip.placeId,participantIds:roster,secret,description:target.place.description,sceneName:scene.sceneName,arrival},
        turns:[...(current?.turns??[]).map(turn=>turn.participantIds?turn:{...turn,participantIds:priorRoster}),
          {...scene,id:`${visitId}:arrival`,role:"user",kind:"text",at:now,participantIds:roster,text:facingArrivalText(destination,arrival,names,secret)}],
      };
      return JSON.stringify(result);
    },
    [MAP_PREFIX + atlasId]: raw => {
      const current = parse<FacingAtlas | null>(raw, null);
      if (!current || !mapPlace(current, trip.placeId)) throw new Error("目的地已移除，请重新选择。");
      if (current.deletedVisitIds?.includes(visitId)) throw new Error("这条出行记录已删除，请重新前往。");
      const existing=current.visits.find(visit=>visit.id===visitId);
      if(existing){if(existing.placeId!==trip.placeId||existing.meetingId!==meetingId)throw new Error("到达记录与当前目的地不一致，请重新前往。");repeatedVisit=true;return JSON.stringify(current);}
      return JSON.stringify({ ...current, updatedAt: now, userPlaces: { ...current.userPlaces, [identityId ?? "default"]: trip.placeId },
        visits: [...current.visits, { id: visitId, identityId, placeId: trip.placeId, characterIds: arrival.companionIds, secret, at: now, meetingId }] });
    },
  };
  if (previousMeeting && previousMeeting.id !== meetingId) updates[FACING_MEETING_PREFIX + previousMeeting.id] = raw =>
    JSON.stringify({ ...parse(raw, previousMeeting), pausedAt: now });
  // Check the durable visit before updating the meeting so a delayed retry cannot rewind a later trip.
  await kvUpdatePersistedEntries({[MAP_PREFIX+atlasId]:updates[MAP_PREFIX+atlasId],...updates});
  return result;
}
