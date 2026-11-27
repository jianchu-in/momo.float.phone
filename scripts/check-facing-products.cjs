const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
require("fake-indexeddb/auto");
const { window } = require("linkedom").parseHTML('<html><body><div id="root"></div></body></html>');
Object.assign(global, { window, document: window.document, HTMLElement: window.HTMLElement, Node: window.Node, Event: window.Event, CustomEvent: window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
const local = new Map();
global.localStorage = window.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) };
global.FileReader = class { readAsDataURL(blob) { blob.arrayBuffer().then(bytes => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString("base64")}`; this.onload?.(); }); } };
const project = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) { return resolve.call(this, request.startsWith("@/") ? path.join(project, request.slice(2)) : request, parent, ...rest); };
for (const ext of [".ts", ".tsx"]) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
const downloads = [];
const downloadPath = path.join(project, "lib/download-utils.ts");
require.cache[downloadPath] = { id: downloadPath, filename: downloadPath, loaded: true, exports: { downloadFile: async (blob, filename) => downloads.push({ bytes: Buffer.from(await blob.arrayBuffer()), filename }) } };
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const load = name => require(path.join(project, name));
const props = node => node[Object.keys(node).find(key => key.startsWith("__reactProps$"))];
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
const focus = [];
window.HTMLElement.prototype.focus = function() { focus.push(this); };

async function main() {
  await load("lib/kv-db.ts").hydrateKvDb();
  const media = load("lib/theme-storage.ts");
  const bytes = Buffer.from("original image bytes, including metadata and animation frames");
  const mediaId = await media.saveThemeAssetFromBlob(new Blob([bytes], { type: "image/png" }), "facing_media");
  const description = "完整的场景描述\n".repeat(30);
  const base = { characterId: "a", category: "scene", use: "scene", generated: true, mediaType: "image/png", durationMs: 0 };
  const assets = [
    { ...base, id: "first", name: "客厅原图", location: "客厅", mediaId, description },
    { ...base, id: "second", name: "卧室原图", location: "卧室", mediaId },
    { ...base, id: "missing", name: "缺失的原图", mediaId: "missing-media", description: "仍可查看描述" },
    { ...base, id: "not-generated", name: "手动素材", mediaId, generated: false },
  ];
  const host = document.getElementById("root");
  const root = createRoot(host);
  const Products = load("components/facing/facing-life-panels.tsx").FacingProducts;
  let backs = 0;
  await act(async () => { root.render(React.createElement(Products, { assets, onBack: () => backs++ })); await tick(); });
  await act(async () => tick());
  const click = async node => act(async () => { assert.ok(node); node.dispatchEvent(new window.Event("click", { bubbles: true })); await tick(); });
  const button = label => [...host.querySelectorAll("button")].find(node => node.textContent.trim() === label || node.getAttribute("aria-label") === label);
  assert.equal(host.querySelectorAll(".facing-products-grid > article").length, 3, "all generated scenes share one gallery");
  assert.equal(host.querySelectorAll("main h2").length, 0, "no location sections or horizontal rails");
  assert.equal(host.querySelector("main img").getAttribute("loading"), "lazy");
  assert.equal(host.querySelector("main .facing-product-description").textContent, description, "the CSS preview clamp must not truncate saved description data");
  const opener = button("查看成品客厅原图");
  await click(opener.querySelector("p"));
  let dialog = host.querySelector('[role="dialog"]');
  assert.ok(dialog); assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(dialog.closest("main"), null, "the modal must escape the scrolling/clipped gallery");
  assert.equal(dialog.querySelector(".facing-product-full-description").textContent, description);
  assert.equal(dialog.querySelector(".facing-product-full-description").nextElementSibling.textContent, "加入收藏");
  assert.ok(button("调整画面与参考后重生"));
  assert.equal(focus.at(-1), button("关闭"));
  await click(button("下载原图"));
  assert.deepEqual(downloads[0], { bytes, filename: "客厅原图.png" }, "download original stored bytes without resizing or recompressing");
  await act(async () => props(dialog).onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation() {} }));
  assert.equal(host.querySelector('[role="dialog"]'), null); assert.equal(focus.at(-1), opener);
  await click(button("查看成品缺失的原图")); await click(button("下载原图"));
  assert.match(host.querySelector('[role="alert"]').textContent, /原图暂时无法读取/);
  await media.saveThemeAssetFromBlob(new Blob([bytes], { type: "image/png" }), "facing_media", "missing-media");
  await click(button("下载原图")); assert.equal(downloads.length, 2); assert.equal(host.querySelector('[role="alert"]'), null);
  await click(button("关闭")); await click(button("返回")); assert.equal(backs, 1);
  await act(async () => root.render(React.createElement(Products, { assets: [], onBack() {} })));
  assert.match(host.textContent, /已生成的生活画面/);
  await act(async () => root.unmount());
  console.log("PASS Facing products: unified gallery, lazy complete previews, full description modal outside scrolling content, original-byte downloads, unavailable-image retry, Escape/focus return, empty state and back navigation.");
}
main().then(() => process.exit(0)).catch(error => { console.error(error.stack ?? error); process.exit(1); });
