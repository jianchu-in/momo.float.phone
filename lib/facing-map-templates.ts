import { throwIfAborted } from "./abort-utils";
import { facingId } from "./facing-storage";
import { loadFacingAtlas, mapBounds, mapPlace, storeMapTile, updateFacingAtlas, type FacingMapPage } from "./facing-map-storage";
import { deleteThemeAsset } from "./theme-storage";

/** Coordinates are percentages of the original image, independent of display zoom. */
export type MapTemplatePlace = { key: string; name: string; description: string; x: number; y: number };
export type BuiltinMapTemplate = { id: string; name: string; summary: string; image: string; thumbnail: string; entryKey: string; places: MapTemplatePlace[] };
const place = (key: string, name: string, x: number, y: number, description: string): MapTemplatePlace => ({ key, name, x, y, description });
const asset = (id: string) => ({ image: `/facing-map-templates/${id}.png`, thumbnail: `/facing-map-templates/previews/${id}.webp` });
export const BUILTIN_MAP_TEMPLATES: readonly BuiltinMapTemplate[] = [
  { id: "mall", name: "经典商场", summary: "一张分区平面图，集合购物、美食、甜品、电玩城与电影院。", ...asset("mall"), entryKey: "entry", places: [
    place("entry", "商场入口", 50, 89, "商场正门和入口大厅，可在这里会合、等人或开始逛街。"),
    place("atrium", "中庭", 50, 49, "明亮的公共中庭，连接两侧店铺与各个分区，设有休息空间。"),
    place("clothing", "服装店", 18, 25, "陈列日常服饰、配件和搭配单品，可以挑选衣服、试穿或一起讨论穿搭。"),
    place("food", "美食餐厅", 40, 25, "商场里的用餐分区，有餐桌和餐饮柜台，适合一起吃饭、休息。"),
    place("arcade", "电玩城", 62, 25, "街机、抓娃娃机和互动游戏集中在这里，可以一起玩游戏或挑战得分。"),
    place("cinema", "电影院", 82, 25, "商场内的电影院，设有银幕和观影座椅，可以约好场次后一起看电影。"),
    place("dessert", "甜品店", 16, 71, "玻璃柜里摆着蛋糕和甜点，适合分享甜品、庆祝或慢慢聊天。"),
    place("cafe", "咖啡奶茶店", 35, 71, "提供咖啡、奶茶等饮品，有座位可以歇脚、等人。"),
    place("service", "服务休息区", 65, 71, "服务台和休息沙发所在的区域，可以问路、稍作等待。"),
    place("toilet", "洗手间", 84, 71, "商场公共洗手间和洗手台。"),
  ] },
  { id: "amusement-park", name: "经典游乐园", summary: "过山车、摩天轮、旋转木马和花园等通用约会地点。", ...asset("amusement-park"), entryKey: "entry", places: [
    place("entry", "游乐园入口", 49, 92, "游乐园检票入口，可以在这里集合、买票并决定先玩什么。"),
    place("plaza", "喷泉广场", 49, 53, "园区中央的喷泉广场，适合拍照、休息和约定会合。"),
    place("coaster", "过山车", 22, 25, "轨道盘旋的刺激项目，可一起排队、乘坐或在一旁等待。"),
    place("carousel", "旋转木马", 49, 20, "柔和色彩的旋转木马，适合轻松游玩和拍照。"),
    place("wheel", "摩天轮", 80, 22, "可以俯瞰园区的摩天轮，适合一起观景、看日落。"),
    place("cars", "碰碰车", 18, 49, "室内棚下的碰碰车场地，可以来一场轻松的追逐。"),
    place("lake", "游船湖", 82, 50, "平静的小湖和游船，适合慢慢划船、聊天。"),
    place("garden", "花园", 62, 35, "园区里安静的花园，沿着花径散步或短暂停留。"),
    place("gift", "纪念品店", 24, 72, "出售玩偶和园区纪念品，可以挑选礼物。"),
    place("snack", "小食饮品区", 81, 72, "售卖冰淇淋、小吃和饮品，设有休息座位。"),
    place("toilet", "洗手间", 61, 74, "园区公共洗手间。"),
  ] },
  { id: "seaside", name: "通用海边", summary: "沙滩、栈桥、灯塔、海边餐厅与休闲设施。", ...asset("seaside"), entryKey: "entry", places: [
    place("entry", "海边入口", 50, 93, "从这里抵达海边休闲区，沿步道可以走向沙滩。"),
    place("promenade", "滨海步道", 50, 64, "沿海延伸的步道，连接咖啡店、餐厅与沙滩入口。"),
    place("beach", "沙滩入口", 50, 55, "从步道通向细沙的入口，可以脱鞋、整理物品再走向海边。"),
    place("shore", "海岸线", 50, 35, "海浪轻轻漫过浅滩，适合散步、看海或玩水。"),
    place("umbrella", "遮阳休息区", 26, 47, "沙滩遮阳伞和躺椅，可以在这里休息、吹海风。"),
    place("volleyball", "沙滩排球场", 71, 48, "沙地上的排球活动区，可以一起运动。"),
    place("lighthouse", "灯塔观景台", 12, 24, "礁岸旁的小灯塔和观景位置，适合远眺海面。"),
    place("pier", "海上栈桥", 84, 17, "木栈桥伸向海面，可以看海、听浪、拍照。"),
    place("cafe", "海边咖啡店", 19, 77, "带有户外桌椅的海边咖啡店，适合闲坐。"),
    place("rental", "冲浪租赁店", 36, 72, "提供沙滩与冲浪用品租赁的小店。"),
    place("shower", "更衣淋浴间", 62, 72, "公共更衣、淋浴和洗手间设施。"),
    place("restaurant", "海鲜餐厅", 82, 79, "滨海的小餐厅，可一起吃饭、看风景。"),
  ] },
  { id: "apartment", name: "通用公寓", summary: "标准两居室，含主卧、次卧、浴室、阳台、厨房、客厅。", ...asset("apartment"), entryKey: "entry", places: [
    place("entry", "玄关", 91, 49, "公寓入户位置，设有鞋柜和放置随身物品的空间。"),
    place("hall", "走廊", 58, 48, "连接卧室、浴室与公共生活区的室内走廊。"),
    place("bedroom", "主卧", 25, 26, "双人床、衣柜和床头柜所在的主卧，适合休息与独处。"),
    place("second", "次卧", 56, 26, "设有单人床、书桌和衣柜的次卧，也可作客房或学习空间。"),
    place("bathroom", "浴室", 82, 27, "包含淋浴、洗手台和卫生设施的独立浴室。"),
    place("living", "客厅", 27, 66, "沙发、茶几和电视组成的日常活动空间，可以一起聊天、看剧。"),
    place("dining", "餐厅", 60, 63, "小型餐桌和座椅所在的用餐位置，连接厨房和客厅。"),
    place("kitchen", "厨房", 82, 67, "配有灶台、水槽、冰箱和操作台的家庭厨房。"),
    place("balcony", "阳台", 29, 88, "与客厅相通的阳台，有绿植和休闲、晾晒空间。"),
  ] },
];

