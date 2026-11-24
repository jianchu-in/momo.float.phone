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
require.extensions[".css"]=()=>{};
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const load = name => require(path.join(project, name));
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
function mock(name, exports) { const id = path.join(project, name); require.cache[id] = { id, filename: id, loaded: true, exports }; }


let output,calls=[];
mock('lib/chat-engine.ts',{sendLLMRequest:async(...args)=>{calls.push(args);return JSON.stringify(output);}});
mock('lib/tts-service.ts',{unlockAudioPlayback(){},resolveVoiceConfig:()=>null});
mock('components/facing/use-facing-viewport-inset.ts',{useFacingViewportInset:()=>0});
mock('components/facing/facing-stage.tsx',{FacingStage:({children})=>React.createElement('div',null,children)});
mock('components/facing/use-facing-scene-generation.ts',{useFacingSceneGeneration:()=>({check(){},retry(){},progress:{}})});
async function main(){
 await load('lib/kv-db.ts').hydrateKvDb();await load('lib/settings-db.ts').hydrateSettingsDb();await load('lib/chat-storage.ts').hydrateChatStorage();
 const settings=load('lib/settings-storage.ts');settings.saveApiConfigs([{id:'api',name:'test',provider:'openai',defaultModel:'mock'}]);const binding=settings.loadBindingConfig();binding.globalDefaults.apiConfigId='api';settings.saveBindingConfig(binding);
 const chars=['a','b'].map(id=>({id,name:'角色'+id,persona:'温柔',createdAt:'',updatedAt:''}));load('lib/character-storage.ts').saveCharacters(chars);
 const f=load('lib/facing-storage.ts'),format=load('lib/facing-reply-format.ts'),engine=load('lib/facing-engine.ts');await f.saveFacingParticipants(['a']);await f.saveFacingSettings('a',{memory:false,voice:false});
 const ordered=[{type:'action',text:'（递来热茶）'},{type:'dialogue',text:'先暖暖手。'},{type:'action',text:'（拉近椅子）'},{type:'dialogue',text:'我陪你坐会儿。'}];
 let meeting=await f.saveFacingMeetingStart(f.createFacingMeeting('a',null,'main'),{sceneName:'客厅'});const user={id:'u',role:'user',kind:'text',text:'有点冷',sceneName:'客厅',at:new Date().toISOString()};meeting=await f.appendFacingTurn(meeting,user);
 output={segments:ordered};let answer=await engine.generateFacingReply({character:chars[0],meeting,settings:{memory:false},scene:'客厅',scenes:[],signal:new AbortController().signal});
 assert.equal(calls.length,1);assert.match(JSON.stringify(calls[0]),/默认按这四段依次推进/);assert.deepEqual(answer.replies[0].segments,ordered);assert.equal(answer.replies[0].dialogue,'先暖暖手。\n我陪你坐会儿。');assert.ok(!answer.replies[0].dialogue.includes('递来'));
 for(const [value,pattern] of [['action-first',/先集中写一段动作/],['free',/不强制固定四段/]]){calls=[];answer=await engine.generateFacingReply({character:chars[0],meeting,settings:{memory:false,replyFormat:value},scene:'客厅',scenes:[],signal:new AbortController().signal});assert.equal(calls.length,1);assert.match(JSON.stringify(calls[0]),pattern);assert.deepEqual(answer.replies[0].segments.map(part=>part.type),value==='action-first'?['action','dialogue']:['action','dialogue','action','dialogue']);}
 const legacy=format.parseFacingReplyParts({dialogue:'（点头）好。',action:'（点头）'});assert.deepEqual(legacy.segments,[{type:'action',text:'（点头）'},{type:'dialogue',text:'好。'}],'compatibility fields cannot double an embedded action');
 const free=[{type:'dialogue',text:'你来啦。'},{type:'action',text:'（抬头）'},{type:'action',text:'（挪开书）'},{type:'dialogue',text:'坐这里。'}];output={replies:chars.map(char=>({speaker_id:char.id,segments:free}))};const multi=await engine.generateFacingReply({character:chars[0],meeting:{...meeting,participantIds:['a','b']},settings:{memory:false,replyFormat:'free'},scene:'客厅',scenes:[],signal:new AbortController().signal});assert.ok(multi.replies.length);for(const reply of multi.replies)assert.deepEqual(reply.segments,free);
 const summary=format.summarizeFacingSegments(ordered);const turn={...user,id:'reply',role:'assistant',kind:'reply',replyTo:user.id,speakerId:'a',speakerName:'角色a',text:summary.dialogue,action:summary.action,segments:ordered};meeting=await f.appendFacingTurn(meeting,turn);assert.deepEqual(f.loadFacingMeeting(meeting.id).turns.at(-1).segments,ordered);assert.deepEqual(f.facingReplyVersion(turn).segments,ordered);
 const text=f.facingTurnText(turn);let last=-1;for(const part of ordered){const at=text.indexOf(part.text);assert.ok(at>last);last=at;}
 const Message=load('components/facing/facing-message.tsx').FacingMessage,host=document.getElementById('root');let root=createRoot(host);
 await act(async()=>root.render(React.createElement(Message,{turn,characterName:'角色a',busy:false,onMenu(){},onVersion(){}})));
 assert.deepEqual([...host.querySelectorAll('article > p')].map(node=>node.textContent),ordered.map(part=>part.text));assert.deepEqual([...host.querySelectorAll('article > p')].map(node=>node.classList.contains('facing-action')),[true,false,true,false]);await act(async()=>root.unmount());
 // Editing a structured reply uses one ordered field and keeps versions/legacy speech separate.
 root=createRoot(host);let latest=meeting;const Room=load('components/facing/facing-room.tsx').FacingRoom;
 function Harness(){const [record,setRecord]=React.useState(meeting);latest=record;return React.createElement(Room,{character:chars[0],meeting:record,settings:{memory:false,voice:false},position:record.scene,scenes:[],onMeeting:setRecord,onCompleted(){},onSettings(){},onMap(){},onEnd(){},onSpeechInput(){},onScene:async()=>{},onPortraitLayout:async()=>{},onStory:async()=>{}});}
 const props=node=>node[Object.keys(node).find(key=>key.startsWith('__reactProps$'))];
 const click=async label=>act(async()=>{const button=[...host.querySelectorAll('button')].find(node=>node.textContent===label||node.getAttribute('aria-label')===label);assert.ok(button,label);button.dispatchEvent(new window.Event('click',{bubbles:true}));await tick();});
 await act(async()=>root.render(React.createElement(Harness)));
 await act(async()=>props(host.querySelector('article[data-role="assistant"]')).onContextMenu({preventDefault(){}}));await click('重试');for(let i=0;i<10;i++)await act(async()=>tick());
 assert.deepEqual(latest.turns.at(-1).versions[0].segments,ordered);assert.deepEqual(latest.turns.at(-1).versions[1].segments,free,'retry saves the new order separately from the original');
 await click('上一版回复');for(let i=0;i<5;i++)await act(async()=>tick());assert.deepEqual(latest.turns.at(-1).segments,ordered,'switching reply versions restores their own order');
 await act(async()=>props(host.querySelector('article[data-role="assistant"]')).onContextMenu({preventDefault(){}}));await click('编辑');assert.equal(host.querySelector('[aria-label="动作描述"]'),null);assert.equal(props(host.querySelector('[aria-label="消息内容"]')).value,ordered.map(part=>part.text).join('\n'));
 const edited='（倒茶）\n慢慢喝。\n（坐下）\n别着急。';await act(async()=>{props(host.querySelector('[aria-label="消息内容"]')).onChange({target:{value:edited}});});await click('保存');for(let i=0;i<5;i++)await act(async()=>tick());assert.deepEqual(latest.turns.at(-1).segments,format.splitFacingSegments(edited));assert.equal(latest.turns.at(-1).text,'慢慢喝。\n别着急。');await act(async()=>root.unmount());
 // Settings persist independently per character and retain the new default on reopening.
 const App=load('components/facing/facing-app.tsx').FacingApp;root=createRoot(host);await act(async()=>root.render(React.createElement(App,{onClose(){}})));await click('设置');assert.equal(host.querySelector('[aria-label="生成格式"]').value,'alternating');
 await act(async()=>{props(host.querySelector('[aria-label="生成格式"]')).onChange({target:{value:'free'}});for(let i=0;i<5;i++)await tick();});assert.equal(f.loadFacingSettings().characters.a.replyFormat,'free');assert.equal(f.loadFacingSettings().characters.b?.replyFormat,undefined);await act(async()=>root.unmount());root=createRoot(host);await act(async()=>root.render(React.createElement(App,{onClose(){}})));await click('设置');assert.equal(host.querySelector('[aria-label="生成格式"]').value,'free');await act(async()=>root.unmount());
 console.log('PASS Facing formats: three prompt modes, default/fixed/free ordering, one request, multi-role parts, no duplicate actions, speech-only text, durable ordered history/versions, real message rendering/editing and per-role settings reopen.');
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.stack??error);process.exit(1);});
