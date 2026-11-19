import { updateFacingAtlas, type FacingAtlas, type FacingMapPage, type MapPlace, type MapTile } from "./facing-map-storage";

/** Older maps have no tile ownership. The first image is painted on top. */
export function tileForPlace(page: FacingMapPage, place: MapPlace) {
  return page.tiles.find(tile => tile.id === place.tileId) ?? page.tiles.find(tile =>
    place.x >= tile.x && place.x <= tile.x + tile.width && place.y >= tile.y && place.y <= tile.y + tile.height);
}
export function placesForTile(page: FacingMapPage, tileId: string) {
  return page.places.filter(place => tileForPlace(page, place)?.id === tileId);
}
export function transformMapTile(page: FacingMapPage, id: string, patch: Pick<MapTile, "x" | "y" | "width" | "height"> & Partial<Pick<MapTile, "name" | "description">>): FacingMapPage {
  const original = page.tiles.find(tile => tile.id === id);
  if (!original) throw new Error("这个图块已移除。");
  if (![patch.x, patch.y, patch.width, patch.height].every(Number.isFinite) || patch.width <= 0 || patch.height <= 0) {
    throw new Error("请填写有效的坐标和大于零的宽高。");
  }
  const owned = new Set(placesForTile(page, id).map(place => place.id));
  return { ...page, tiles: page.tiles.map(tile => tile.id === id ? { ...tile, ...patch } : tile),
    places: page.places.map(place => owned.has(place.id) ? { ...place, tileId: id,
      x: patch.x + (place.x - original.x) / original.width * patch.width,
      y: patch.y + (place.y - original.y) / original.height * patch.height } : place) };
}
/** Remove nested maps and every live reference to removed locations in one write. */
export function removeMapPlaces(atlas: FacingAtlas, ids: Iterable<string>): FacingAtlas {
  const removed = new Set(ids);
  for (let size = -1; size !== removed.size;) {
    size = removed.size;
    for (const page of atlas.pages) if (page.parentPlaceId && removed.has(page.parentPlaceId)) {
      page.places.forEach(place => removed.add(place.id));
    }
  }
  return { ...atlas,
    pages: atlas.pages.filter(page => !page.parentPlaceId || !removed.has(page.parentPlaceId)).map(page => ({ ...page,
      places: page.places.filter(place => !removed.has(place.id)),
      entryPlaceId: page.entryPlaceId && removed.has(page.entryPlaceId) ? undefined : page.entryPlaceId,
      roads: page.roads.filter(road => !removed.has(road.from) && !removed.has(road.to)) })),
    userPlaces: Object.fromEntries(Object.entries(atlas.userPlaces).filter(([, id]) => !removed.has(id))),
    snapshots: atlas.snapshots.map(snapshot => ({ ...snapshot, entries: snapshot.entries.filter(entry => !removed.has(entry.placeId)) })),
    invitations: atlas.invitations.filter(invitation => !removed.has(invitation.placeId)),
    visits: atlas.visits.filter(visit => !removed.has(visit.placeId)) };
}
export async function editMapTile(atlasId: string, pageId: string, tile: MapTile, order?: "front" | "back") {
  return updateFacingAtlas(atlasId, atlas => {
    if (!atlas.pages.some(page => page.id === pageId)) throw new Error("地图已移除。");
    return { ...atlas, pages: atlas.pages.map(page => {
      if (page.id !== pageId) return page;
      const next = transformMapTile(page, tile.id, tile);
      if (order) {
        const selected = next.tiles.find(item => item.id === tile.id)!;
        const others = next.tiles.filter(item => item.id !== tile.id);
        next.tiles = order === "front" ? [selected, ...others] : [...others, selected];
      }
      return next;
    }) };
  });
}
export async function removeMapTile(atlasId: string, pageId: string, tileId: string, removePlaces: boolean) {
  return updateFacingAtlas(atlasId, atlas => {
    const page = atlas.pages.find(item => item.id === pageId);
    if (!page?.tiles.some(tile => tile.id === tileId)) throw new Error("图块已移除。");
    const next = removePlaces ? removeMapPlaces(atlas, placesForTile(page, tileId).map(place => place.id)) : atlas;
    return { ...next, pages: next.pages.map(item => item.id === pageId ? { ...item,
      tiles: item.tiles.filter(tile => tile.id !== tileId),
      places: item.places.map(place => place.tileId === tileId ? { ...place, tileId: undefined } : place) } : item) };
  });
}
export async function replaceMapTile(atlasId: string, pageId: string, tile: MapTile, places: MapPlace[]) {
  return updateFacingAtlas(atlasId, current => {
    const fresh = current.pages.find(item => item.id === pageId);
    if (!fresh?.tiles.some(item => item.id === tile.id)) throw new Error("原图块已移除，请重新选择。");
    transformMapTile(fresh, tile.id, tile); // Validate geometry before altering existing data.
    const owned = new Set(placesForTile(fresh, tile.id).map(place => place.id));
    const kept = new Set(places.map(place => place.id));
    if (kept.size !== places.length || fresh.places.some(place => !owned.has(place.id) && kept.has(place.id))) throw new Error("地点ID重复，请重新打开图块。");
    const cleaned = removeMapPlaces(current, [...owned].filter(id => !kept.has(id)));
    return { ...cleaned, pages: cleaned.pages.map(page => page.id !== pageId ? page : { ...page,
      tiles: page.tiles.map(item => item.id === tile.id ? tile : item),
      places: [...page.places.filter(place => !owned.has(place.id)), ...places.map(place => ({ ...place, tileId: tile.id }))] }) };
  });
}
