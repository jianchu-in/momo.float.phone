import { facingId } from "./facing-storage";
import type { MapPlace, MapTile } from "./facing-map-storage";
import { kvGet, kvUpdatePersisted, registerKvMigration } from "./kv-db";

export const MAP_PLANS_KEY = "ai_phone_facing_map_plans_v1";
export const MAP_VIEW_KEY = "ai_phone_facing_map_view_v1";
registerKvMigration(MAP_PLANS_KEY);
registerKvMigration(MAP_VIEW_KEY);
export type SavedMapPlan = { id: string; worldId: string; name: string; description: string; places: MapPlace[]; width: number; height: number; updatedAt: string };
export type PlanContent = Pick<SavedMapPlan, "description" | "places">;

function parse<T>(raw: string | null, fallback: T): T { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
export function validateMapPlan(plan: PlanContent) {
  if (!plan.description.trim()) throw new Error("请先生成或填写地图画面描述。");
  if (plan.places.some(place => !place.name.trim() || ![place.x, place.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1000))) {
    throw new Error("请填写地点名称与0到1000之间的有效坐标。");
  }
}
export function loadMapPlans(worldId: string): SavedMapPlan[] {
  return parse<SavedMapPlan[]>(kvGet(MAP_PLANS_KEY), []).filter(item => item.worldId === worldId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function saveMapPlan(input: Omit<SavedMapPlan, "id" | "updatedAt"> & { id?: string }) {
  validateMapPlan(input);
  if (!input.name.trim() || ![input.width, input.height].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("请填写方案名称与有效的图片宽高。");
  const saved: SavedMapPlan = { ...input, id: input.id || facingId(), name: input.name.trim(),
    places: input.places.map(place => ({ ...place })), updatedAt: new Date().toISOString() };
  await kvUpdatePersisted(MAP_PLANS_KEY, raw => {
    const all = parse<SavedMapPlan[]>(raw, []);
    return JSON.stringify([saved, ...all.filter(item => item.id !== saved.id)]);
  });
  return saved;
}
export function formatMapPlan(plan: PlanContent, size: { width: number; height: number }) {
  validateMapPlan(plan);
  return [`地图画面描述\n${plan.description}`, `图片尺寸：${size.width} × ${size.height} 像素`,
    "地点清单与坐标（左上角为原点，X/Y归一化至0—1000；请按这些位置绘制，图片不要添加头像或界面按钮）",
    ...plan.places.map((place, index) => `${index + 1}. ${place.name} | X=${place.x}, Y=${place.y}\n${place.description}`)].join("\n\n");
}
/** Both uploaded and model-generated images use the same normalized plan coordinates. */
export function mapPlanPlaces(plan: PlanContent, tile: MapTile, keepIds = false): MapPlace[] {
  validateMapPlan(plan);
  return plan.places.map(place => ({ ...place, id: keepIds ? place.id : facingId(), tileId: tile.id,
    x: tile.x + place.x / 1000 * tile.width, y: tile.y + place.y / 1000 * tile.height }));
}
export function loadMapViewMode(): "fit" | "cover" { return kvGet(MAP_VIEW_KEY) === "cover" ? "cover" : "fit"; }
export async function saveMapViewMode(mode: "fit" | "cover") { await kvUpdatePersisted(MAP_VIEW_KEY, () => mode); }
