import { kvGet, kvKeysWithPrefix, kvUpdatePersisted, kvUpdatePersistedEntries, registerDynamicPrefix, registerKvMigration } from "./kv-db";
import { facingId, FACING_MEETING_PREFIX, type FacingMeeting, type FacingScenePosition } from "./facing-storage";
import { deleteThemeAsset, saveThemeAssetFromBlob } from "./theme-storage";

const MAP_PREFIX = "ai_phone_facing_map_v1:";
export const FACING_MAP_SETTINGS_KEY = "ai_phone_facing_map_settings_v1";
registerDynamicPrefix(MAP_PREFIX);
registerKvMigration(FACING_MAP_SETTINGS_KEY);

export type MapPoint = { x: number; y: number };
export type MapPlace = MapPoint & { id: string; name: string; description: string };
export type MapTile = MapPoint & { id: string; mediaId: string; width: number; height: number; pixelWidth: number; pixelHeight: number };
export type MapRoad = { id: string; from: string; to: string; points: MapPoint[] };
export type FacingMapPage = {
  id: string;
  parentPlaceId?: string;
  name: string;
  description: string;
  tiles: MapTile[];
  places: MapPlace[];
  roads: MapRoad[];
};
export type MapActivity = { characterId: string; placeId: string; activity: string; time: string };
export type MapSnapshot = { id: string; createdAt: string; entries: MapActivity[] };
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
  userPlaces: Record<string, string>; createdAt: string; updatedAt: string;
};
export type MapPreferences = {
  descriptionPrompt: string; imagePrompt: string; width: number; height: number;
  animation: "route" | "car"; line: "solid" | "dashed"; duration: number;
};
const DEFAULTS: MapPreferences = { descriptionPrompt: "", imagePrompt: "", width: 1024, height: 1024, animation: "car", line: "dashed", duration: 4 };
function parse<T>(raw: string | null, fallback: T): T {
  try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
export function loadMapPreferences(): MapPreferences {
  return { ...DEFAULTS, ...parse<Partial<MapPreferences>>(kvGet(FACING_MAP_SETTINGS_KEY), {}) };
}
export async function saveMapPreferences(patch: Partial<MapPreferences>) {
  await kvUpdatePersisted(FACING_MAP_SETTINGS_KEY, raw => JSON.stringify({ ...DEFAULTS, ...parse(raw, {}), ...patch }));
}
export function loadFacingAtlas(id: string) {
  return parse<FacingAtlas | null>(kvGet(MAP_PREFIX + id), null);
}
export function loadFacingAtlases(worldId: string) {
  return kvKeysWithPrefix(MAP_PREFIX).map(key => parse<FacingAtlas | null>(kvGet(key), null))
    .filter((atlas): atlas is FacingAtlas => !!atlas && atlas.worldId === worldId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function updateFacingAtlas(id: string, update: (atlas: FacingAtlas) => FacingAtlas) {
  let result: FacingAtlas | undefined;
  await kvUpdatePersisted(MAP_PREFIX + id, raw => {
    const current = parse<FacingAtlas | null>(raw, null);
    if (!current) throw new Error("找不到这张地图。");
    result = { ...update(current), updatedAt: new Date().toISOString() };
    return JSON.stringify(result);
  });
  return result!;
}
export async function createFacingAtlas(worldId: string, name: string, characterIds: string[], worldBookIds: string[]) {
  const now = new Date().toISOString();
  const atlas: FacingAtlas = { id: facingId(), worldId, name, characterIds, worldBookIds,
    pages: [{ id: facingId(), name, description: "", tiles: [], places: [], roads: [] }],
    snapshots: [], invitations: [], visits: [], userPlaces: {}, createdAt: now, updatedAt: now };
  await kvUpdatePersisted(MAP_PREFIX + atlas.id, () => JSON.stringify(atlas));
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
  const entries = atlas.visits.filter(visit => visit.at > (saved?.createdAt ?? "")).reduce((previous, visit) => [
    ...previous.filter(entry => !visit.characterIds.includes(entry.characterId)),
    ...visit.characterIds.map(characterId => ({ characterId, placeId: visit.placeId, activity: "和用户一起抵达这里", time: visit.at })),
  ], saved?.entries ?? []);
  return { id: saved?.id ?? "arrivals", createdAt: saved?.createdAt ?? atlas.updatedAt, entries };
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
  const points = [...page.places, ...page.roads.flatMap(road => road.points)];
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
export function mapRoute(page: FacingMapPage, fromId: string, toId: string): MapPoint[] | undefined {
  if (fromId === toId) { const found = page.places.find(place => place.id === toId); return found ? [found] : undefined; }
  const distance = new Map<string, number>([[fromId, 0]]);
  const previous = new Map<string, { id: string; path: MapPoint[] }>();
  const remaining = new Set(page.places.map(place => place.id));
  while (remaining.size) {
    const next = [...remaining].sort((a, b) => (distance.get(a) ?? Infinity) - (distance.get(b) ?? Infinity))[0];
    if (!Number.isFinite(distance.get(next))) break;
    remaining.delete(next);
    if (next === toId) {
      const result: MapPoint[][] = [];
      let current = toId;
      while (previous.has(current)) {
        const entry = previous.get(current)!;
        result.unshift(entry.path); current = entry.id;
      }
      return result.flat();
    }
    for (const road of page.roads.filter(item => item.from === next || item.to === next)) {
      const reverse = road.to === next;
      const target = reverse ? road.from : road.to;
      const a = page.places.find(place => place.id === road.from), b = page.places.find(place => place.id === road.to);
      if (!a || !b) continue;
      const path = [a, ...road.points, b];
      if (reverse) path.reverse();
      const length = path.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - path[index].x, point.y - path[index].y), 0);
      const candidate = distance.get(next)! + length;
      if (candidate < (distance.get(target) ?? Infinity)) { distance.set(target, candidate); previous.set(target, { id: next, path }); }
    }
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
  identityId: string | null, participants: string[], scene: FacingScenePosition, previousMeeting?: FacingMeeting) {
  const now = new Date().toISOString();
  const atlas = loadFacingAtlas(atlasId);
  const target = atlas && mapPlace(atlas, trip.placeId);
  if (!atlas || !target) throw new Error("目的地已移除，请重新选择。");
  const destination = mapPlacePath(atlas, trip.placeId);
  let result: FacingMeeting = {
    id: visitId, characterId, identityId, type: "main", title: destination, scene,
    createdAt: now, updatedAt: now, completedRounds: 0,
    mapContext: { atlasId, placeId: trip.placeId, participantIds: participants, secret: trip.secret, description: target.place.description },
    turns: [{ ...scene, id: facingId(), role: "user", kind: "text", at: now,
      text: trip.secret ? `（悄悄来到${destination}，暂时在一旁观察。）` : `（来到${destination}。）` }],
  };
  const updates: Record<string, (raw: string | null) => string> = {
    [FACING_MEETING_PREFIX + visitId]: raw => { result = parse(raw, result); return JSON.stringify(result); },
    [MAP_PREFIX + atlasId]: raw => {
      const current = parse<FacingAtlas | null>(raw, null);
      if (!current || !mapPlace(current, trip.placeId)) throw new Error("目的地已移除，请重新选择。");
      if (current.visits.some(visit => visit.id === visitId)) return JSON.stringify(current);
      return JSON.stringify({ ...current, updatedAt: now, userPlaces: { ...current.userPlaces, [identityId ?? "default"]: trip.placeId },
        visits: [...current.visits, { id: visitId, identityId, placeId: trip.placeId, characterIds: trip.characterIds, secret: trip.secret, at: now, meetingId: visitId }] });
    },
  };
  if (previousMeeting && previousMeeting.id !== visitId) updates[FACING_MEETING_PREFIX + previousMeeting.id] = raw =>
    JSON.stringify({ ...parse(raw, previousMeeting), pausedAt: now });
  await kvUpdatePersistedEntries(updates);
  return result;
}
