import { throwIfAborted } from "./abort-utils";
import { facingId } from "./facing-storage";
import { kvGet, kvKeysWithPrefix, kvUpdatePersisted, registerDynamicPrefix } from "./kv-db";
import { getThemeAssetDataUrl, deleteThemeAsset } from "./theme-storage";
import { createFacingAtlas, loadFacingAtlas, mapBounds, mapPlace, storeMapTile, updateFacingAtlas,
  type FacingAtlas, type FacingMapPage, type MapPlace, type MapTile } from "./facing-map-storage";
import type { MapTemplateTarget } from "./facing-map-templates";

const PREFIX = "ai_phone_facing_map_template_v1:";
registerDynamicPrefix(PREFIX);
export type MapPackage = { format: "facing-map"; version: 1; kind: "atlas" | "place" | "template";
  name: string; description: string; rootPlace?: MapPlace; pages: FacingMapPage[]; images: Record<string, string> };
export type SavedMapTemplate = Omit<MapPackage, "format" | "version" | "kind" | "images"> & { id: string };
export function loadCustomMapTemplates(): SavedMapTemplate[] {
  return kvKeysWithPrefix(PREFIX).flatMap(key => {
    try { const raw = kvGet(key); return raw ? [JSON.parse(raw) as SavedMapTemplate] : []; } catch { return []; }
  });
}
export async function deleteCustomMapTemplate(id: string) { await kvUpdatePersisted(PREFIX + id, () => ""); }
function nestedPages(atlas: FacingAtlas, rootId: string) {
  const ids = new Set([rootId]), pages = new Set<string>();
  for (let count = -1; count !== ids.size;) {
    count = ids.size;
    for (const page of atlas.pages) if (page.parentPlaceId && ids.has(page.parentPlaceId)) {
      pages.add(page.id); page.places.forEach(place => ids.add(place.id));
    }
  }
  return atlas.pages.filter(page => pages.has(page.id));
}
async function packageImages(pages: FacingMapPage[], signal: AbortSignal) {
  const images: Record<string, string> = {};
  for (const tile of pages.flatMap(page => page.tiles)) {
    throwIfAborted(signal);
    if (!images[tile.mediaId]) {
      const source = await getThemeAssetDataUrl(tile.mediaId);
      if (!source) throw new Error("部分地图原图已丢失，请补齐后再导出。");
      images[tile.mediaId] = source;
    }
  }
  return images;
}
export async function exportMapPackage(atlas: FacingAtlas, signal: AbortSignal, placeId?: string): Promise<MapPackage> {
  const place = placeId ? mapPlace(atlas, placeId)?.place : undefined;
  if (placeId && !place) throw new Error("找不到要导出的地点。");
  const pages = place ? nestedPages(atlas, place.id) : atlas.pages;
  return { format: "facing-map", version: 1, kind: place ? "place" : "atlas", name: place?.name ?? atlas.name,
    description: place?.description ?? pages[0]?.description ?? "", rootPlace: place,
    pages, images: await packageImages(pages, signal) };
}
export async function exportCustomMapTemplate(template: SavedMapTemplate, signal: AbortSignal): Promise<MapPackage> {
  return { ...template, format: "facing-map", version: 1, kind: "template", images: await packageImages(template.pages, signal) };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("地图文件结构无效。");
  return value as Record<string, unknown>;
}
function string(value: unknown, limit = 100000) {
  if (typeof value !== "string" || value.length > limit) throw new Error("地图文件的文字字段无效或过长。");
  return value;
}
function number(value: unknown, positive = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e7 || (positive && value <= 0)) throw new Error("地图文件的坐标或尺寸无效。");
  return value;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("地图文件中的项目数量无效。");
  return value;
}
/** Rebuild only known fields; validate the complete graph before saving any media. */
export async function readMapPackage(file: File, signal: AbortSignal): Promise<MapPackage> {
  if (file.size > 150 * 1024 * 1024) throw new Error("地图文件过大，请导入不超过 150 MB 的 JSON 文件。");
  const data = object(JSON.parse(await file.text())); throwIfAborted(signal);
  if (data.format !== "facing-map" || data.version !== 1 || !["atlas", "place", "template"].includes(String(data.kind))) throw new Error("这不是受支持的地图或场所模板文件。");
  const unique = new Set<string>();
  function id(value: unknown) { const result = string(value, 200); if (!result || unique.has(result)) throw new Error("地图文件存在重复或空白 ID。"); unique.add(result); return result; }
  function place(value: unknown): MapPlace {
    const p = object(value); return { id: id(p.id), name: string(p.name, 200), description: string(p.description),
      x: number(p.x), y: number(p.y), ...(p.tileId ? { tileId: string(p.tileId, 200) } : {}) };
  }
  const rootPlace = data.rootPlace ? place(data.rootPlace) : undefined;
  const images = object(data.images), cleanImages: Record<string, string> = Object.create(null);
  const pages = list(data.pages, 200).map(value => {
    const p = object(value);
    const tiles = list(p.tiles, 500).map(value => {
      const t = object(value), mediaId = string(t.mediaId, 200), source = images[mediaId];
      if (typeof source !== "string" || source.length > 42 * 1024 * 1024 || !/^data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+$/.test(source)) throw new Error("地图文件缺少有效的图片原图。");
      cleanImages[mediaId] = source;
      return { id: id(t.id), mediaId, x: number(t.x), y: number(t.y), width: number(t.width, true), height: number(t.height, true),
        pixelWidth: number(t.pixelWidth, true), pixelHeight: number(t.pixelHeight, true),
        ...(t.name !== undefined ? { name: string(t.name, 200) } : {}), ...(t.description !== undefined ? { description: string(t.description) } : {}) };
    });
    const places = list(p.places, 10000).map(place);
    if (places.some(place => place.tileId && !tiles.some(tile => tile.id === place.tileId))) throw new Error("地点关联了不存在的图块。");
    const entryPlaceId = p.entryPlaceId ? string(p.entryPlaceId, 200) : undefined;
    if (entryPlaceId && !places.some(place => place.id === entryPlaceId)) throw new Error("地图入口不存在。");
    return { id: id(p.id), name: string(p.name, 200), description: string(p.description),
      parentPlaceId: p.parentPlaceId ? string(p.parentPlaceId, 200) : undefined, entryPlaceId, tiles, places, roads: [] } satisfies FacingMapPage;
  });
  if (pages.reduce((sum, page) => sum + page.tiles.length, 0) > 1000 || pages.reduce((sum, page) => sum + page.places.length, 0) > 20000) throw new Error("地图文件内容过多，请分场所导入。");
  const kind = data.kind as MapPackage["kind"];
  const roots = pages.filter(page => !page.parentPlaceId);
  if (kind === "atlas" ? roots.length !== 1 || !!rootPlace : !rootPlace || roots.length > 0) throw new Error("地图文件的根节点无效。");
  const reachable = new Set(rootPlace ? [rootPlace.id] : []), done = new Set<string>(), parents = new Set<string>();
  for (let count = -1; count !== done.size;) {
    count = done.size;
    for (const page of pages) if (!done.has(page.id) && (!page.parentPlaceId || reachable.has(page.parentPlaceId))) {
      if (page.parentPlaceId && parents.has(page.parentPlaceId)) throw new Error("一个地点存在重复的内部地图。");
      if (page.parentPlaceId) parents.add(page.parentPlaceId);
      done.add(page.id); page.places.forEach(place => reachable.add(place.id));
    }
  }
  if (done.size !== pages.length) throw new Error("地图文件存在循环或失效的内部地图关联。");
  return { format: "facing-map", version: 1, kind, name: string(data.name, 200), description: string(data.description), rootPlace, pages, images: cleanImages };
}
function cloneLayout(pages: FacingMapPage[], rootPlace?: MapPlace) {
  const ids = new Map<string, string>();
  for (const page of pages) { ids.set(page.id, facingId()); for (const item of [...page.tiles, ...page.places]) ids.set(item.id, facingId()); }
  if (rootPlace) ids.set(rootPlace.id, facingId());
  const clonePlace = (place: MapPlace): MapPlace => ({ ...place, id: ids.get(place.id)!, tileId: place.tileId ? ids.get(place.tileId) : undefined });
  return { rootPlace: rootPlace ? clonePlace(rootPlace) : undefined, pages: pages.map(page => ({ ...page, id: ids.get(page.id)!,
    parentPlaceId: page.parentPlaceId ? ids.get(page.parentPlaceId) : undefined, entryPlaceId: page.entryPlaceId ? ids.get(page.entryPlaceId) : undefined,
    tiles: page.tiles.map(tile => ({ ...tile, id: ids.get(tile.id)! })), places: page.places.map(clonePlace), roads: [] })) };
}
async function withImportedMedia<T>(data: MapPackage, signal: AbortSignal, save: (pages: FacingMapPage[]) => Promise<T>): Promise<T> {
  const media = new Map<string, MapTile>();
  try {
    for (const [id, source] of Object.entries(data.images)) {
      throwIfAborted(signal);
      const blob = await (await fetch(source, { signal })).blob();
      const tile = await storeMapTile(blob, { x: 0, y: 0 }); media.set(id, tile);
    }
    throwIfAborted(signal);
    const pages = data.pages.map(page => ({ ...page, tiles: page.tiles.map(tile => ({ ...tile, mediaId: media.get(tile.mediaId)!.mediaId,
      pixelWidth: media.get(tile.mediaId)!.pixelWidth, pixelHeight: media.get(tile.mediaId)!.pixelHeight })) }));
    return await save(pages);
  } catch (cause) { await Promise.allSettled([...media.values()].map(tile => deleteThemeAsset(tile.mediaId))); throw cause; }
}
export async function importMapPackage(data: MapPackage, worldId: string, characterIds: string[], signal: AbortSignal, asTemplate = data.kind !== "atlas") {
  return withImportedMedia(data, signal, async pages => {
    const cloned = cloneLayout(pages, data.rootPlace);
    if (asTemplate) {
      const rootPlace = cloned.rootPlace ?? { id: facingId(), name: data.name, description: data.description, x: 0, y: 0 };
      const template: SavedMapTemplate = { id: facingId(), name: data.name, description: data.description, rootPlace,
        pages: cloned.pages.map(page => !page.parentPlaceId ? { ...page, parentPlaceId: rootPlace.id } : page) };
      throwIfAborted(signal);
      await kvUpdatePersisted(PREFIX + template.id, () => JSON.stringify(template));
      return { template };
    }
    if (data.kind !== "atlas") throw new Error("请将详细场所文件导入为模板。");
    const sorted = [...cloned.pages].sort((a, b) => Number(!!a.parentPlaceId) - Number(!!b.parentPlaceId));
    throwIfAborted(signal);
    return { atlas: await createFacingAtlas(worldId, data.name, characterIds, [], sorted) };
  });
}
export async function installCustomMapTemplate(atlasId: string, templateId: string, target: MapTemplateTarget, signal: AbortSignal) {
  const template = loadCustomMapTemplates().find(item => item.id === templateId);
  if (!template || !loadFacingAtlas(atlasId)) throw new Error("找不到场所模板或地图。");
  const cloned = cloneLayout(template.pages, template.rootPlace);
  const root = cloned.rootPlace!;
  let pageId = "";
  const atlas = await updateFacingAtlas(atlasId, current => {
    throwIfAborted(signal);
    let pages = [...current.pages], targetPage: FacingMapPage | undefined, parentId: string | undefined;
    if (target.type === "page") targetPage = pages.find(page => page.id === target.pageId);
    else if (target.type === "place") {
      if (!mapPlace(current, target.placeId)) throw new Error("地点已移除。");
      parentId = target.placeId; targetPage = pages.find(page => page.parentPlaceId === parentId);
    } else {
      const outer = pages.find(page => page.id === target.pageId);
      if (!outer) throw new Error("外层地图已移除。");
      const bounds = mapBounds(outer);
      parentId = facingId();
      pages = pages.map(page => page.id === outer.id ? { ...page, places: [...page.places, { ...root, id: parentId!, name: target.name.trim() || template.name,
        tileId: undefined, x: bounds.x + bounds.width + 100, y: bounds.y + bounds.height / 2 }] } : page);
    }
    if (target.type === "page" && !targetPage) throw new Error("地图已移除。");
    if (targetPage && (targetPage.tiles.length || targetPage.places.length)) throw new Error("这里已有地图内容，请选择空白地图或新增模板地点。");
    const rootPage = cloned.pages.find(page => page.parentPlaceId === root.id) ?? { id: facingId(), name: template.name, description: template.description, tiles: [], places: [], roads: [] };
    pageId = targetPage?.id ?? rootPage.id;
    const installedRoot = { ...rootPage, id: pageId, name: targetPage?.name
      ?? pages.flatMap(page => page.places).find(place => place.id === parentId)?.name ?? template.name,
      parentPlaceId: targetPage?.parentPlaceId ?? parentId };
    pages = pages.filter(page => page.id !== pageId);
    // Keep a world map first so the main entry always opens the world map.
    if (!installedRoot.parentPlaceId) pages.unshift(installedRoot); else pages.push(installedRoot);
    pages.push(...cloned.pages.filter(page => page.id !== rootPage.id));
    return { ...current, pages };
  });
  return { atlas, pageId };
}
