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

const images=value=>'data:image/png;base64,'+Buffer.from(value).toString('base64');
let calls=0,failPeer='b',illustrationFlags=[];
mock('lib/chat-engine.ts',{
 sendLLMRequest:async(...args)=>{calls++;const text=args[2].map(m=>typeof m.content==='string'?m.content:'').join('\n');illustrationFlags.push(text.includes('本轮需要生成一张新的完整补图'));const ids=JSON.parse(text.match(/严格按这个名单和顺序输出：(\[[^\]]*\])/)[1]);if(ids.includes(failPeer))throw new Error('模拟第二组失败');return JSON.stringify({replies:ids.map(id=>({speaker_id:id,dialogue:id+'回应',action:''}))});},
});
mock('components/facing/use-facing-viewport-inset.ts',{useFacingViewportInset:()=>0});
mock('lib/tts-service.ts',{unlockAudioPlayback(){},resolveVoiceConfig:()=>null});
const audioInstances=[];let rejectAutoplay=false;
global.Audio=class {
 constructor(url){this.src=url;this.paused=true;this.plays=0;this.volume=1;audioInstances.push(this);}
 async play(){this.plays++;if(rejectAutoplay)throw new Error('gesture required');this.paused=false;this.onplay?.();}
 pause(){this.paused=true;this.onpause?.();}
};
async function main(){
 await load('lib/kv-db.ts').hydrateKvDb();await load('lib/settings-db.ts').hydrateSettingsDb();await load('lib/chat-storage.ts').hydrateChatStorage();
 const settings=load('lib/settings-storage.ts');settings.saveApiConfigs([{id:'api',name:'test',provider:'openai',defaultModel:'mock'}]);let binding=settings.loadBindingConfig();binding.globalDefaults.apiConfigId='api';settings.saveBindingConfig(binding);settings.saveUserIdentities([{id:'user',name:'用户'}]);
 const chars=['a','b','c'].map(id=>({id,name:'角色'+id,avatar:images(id),persona:'性格'+id,createdAt:'',updatedAt:''}));load('lib/character-storage.ts').saveCharacters(chars);
 const worlds=load('lib/character-world-storage.ts'),world=worlds.createCharacterWorldGroup('测试世界');for(const char of chars)worlds.moveCharacterToWorld(char.id,world.id);
 const maps=load('lib/facing-map-storage.ts'),life=load('lib/facing-place-life.ts'),storage=load('lib/facing-storage.ts'),media=load('lib/media-cache-storage.ts');
 let atlas=await maps.createFacingAtlas(world.id,'家与公共地点',['a','b','c'],[]);
 const home={id:'home',name:'公寓',description:'家',x:1,y:1},mall={id:'mall',name:'商场',description:'公共',x:2,y:2};
 atlas=await maps.saveMapPage(atlas.id,{...atlas.pages[0],places:[home,mall]});atlas=await maps.createMapInterior(atlas.id,home);
 const inside=atlas.pages.find(p=>p.parentPlaceId==='home');atlas=await maps.saveMapPage(atlas.id,{...inside,places:[{id:'kitchen',name:'厨房',description:'做饭',x:1,y:1},{id:'bath',name:'浴室',description:'洗漱',x:2,y:2}]});atlas=await maps.createMapInterior(atlas.id,atlas.pages.find(p=>p.id===inside.id).places[1]);
 const deep=atlas.pages.find(p=>p.parentPlaceId==='bath');atlas=await maps.saveMapPage(atlas.id,{...deep,places:[{id:'closet',name:'衣帽间',description:'收纳',x:1,y:1}]});
 atlas=await life.savePlaceLife(atlas.id,'kitchen',{homeCharacterIds:['b']});assert.deepEqual(life.bigMapPlace(atlas,'closet').homeCharacterIds,['b']);
 await assert.rejects(life.savePlaceLife(atlas.id,'home',{homeCharacterIds:['outsider']}),/这个世界/);
 const sound=Object.assign(new Blob(['rain-audio'],{type:'audio/mpeg'}),{name:'雨声.mp3'});atlas=await life.uploadPlaceAmbience(atlas.id,'closet',sound);
 const track=life.bigMapPlace(atlas,'kitchen').ambience;assert.equal(life.bigMapPlace(atlas,'closet').ambience.mediaRef,track.mediaRef);assert.equal(life.bigMapPlace(atlas,'mall').ambience,undefined);assert.equal(await (await media.loadMediaBlob(track.mediaRef)).blob.text(),'rain-audio');
 const bg=await storage.saveFacingAsset({id:'b-kitchen',characterId:'b',category:'scene',name:'厨房',use:'scene',durationMs:1},new Blob(['bg'],{type:'image/png'}),'image/png');
 const portrait=await storage.saveFacingAsset({id:'a-sprite',characterId:'a',category:'portrait',name:'默认',use:'idle',durationMs:1},new Blob(['sprite'],{type:'image/png'}),'image/png');
 const matched=load('lib/facing-map-scenes.ts').sceneForMapPlace(atlas,'kitchen','a');assert.equal(matched.sceneId,bg.id);assert.equal(matched.portraitId,portrait.id);
 const transfer=load('lib/facing-map-transfer.ts'),bundle=await transfer.exportMapPackage(atlas,new AbortController().signal);assert.ok(bundle.audio[track.mediaRef].startsWith('data:audio/'));
 const json=JSON.stringify(bundle),parsed=await transfer.readMapPackage({size:json.length,text:async()=>json},new AbortController().signal);
 const imported=await transfer.importMapPackage(parsed,world.id,['a','b','c'],new AbortController().signal,false);const importedTrack=imported.atlas.pages.flatMap(p=>p.places).find(p=>p.name==='公寓').ambience;
 assert.notEqual(importedTrack.mediaRef,track.mediaRef);assert.equal(await (await media.loadMediaBlob(importedTrack.mediaRef)).blob.text(),'rain-audio');
 const host=document.getElementById('root');let root=createRoot(host);const Ambience=load('components/facing/facing-ambience.tsx').FacingAmbience;
 const mount=async el=>act(async()=>{root.render(el);for(let i=0;i<5;i++)await tick();});
 const click=async text=>act(async()=>{const button=[...host.querySelectorAll('button')].find(b=>b.textContent.includes(text));assert.ok(button,text);button.dispatchEvent(new window.Event('click',{bubbles:true}));for(let i=0;i<5;i++)await tick();});
 await mount(React.createElement(Ambience,{track,location:'厨房'}));assert.equal(audioInstances.length,1);assert.equal(audioInstances[0].paused,false);
 await mount(React.createElement(Ambience,{track:{...track},location:'浴室'}));assert.equal(audioInstances.length,1,'interior transitions reuse the same audio element');
 await act(async()=>{window.dispatchEvent(new window.CustomEvent('facing-voice-playback',{detail:true}));await tick();});assert.equal(audioInstances[0].volume,.05);
 await click('暂停氛围音');assert.equal(maps.loadMapPreferences().ambienceMuted,true);assert.equal(audioInstances[0].paused,true);
 await mount(React.createElement(Ambience,{track:importedTrack,location:'另一处'}));assert.equal(audioInstances[1].plays,0,'mute persists across locations');
 await click('播放氛围音');assert.equal(audioInstances[1].paused,false);
 await act(async()=>root.unmount());assert.equal(audioInstances[1].paused,true);root=createRoot(host);
 rejectAutoplay=true;await mount(React.createElement(Ambience,{track,location:'公寓'}));assert.ok(host.textContent.includes('播放氛围音'));rejectAutoplay=false;await click('播放氛围音');await act(async()=>root.unmount());root=createRoot(host);
 const groups=[{id:'ga',name:'A组',characterIds:['a']},{id:'gb',name:'B组',characterIds:['b']}];
 let meeting=await storage.saveFacingMeetingStart({...storage.createFacingMeeting('a','user','main'),participantIds:['a','b'],replyGroups:groups},{sceneName:'厨房',sceneId:bg.id,portraitId:portrait.id});
 const user={id:'u1',role:'user',kind:'text',text:'一起吃饭吧',sceneName:'厨房',sceneId:bg.id,at:new Date().toISOString(),replyGroups:groups};meeting=await storage.appendFacingTurn(meeting,user);
 const Room=load('components/facing/facing-room.tsx').FacingRoom;let completed=0;
 function Host(){const [current,setCurrent]=React.useState(meeting);return React.createElement(Room,{character:chars[0],meeting:current,settings:{voice:false,memory:false,autoVisual:{enabled:true,interval:1}},scenes:[],position:storage.facingMeetingPosition(current),onMeeting:setCurrent,onSettings(){},onEnd(){},onVoice(){},onSpeechInput(){},onMap(){},onScene:async()=>{},onEditPortrait(){},onPortraitLayout:async()=>{},onStory:async()=>{},onCompleted(){completed++;}});}
 await mount(React.createElement(Host));await click('继续未完成分组');await act(async()=>{for(let i=0;i<50;i++)await tick();});
 let saved=storage.loadFacingMeeting(meeting.id);assert.equal(calls,2);assert.equal(saved.turns.filter(t=>t.replyGroupId==='ga').length,1);assert.equal(storage.pendingFacingGroups(saved).groups.length,1);assert.match(host.textContent,/模拟第二组失败/);
 failPeer='';await click('继续未完成分组');await act(async()=>{for(let i=0;i<50;i++)await tick();});saved=storage.loadFacingMeeting(meeting.id);assert.equal(calls,3,'resume skips completed group');assert.equal(saved.turns.filter(t=>t.role==='assistant').length,2);assert.equal(storage.facingCompletedRounds(saved),1);assert.equal(completed,1);assert.equal(illustrationFlags.at(-1),true,'resuming the final group retains the scheduled illustration');await act(async()=>root.unmount());root=createRoot(host);
 const before=saved.turns.map(t=>t.id);const changed=await storage.configureFacingCast(['b','c'],[{id:'new',name:'新组',characterIds:['b','c']}],saved.id);assert.deepEqual(changed.meeting.turns.map(t=>t.id),before);assert.equal(changed.meeting.scene.sceneId,bg.id);assert.ok(storage.loadFacingMeetings('a','user',true).some(m=>m.id===saved.id),'departed participants retain historical memory');
 const beforeRetry=calls;await assert.rejects(load('lib/facing-engine.ts').generateFacingReply({character:chars[1],meeting:changed.meeting,settings:{memory:false},scene:'厨房',scenes:[],signal:new AbortController().signal,speakerId:'a'}),/已离场/);assert.equal(calls,beforeRetry,'departed speaker retry never substitutes a different character');
 await storage.appendFacingTurn(changed.meeting,{id:'after-cast',role:'user',kind:'text',text:'离场之后的内容',sceneName:'厨房',at:new Date().toISOString()});
 const assembler=load('lib/short-term-assembler.ts');assert.ok(!assembler.loadNativeTimeline('a').some(entry=>entry.id==='after-cast'));assert.ok(!assembler.loadNativeTimeline('c').some(entry=>entry.id==='u1'));assert.ok(assembler.loadNativeTimeline('c').some(entry=>entry.id==='after-cast'));
 // Real app settings can edit an ongoing meeting, preserve its draft and return.
 await storage.configureFacingCast(['a','b'],groups,saved.id);await storage.saveFacingSettings('a',{voice:false});
 const App=load('components/facing/facing-app.tsx').FacingApp;await mount(React.createElement(App,{onClose(){},initialMeetingId:saved.id}));
 const props=el=>el[Object.keys(el).find(k=>k.startsWith('__reactProps$'))];const input=host.querySelector('.facing-input textarea')||host.querySelector('.facing-input input');assert.ok(input);
 await act(async()=>{props(input).onChange({target:{value:'设置回来继续写'}});await tick();});
 await act(async()=>{host.querySelector('[aria-label="设置"]').dispatchEvent(new window.Event('click',{bubbles:true}));await tick();});await click('调整当前在场角色与分组');await click('角色c');await click('确认选择');
 assert.equal(storage.loadFacingMeeting(saved.id).id,saved.id);assert.ok(storage.facingParticipantIds(storage.loadFacingMeeting(saved.id)).includes('c'));
 await act(async()=>{host.querySelector('[aria-label="返回"]').dispatchEvent(new window.Event('click',{bubbles:true}));for(let i=0;i<5;i++)await tick();});
 const restored=host.querySelector('.facing-input textarea')||host.querySelector('.facing-input input');assert.equal(props(restored).value,'设置回来继续写');await act(async()=>root.unmount());
 console.log('PASS place life: inherited ambience, pause/mute/autoplay/ducking/cleanup, home scene ownership, audio export/import, durable grouped replies and resume, in-room cast/group settings with history/scene/draft preservation.');
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e instanceof Error?e.stack:String(e));process.exit(1);});
