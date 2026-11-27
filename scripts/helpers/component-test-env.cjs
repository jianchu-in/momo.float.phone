const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
require("fake-indexeddb/auto");
const { window } = require("linkedom").parseHTML('<html><body><div id="root"></div></body></html>');
Object.assign(global, { window, document: window.document, HTMLElement: window.HTMLElement, Node: window.Node, Event: window.Event, CustomEvent: window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
window.location = { origin: "https://test.invalid" };
const local = new Map();
global.localStorage = window.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key), key: index => [...local.keys()][index], get length() { return local.size; } };
global.ResizeObserver = class { observe() {} disconnect() {} };
global.requestAnimationFrame = callback => setTimeout(callback, 0); global.cancelAnimationFrame = clearTimeout;
global.FileReader = class { readAsArrayBuffer(blob) { blob.arrayBuffer().then(bytes=>{this.result=bytes;this.onload?.({target:this});this.onloadend?.({target:this});}); } readAsDataURL(blob) { blob.arrayBuffer().then(bytes => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString("base64")}`; this.onload?.({target:this});this.onloadend?.({target:this}); }); } };
global.Image = class { naturalWidth = 1200; naturalHeight = 600; set src(value) { queueMicrotask(() => this.onload?.()); } };
let clipboardText = "";
window.HTMLTextAreaElement.prototype.select = function() {};
document.execCommand = command => { clipboardText = document.body.lastElementChild?.value || ""; return command === "copy"; };
window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 390, height: 600, x: 0, y: 0, top: 0, left: 0, right: 390, bottom: 600 });
const project = path.resolve(__dirname, "../..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) { return resolve.call(this, request.startsWith("@/") ? path.join(project, request.slice(2)) : request, parent, ...rest); };
for (const ext of [".ts", ".tsx"]) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
require.extensions[".css"]=()=>{};
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const load = name => require(path.join(project, name));
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
function mock(name, exports) { const id = path.join(project, name); require.cache[id] = { id, filename: id, loaded: true, exports }; }

module.exports = { assert, fs, path, React, act, createRoot, load, tick, mock, props: node => node[Object.keys(node).find(key => key.startsWith("__reactProps$"))] };
