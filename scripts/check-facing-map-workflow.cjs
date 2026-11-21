const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
require("fake-indexeddb/auto");
const { window } = require("linkedom").parseHTML('<html><body><div id="root"></div></body></html>');
Object.assign(global, { window, document: window.document, HTMLElement: window.HTMLElement, Node: window.Node, Event: window.Event, CustomEvent: window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
const local = new Map();
global.localStorage = window.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key), key: index => [...local.keys()][index], get length() { return local.size; } };
global.ResizeObserver = class { observe() {} disconnect() {} };
global.requestAnimationFrame = callback => setTimeout(callback, 0); global.cancelAnimationFrame = clearTimeout;
global.FileReader = class { readAsDataURL(blob) { blob.arrayBuffer().then(bytes => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString("base64")}`; this.onload?.(); }); } };
global.Image = class { naturalWidth = 1200; naturalHeight = 600; set src(value) { queueMicrotask(() => this.onload?.()); } };
let clipboardText = "";
window.HTMLTextAreaElement.prototype.select = function() {};
document.execCommand = command => { clipboardText = document.body.lastElementChild?.value || ""; return command === "copy"; };
window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 390, height: 600, x: 0, y: 0, top: 0, left: 0, right: 390, bottom: 600 });
const project = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) { return resolve.call(this, request.startsWith("@/") ? path.join(project, request.slice(2)) : request, parent, ...rest); };
for (const ext of [".ts", ".tsx"]) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
require.extensions[".css"] = () => {};
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const load = name => require(path.join(project, name));
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
let textCalls = 0, imageCalls = 0;
function mock(name, exports) { const id = path.join(project, name); require.cache[id] = { id, filename: id, loaded: true, exports }; }
const plan = { description: "河边社区与公园", places: [{ id: "park", name: "公园", description: "河岸花园", x: 750, y: 250 }] };
mock("lib/facing-map-engine.ts", {
  enrichMapGenerationSources: async sources=>sources,
  extensionPosition: (tile, direction, width, height) => ({ x: tile ? tile.x + tile.width : 0, y: 0 }),
  planFacingMap: async () => { textCalls++; return structuredClone(plan); },
  refineFacingMapPlan: async (_character, value) => { textCalls++; return { ...value, description: value.description + "，增加长椅" }; },
  renderFacingMap: async () => { imageCalls++; return { blob: new Blob(["image"], { type: "image/png" }) }; },
});
// Keep UI tests focused on the actual home/picker and map workflow, with no speech/media generation.
mock("components/facing/use-facing-scene-generation.ts", { useFacingSceneGeneration: () => ({}) });
mock("components/facing/use-facing-viewport-inset.ts", { useFacingViewportInset: () => 0 });
mock("components/facing/facing-stage.tsx", { FacingStage: ({ children }) => React.createElement("div", null, children) });
mock("components/facing/facing-room.tsx", { FacingRoom: () => React.createElement("div", null, "room") });
mock("components/facing/facing-assets.tsx", { FacingAssets: () => null });
mock("lib/tts-service.ts", { unlockAudioPlayback() {} });

async function main() {
  const kv = load("lib/kv-db.ts"); await kv.hydrateKvDb();
  const settingsDb = load("lib/settings-db.ts"); await settingsDb.hydrateSettingsDb();
  const storage = load("lib/facing-map-storage.ts"), plans = load("lib/facing-map-plans.ts"), facing = load("lib/facing-storage.ts");
  const chars = ["a", "b"].map((id, index) => ({ id, name: index ? "小乙" : "小甲", avatar: "data:image/png;base64,aW1hZ2U=", persona: "", wechatID: id, createdAt: "", updatedAt: "" }));
  load("lib/character-storage.ts").saveCharacters(chars);
  const world = load("lib/character-world-storage.ts").getCharacterWorldGroup("a").id;
  const saved = await plans.saveMapPlan({ ...plan, worldId: world, name: "社区方案", width: 1200, height: 600 });
  assert.equal(plans.loadMapPlans(world).length, 1); assert.equal(plans.loadMapPlans("other").length, 0);
  await plans.saveMapPlan({ ...saved, description: "改进社区" }); assert.equal(plans.loadMapPlans(world).length, 1);
  assert.match(plans.formatMapPlan(saved, saved), /X=750, Y=250/);
  const tile = { id: "tile", mediaId: "media", x: -100, y: 70, width: 1000, height: 500, pixelWidth: 1200, pixelHeight: 600 };
  const placed = plans.mapPlanPlaces(saved, tile)[0]; assert.equal(placed.x, 650); assert.equal(placed.y, 195); assert.notEqual(placed.id, "park");
  assert.throws(() => plans.mapPlanPlaces({ ...plan, places: [{ ...plan.places[0], x: NaN }] }, tile));
  let atlas = await storage.createFacingAtlas(world, "旧名称", ["a", "b"], []);
  atlas = await storage.renameFacingAtlas(atlas.id, "新名称"); assert.equal(atlas.pages[0].name, "新名称");
  await assert.rejects(storage.renameFacingAtlas(atlas.id, "  ")); assert.equal(storage.loadFacingAtlas(atlas.id).name, "新名称");
  await facing.saveFacingParticipants(["a", "b", "a"]); assert.deepEqual(facing.loadFacingSettings().participantIds, ["a", "b"]);
  await facing.saveFacingSettings("a", { voice: false }); assert.deepEqual(facing.loadFacingSettings().participantIds, ["a", "b"]);
  const group = { ...facing.createFacingMeeting("a", null, "main"), participantIds: ["a", "b"], title: "双人记录" };
  await facing.saveFacingMeetingStart(group, { sceneName: "客厅" });
  await facing.saveFacingMeetingStart({ ...facing.createFacingMeeting("a", null, "main"), title: "单人记录" }, { sceneName: "客厅" });
  const host = document.getElementById("root"); let root = createRoot(host);
  const mount = async element => act(async () => { root.render(element); await tick(); });
  const unmount = async () => { await act(async () => root.unmount()); root = createRoot(host); };
  const button = label => [...host.querySelectorAll("button")].find(node => node.textContent.trim() === label);
  const click = async node => { assert.ok(node, "button exists"); await act(async () => { node.dispatchEvent(new window.Event("click", { bubbles: true })); await tick(); }); };
  const props = element => element[Object.keys(element).find(key => key.startsWith("__reactProps$"))];
  const change = async (element, value) => act(async () => { props(element).onChange({ target: { value } }); await tick(); });
  const FacingApp = load("components/facing/facing-app.tsx").FacingApp;
  await mount(React.createElement(FacingApp, { onClose() {} }));
  assert.ok(!button("添加场景素材")); assert.ok(button("选择见面角色 · 2人"));
  await click(button("选择见面角色 · 2人"));
  assert.equal(host.querySelectorAll('[aria-pressed="true"]').length, 2);
  await click(button("确认选择 · 2人")); await click(button("开启新对话"));
  assert.equal(host.querySelectorAll('.facing-cast-picker [aria-pressed="true"]').length, 2);
  await click(host.querySelector('[aria-label="关闭"]')); await click(button("见面记录"));
  assert.ok(host.textContent.includes("双人记录")); assert.ok(!host.textContent.includes("单人记录"), "single and multi records remain separate");
  await unmount();
  const MapApp = load("components/facing/facing-map-app.tsx").FacingMapApp;
  const mapProps = { character: chars[0], characters: chars, onBack() {}, onSettings() {}, async onArrive() {} };
  await mount(React.createElement(MapApp, mapProps));
  assert.ok(!button("上传图片")); assert.equal(host.querySelectorAll(".fmap-person").length, 0, "unlocated people do not cover the map");
  await click(button("铺满")); assert.equal(plans.loadMapViewMode(), "cover");
  await unmount(); await mount(React.createElement(MapApp, mapProps)); assert.equal(host.querySelector(".fmap-canvas").dataset.viewMode, "cover");
  await click(button("全图")); await unmount(); await mount(React.createElement(MapApp, mapProps)); assert.equal(host.querySelector(".fmap-canvas").dataset.viewMode, "fit");
  await click(button("生成地图"));
  await change(host.querySelector('[aria-label="选择已有文字方案"]'), saved.id);
  assert.equal(host.querySelector('[aria-label="地图画面描述"]').value, "改进社区");
  await click([...host.querySelectorAll("button")].find(node => node.textContent.startsWith("继续增加与润色方案")));
  assert.equal(textCalls, 1); assert.match(host.querySelector('[aria-label="地图画面描述"]').value, /增加长椅/);
  await click(button("更新已保存文字方案")); assert.match(plans.loadMapPlans(world)[0].description, /增加长椅/);
  await click(button("一键复制描述、地点与坐标")); assert.match(clipboardText, /X=750, Y=250/); assert.match(clipboardText, /增加长椅/);
  const file = new File(["uploaded-original"], "map.png", { type: "image/png" });
  await act(async () => { await props(host.querySelector('input[type="file"]')).onChange({ currentTarget: { files: [file], value: "" } }); await tick(); });
  assert.ok(button("确认应用已有地图")); assert.equal(imageCalls, 0);
  await click(button("确认应用已有地图"));
  const updated = storage.loadFacingAtlas(atlas.id); assert.equal(updated.pages[0].tiles.length, 1);
  const placeNode = host.querySelector('[data-place="' + updated.pages[0].places[0].id + '"]');
  await act(async () => { props(placeNode).onKeyDown({ key: "Enter", preventDefault() {} }); await tick(); });
  assert.ok(button("设为我的位置"), "normal place click offers a location action without edit mode");
  await click(button("设为我的位置"));
  assert.equal(storage.loadFacingAtlas(atlas.id).userPlaces.default, updated.pages[0].places[0].id);
  assert.equal(updated.pages[0].places[0].x, 750); assert.equal(updated.pages[0].places[0].y, 125);
  const bytes = await load("lib/theme-storage.ts").getThemeAssetDataUrl(updated.pages[0].tiles[0].mediaId);
  assert.equal(bytes, "data:image/png;base64," + Buffer.from("uploaded-original").toString("base64"));
  assert.equal(imageCalls, 0, "upload never calls image API");
  await act(async () => { await storage.updateFacingAtlas(atlas.id, current => ({ ...current,
    userPlaces: { default: current.pages[0].places[0].id }, snapshots: [{ id: "snap", createdAt: new Date().toISOString(), entries: [
      { characterId: "a", placeId: current.pages[0].places[0].id, activity: "休息", time: new Date().toISOString() },
      { characterId: "b", placeId: current.pages[0].places[0].id, activity: "聊天", time: new Date().toISOString() },
    ] }] })); });
  await unmount(); await mount(React.createElement(MapApp, mapProps));
  assert.equal(host.querySelectorAll("[data-map-avatar]").length, 3, "user and co-located characters show individual avatars");
  assert.equal(host.querySelectorAll("clipPath").length, 3);
  await click(button("管理地图")); await change(host.querySelector('[aria-label="地图新名称"]'), "确认改名"); await click(button("保存名称"));
  assert.equal(storage.loadFacingAtlas(atlas.id).name, "确认改名");
  await click(button("管理地图")); await click(button("删除这张世界地图")); assert.ok(storage.loadFacingAtlas(atlas.id));
  await click(button("确认删除地图")); assert.equal(storage.loadFacingAtlas(atlas.id), null); assert.equal(await kv.kvReadPersisted("ai_phone_facing_map_v1:" + atlas.id), null);
  assert.equal(plans.loadMapPlans(world).length, 1, "deleting a map retains reusable text plans");
  assert.equal(await load("lib/theme-storage.ts").getThemeAssetDataUrl(updated.pages[0].tiles[0].mediaId), bytes);
  await act(async () => root.unmount());
  console.log("PASS: multi-character entry, map rename/delete, plan persistence/refinement, uploaded originals and coordinates, persistent view modes, and hidden unlocated people");
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