export type MapTemplateTarget = { type: "page"; pageId: string } | { type: "place"; placeId: string } | { type: "new"; pageId: string; name: string };
export function isEmptyMapPage(page: FacingMapPage) { return !page.tiles.length && !page.places.length; }
export async function installBuiltinMapTemplate(atlasId: string, templateId: string, target: MapTemplateTarget, signal: AbortSignal) {
  const template = BUILTIN_MAP_TEMPLATES.find(item => item.id === templateId);
  if (!template || !loadFacingAtlas(atlasId)) throw new Error("找不到所选模板或地图。");
  const response = await fetch(template.image, { signal });
  if (!response.ok) throw new Error("模板底图加载失败，请稍后重试。");
  const tile = await storeMapTile(await response.blob(), { x: 0, y: 0 });
  let pageId = "";
  try {
    throwIfAborted(signal);
    const atlas = await updateFacingAtlas(atlasId, current => {
      throwIfAborted(signal);
      let pages = [...current.pages];
      let page: FacingMapPage | undefined;
      if (target.type === "page") page = pages.find(item => item.id === target.pageId);
      else {
        let parentId: string;
        if (target.type === "new") {
          const outer = pages.find(item => item.id === target.pageId);
          if (!outer) throw new Error("外层地图已移除。");
          const bounds = mapBounds(outer);
          const parent = { id: facingId(), name: target.name.trim() || template.name, description: template.summary,
            x: outer.places.length || outer.tiles.length ? bounds.x + bounds.width + 100 : 500, y: bounds.y + bounds.height / 2 };
          pages = pages.map(item => item.id === outer.id ? { ...item, places: [...item.places, parent] } : item);
          parentId = parent.id;
        } else {
          const parent = mapPlace(current, target.placeId);
          if (!parent) throw new Error("这个地点已移除。");
          parentId = parent.place.id;
        }
        page = pages.find(item => item.parentPlaceId === parentId);
        if (!page) {
          const parent = pages.flatMap(item => item.places).find(item => item.id === parentId)!;
          page = { id: facingId(), parentPlaceId: parentId, name: parent.name, description: "", tiles: [], places: [], roads: [] };
          pages.push(page);
        }
      }
      if (!page) throw new Error("找不到应用模板的地图。");
      if (!isEmptyMapPage(page)) throw new Error("这里已有地图内容，请选择空白地图，或新增一个模板地点。");
      tile.name = template.name; tile.description = template.summary;
      const places = template.places.map(item => ({ id: facingId(), tileId: tile.id, name: item.name, description: item.description,
        x: item.x / 100 * tile.width, y: item.y / 100 * tile.height }));
      const entryIndex = template.places.findIndex(item => item.key === template.entryKey);
      pageId = page.id;
      return { ...current, pages: pages.map(item => item.id === pageId ? { ...item, description: template.summary,
        tiles: [tile], places, roads: [], entryPlaceId: places[entryIndex]?.id } : item) };
    });
    return { atlas, pageId };
  } catch (cause) {
    await deleteThemeAsset(tile.mediaId).catch(() => {});
    throw cause;
  }
}
