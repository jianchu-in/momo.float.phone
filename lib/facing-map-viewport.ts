import { mapBounds, type FacingMapPage } from "./facing-map-storage";
export type MapView = { x: number; y: number; scale: number };
export function mapImageBounds(page: FacingMapPage) {
  if (!page.tiles.length) return mapBounds(page);
  const x = Math.min(...page.tiles.map(tile => tile.x)), y = Math.min(...page.tiles.map(tile => tile.y));
  return { x, y, width: Math.max(...page.tiles.map(tile => tile.x + tile.width)) - x,
    height: Math.max(...page.tiles.map(tile => tile.y + tile.height)) - y };
}
export function coverMapView(view: MapView, size: { width: number; height: number }, bounds: ReturnType<typeof mapImageBounds>): MapView {
  const minimum = Math.max(size.width / bounds.width, size.height / bounds.height);
  const scale = Math.max(minimum, Math.min(Math.max(8, minimum * 8), view.scale));
  return { scale,
    x: Math.max(size.width - (bounds.x + bounds.width) * scale, Math.min(-bounds.x * scale, view.x)),
    y: Math.max(size.height - (bounds.y + bounds.height) * scale, Math.min(-bounds.y * scale, view.y)) };
}
