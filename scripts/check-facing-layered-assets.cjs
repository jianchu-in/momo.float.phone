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
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const load = name => require(path.join(project, name));
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
function mock(name, exports) { const id = path.join(project, name); require.cache[id] = { id, filename: id, loaded: true, exports }; }
let textCalls = [], imageCalls = [], reply;
const png = value => 'data:image/png;base64,' + Buffer.from(value).toString('base64');
mock('lib/chat-engine.ts', {
  sendLLMRequest: async (...args) => { textCalls.push(args); return JSON.stringify(reply); },
  sendLLMRequestPreferStream: async (...args) => { textCalls.push(args); return JSON.stringify(reply); },
});
mock('lib/image-generation-service.ts', {
  resolveConfiguredImageGenerationSettings: () => ({ enabled: true, provider: 'openai', characterReferences: { a: { assetId: 'ref', enabled: true } } }),
  generateImageFromConfiguredApi: async options => { imageCalls.push(options); return { blob: new Blob(['generated-' + imageCalls.length], { type: 'image/png' }), dataUrl: png('generated-' + imageCalls.length) }; },
});
mock('lib/chat-asset-storage.ts', { getChatImageFromIndexedDB: async () => png('role-reference') });
mock('lib/user-avatar-image.ts', { fileToUserAvatarDataUrl: async file => png(Buffer.from(await file.arrayBuffer()).toString()) });
async function main() {
  const kv = load('lib/kv-db.ts'); await kv.hydrateKvDb(); await load('lib/settings-db.ts').hydrateSettingsDb();
  const settings = load('lib/settings-storage.ts'); settings.saveApiConfigs([{ id: 'api', name: 'test', provider: 'openai', defaultModel: 'test' }]);
  const binding = settings.loadBindingConfig(); binding.globalDefaults.apiConfigId = 'api'; settings.saveBindingConfig(binding);
  const chars = ['a','b','c','d'].map(id => ({ id, name: '角色' + id, avatar: png(id), persona: '温柔，喜欢看书', createdAt: '', updatedAt: '', wechatID: id }));
  load('lib/character-storage.ts').saveCharacters(chars);
  const f = load('lib/facing-storage.ts'), maps = load('lib/facing-map-storage.ts');
  const atlas = await maps.createFacingAtlas('world-a', '世界甲', ['a','b'], []);
  const second = await maps.createFacingAtlas('world-b', '世界乙', ['c'], []);
  await assert.rejects(maps.saveMapResidents(second, ['a','c']), /已在/);
  await maps.saveMapResidents(atlas, ['a']); await maps.saveMapResidents(second, ['b','c']);
  assert.deepEqual(maps.mapResidentIds(atlas), ['a']); assert.equal(maps.mapCharacterResidence('b'), 'world-b');
  const attempts = await Promise.allSettled([maps.createFacingAtlas('world-c', '世界丙', ['d'], []), maps.createFacingAtlas('world-d', '世界丁', ['d'], [])]);
  assert.equal(attempts.filter(item=>item.status==='fulfilled').length,1,'concurrent residency assignments commit in only one world');
  const mapEngine = load('lib/facing-map-engine.ts');
  const worldSources = { atlas: maps.loadFacingAtlas(atlas.id), characters: chars, worldBookIds: [] };
  reply = { description: '一张社区地图', places: [] };
  await mapEngine.planFacingMap(chars[0], worldSources.atlas, worldSources.atlas.pages[0], chars, '', maps.loadMapPreferences(), new AbortController().signal);
  assert.deepEqual(JSON.parse(textCalls.at(-1)[2][1].content).角色.map(item => item.id), ['a']);
  await mapEngine.renderFacingMap(chars[0], { description: '住所', places: [] }, maps.loadMapPreferences(), new AbortController().signal, undefined, undefined, worldSources);
  assert.match(imageCalls.at(-1).description, /生活角色/); assert.ok(!imageCalls.at(-1).description.includes('角色b'));
  const blob = value => new Blob([value], { type: 'image/png' });
  async function asset(id, category, name, extra = {}) {
    return f.saveFacingAsset({ id, characterId: 'a', category, name, use: category === 'scene' ? 'scene' : name === '默认' ? 'idle' : 'reaction', durationMs: 3500, ...extra }, blob(id), 'image/png');
  }
  const idle = await asset('idle','portrait','默认',{folder:'日常/居家'}), smile = await asset('smile','portrait','微笑',{folder:'日常/居家'}), anger = await asset('anger','portrait','生气',{folder:'情绪'});
  const living = await asset('background-A','scene','客厅',{location:'客厅',portraitIds:[idle.id, smile.id]}), bedroom = await asset('background-B','scene','卧室',{location:'卧室',portraitIds:[idle.id, anger.id]});
  const legacy = await asset('legacy','portrait','默认',{location:'旧场所',composition:'full'});
  let assets=f.loadFacingAssets('a'), groups=f.groupFacingScenes(assets);
  assert.equal(groups.find(g=>g.name==='客厅').backdrop.id, living.id); assert.equal(groups.find(g=>g.name==='客厅').portrait.id,idle.id);
  assert.deepEqual(groups.find(g=>g.name==='客厅').reactions.map(item=>item.id),[smile.id]); assert.equal(groups.find(g=>g.name==='旧场所').portrait.id,legacy.id);
  await f.setFacingScenePortraits('a','卧室',[idle.id,smile.id]); assets=f.loadFacingAssets('a'); groups=f.groupFacingScenes(assets);
  assert.deepEqual(groups.find(g=>g.name==='卧室').reactions.map(item=>item.id),[smile.id]);
  const host=document.getElementById('root'); let root=createRoot(host);
  const Stage=load('components/facing/facing-stage.tsx').FacingStage;
  await act(async()=>{root.render(React.createElement(Stage,{portrait:idle,scene:living,name:'角色a'})); await tick();});
  await act(async()=>{await tick();});
  const bg=host.querySelector('.facing-scene img'); assert.ok(bg);
  await act(async()=>{root.render(React.createElement(Stage,{portrait:idle,scene:living,reaction:smile,name:'角色a'})); await tick();});
  await act(async()=>{await tick();});
  assert.equal(host.querySelector('.facing-scene img'),bg,'mood change retains the same background node'); assert.equal(host.querySelector('.facing-figure img').getAttribute('alt'),'微笑');
  await act(async()=>root.unmount()); root=createRoot(host);
  const Library=load('components/facing/facing-assets.tsx').FacingAssets;
  const libraryProps={character:chars[0],assets,groups,onBack(){},onChange(){},async onDelete(ids){await f.deleteFacingAssets('a',ids);}};
  await act(async()=>{root.render(React.createElement(Library,libraryProps)); await tick();});
  assert.ok(host.textContent.includes('场景素材')); assert.ok(host.textContent.includes('立绘素材')); assert.ok(host.textContent.includes('日常')); assert.ok(host.textContent.includes('居家'));
  const button=label=>[...host.querySelectorAll('button')].find(node=>node.textContent.trim()===label);
  await act(async()=>{button('上传立绘／GIF／动图').dispatchEvent(new window.Event('click',{bubbles:true})); await tick();});
  assert.ok(host.querySelector('input[accept*="image/gif"]')); assert.ok(host.querySelector('[aria-label="立绘分类"]'));
  const rp=element=>element[Object.keys(element).find(key=>key.startsWith('__reactProps$'))];
  await act(async()=>{rp(host.querySelector('[aria-label="素材名称"]')).onChange({target:{value:'脸红'}});await tick();});
  await act(async()=>{rp(host.querySelector('[aria-label="立绘分类"]')).onChange({target:{value:'节日/冬天'}});await tick();});
  const gif=new File(['GIF89a-test'],'pose.gif',{type:'image/gif'});
  await act(async()=>{rp(host.querySelector('input[accept*="image/gif"]')).onChange({currentTarget:{files:[gif],value:''}});await tick();});
  await act(async()=>{button('保存素材').dispatchEvent(new window.Event('click',{bubbles:true}));for(let i=0;i<10;i++)await tick();});
  const uploaded=f.loadFacingAssets('a').find(item=>item.name==='脸红'); assert.ok(uploaded); assert.equal(uploaded.folder,'节日/冬天'); assert.equal(uploaded.composition,undefined); assert.equal(uploaded.mediaType,'image/gif');
  await act(async()=>root.unmount());
  // Description travels in the normal chat response; the periodic job calls only the image API.
  await f.saveFacingSettings('a',{memory:false,autoVisual:{enabled:true,interval:5,skipNsfw:true,extraPrompt:'自然暖光摄影'}});
  const engine=load('lib/facing-engine.ts'); textCalls=[]; imageCalls=[];
  reply={dialogue:'这杯茶很好喝。',action:'（朝你微笑）',reaction_id:smile.id,image_description:'客厅暖光，角色a侧身坐在沙发上端着茶杯看向用户，自然微笑。',image_rating:'safe'};
  const base={...f.createFacingMeeting('a',null,'independent'),scene:f.facingScenePosition(groups.find(g=>g.name==='客厅'))};
  const user={...base.scene,id:'user-5',role:'user',kind:'text',text:'茶好喝吗',at:new Date().toISOString()};
  const answer=await engine.generateFacingReply({character:chars[0],meeting:{...base,turns:[user]},settings:{memory:false,extraPrompt:'第二人称，避免套话',autoVisual:{extraPrompt:'温馨第一视角'}},scene:'客厅',scenes:groups,illustrate:true,signal:new AbortController().signal});
  assert.match(JSON.stringify(textCalls[0]),/第二人称，避免套话/);assert.match(JSON.stringify(textCalls[0]),/当前现实时间/);assert.match(JSON.stringify(textCalls[0]),/温馨第一视角/);
  assert.equal(textCalls.length,1); assert.equal(answer.replies[0].visualDescription,reply.image_description); assert.equal(answer.replies[0].reaction.id,smile.id);
  const turn={...base.scene,id:'assistant-5',role:'assistant',kind:'reply',text:answer.replies[0].dialogue,speakerId:'a',visualDescription:answer.replies[0].visualDescription,visualRating:'safe',at:new Date().toISOString(),replyTo:user.id};
  const meeting=await f.saveFacingMeetingStart({...base,turns:[user,turn],completedRounds:5},base.scene);
  let jobs,applied;
  function Jobs(){jobs=load('components/facing/use-facing-scene-generation.ts').useFacingSceneGeneration(value=>{applied=value;},()=>{});return null;}
  root=createRoot(host); await act(async()=>{root.render(React.createElement(Jobs));await tick();});
  await act(async()=>{jobs.check({...meeting,completedRounds:4},chars[0]);await tick();}); assert.equal(imageCalls.length,0);
  await act(async()=>{jobs.check(meeting,chars[0]);jobs.check(meeting,chars[0]);for(let i=0;i<150&&!applied;i++)await tick();});
  assert.ok(applied); assert.equal(textCalls.length,1,'no extra text planning or screening request'); assert.equal(imageCalls.length,1);
  assert.equal(imageCalls[0].explicitReferenceImages.length,2); assert.equal(imageCalls[0].explicitReferenceImages[0].dataUrl,png('background-A')); assert.equal(imageCalls[0].explicitReferenceImages[1].dataUrl,png('role-reference')); assert.match(imageCalls[0].description,/客厅暖光/);assert.match(imageCalls[0].description,/自然暖光摄影/);
  applied=await f.markFacingCgShown(applied.id,applied.visual.assetId);
  assert.equal(applied.visual.replacement,true); assert.equal(applied.visual.round,5);
  assert.ok(f.loadFacingAssets('a').find(item=>item.id===applied.visual.assetId).generated);
  assert.ok(f.groupFacingScenes(f.loadFacingAssets('a')).every(group=>group.reactions.every(item=>!item.generated)));
  let next=await f.appendFacingTurn(applied,{...turn,id:'assistant-6',replyTo:'user-6',visualContinuityId:undefined}); assert.ok(next.visual,'full replacement remains until scene change or the next illustration');
  assert.equal(f.isFacingCgVisible(applied,{enabled:true,interval:5,displayRounds:2}),true);
  assert.equal(f.isFacingCgVisible(next,{enabled:true,interval:5,displayRounds:2}),true);
  const expired={...next,completedRounds:7};
  assert.equal(f.isFacingCgVisible(expired,{enabled:true,interval:5,displayRounds:2}),false);
  await kv.kvUpdatePersisted(f.FACING_MEETING_PREFIX+next.id,()=>JSON.stringify(expired));
  const manual=await f.toggleFacingCg(next.id,true);assert.equal(f.isFacingCgVisible(manual,{enabled:true,interval:5,displayRounds:2}),true);
  const closed=await f.toggleFacingCg(next.id,false);assert.equal(f.isFacingCgVisible(closed,{enabled:true,interval:5,displayRounds:2}),false);
  assert.equal(f.facingCgDisplayRounds({interval:1,displayRounds:2}),0);assert.equal(f.facingCgDisplayRounds({interval:3,displayRounds:8}),2);
  next=await f.appendFacingTurn(next,{...turn,id:'assistant-7',replyTo:'user-7',sceneName:'卧室',sceneId:bedroom.id}); assert.equal(next.visual,undefined);
  applied=undefined;
  const tenth={...meeting,completedRounds:10,turns:[user,{...turn,id:'assistant-10'}]};
  await kv.kvUpdatePersisted(f.FACING_MEETING_PREFIX+meeting.id,()=>JSON.stringify(tenth));
  await act(async()=>{jobs.check(tenth,chars[0]);for(let i=0;i<150&&!applied;i++)await tick();});
  assert.equal(imageCalls.length,2,'next interval produces a new image even with existing full illustrations');
  assert.equal(f.loadFacingAssets('a').filter(item=>item.generated).length,2);
  const unsafe={...tenth,completedRounds:15,turns:[user,{...turn,id:'assistant-15',visualRating:'uncertain'}]};
  await kv.kvUpdatePersisted(f.FACING_MEETING_PREFIX+meeting.id,()=>JSON.stringify(unsafe));
  await act(async()=>{jobs.check(unsafe,chars[0]);await tick();await tick();}); assert.equal(imageCalls.length,2,'optional NSFW check is used from the same chat response');
  // A CG arriving after further dialogue can still cover the same scene, but not a new visit.
  const lateBase=await f.saveFacingMeetingStart({...f.createFacingMeeting('a',null,'independent'),turns:[user,turn],completedRounds:5},base.scene);
  const revision=lateBase.sceneRevision??0;
  let later=await f.appendFacingTurn(lateBase,{...user,id:'late-user'});
  later=await f.appendFacingTurn(later,{...turn,id:'late-reply',replyTo:'late-user'});
  later=await f.changeFacingTurns(later,turns=>turns.map(item=>item.id==='late-reply'?{...item,audioRef:'saved-audio'}:item));
  assert.equal(later.sceneRevision??0,revision,'saving speech audio does not invalidate a pending CG');
  const cg=f.loadFacingAssets('a').find(item=>item.generated);
  const lateApplied=await f.applyFacingVisual(later.id,turn,'late-cg',turn.sceneName,cg,'replacement',revision,5);
  assert.ok(lateApplied,'continuing in the same scene cannot discard a generated CG');assert.equal(lateApplied.visual.shownAtRound,6);
  await f.changeFacingScene(later.id,{sceneName:'卧室',sceneId:bedroom.id});
  const returned=await f.changeFacingScene(later.id,base.scene);
  assert.equal(f.facingVisualMatches(returned,turn,'',revision),false,'leaving and returning rejects the old in-flight scene');
  const chatSettings=load('lib/chat-storage.ts');const savedChat=chatSettings.loadChatAppSettings();chatSettings.saveChatAppSettings({...savedChat,timeAware:false});
  textCalls=[];await engine.generateFacingReply({character:chars[0],meeting:{...base,turns:[user]},settings:{memory:false},scene:'客厅',scenes:groups,signal:new AbortController().signal});
  assert.ok(!JSON.stringify(textCalls).includes('当前现实时间'));chatSettings.saveChatAppSettings(savedChat);
  await act(async()=>root.unmount());
  await f.deleteFacingAssets('a',[smile.id]); assert.ok(!f.loadFacingAssets('a').find(item=>item.id===living.id).portraitIds.includes(smile.id)); assert.ok(f.loadFacingAssets('a').some(item=>item.id===living.id));
  console.log('PASS: exclusive world residents, map text/image roster, layered sprites and fixed backgrounds, nested folders, GIF upload, scene bindings, legacy preservation, one-request descriptions, periodic fresh two-reference illustrations and NSFW skip.');
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
