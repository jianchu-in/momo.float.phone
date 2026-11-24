// Storage and component integration checks; no real API requests or financial services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require('fake-indexeddb/auto');
const { window } = require('linkedom').parseHTML('<html><body><div id="root"></div></body></html>');
Object.assign(global, { window, document: window.document, HTMLElement: window.HTMLElement, Node: window.Node, Event: window.Event, CustomEvent: window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
const local = new Map();
global.localStorage = window.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key), key: i => [...local.keys()][i], get length() { return local.size; } };
global.requestAnimationFrame = cb => setTimeout(cb, 0); global.cancelAnimationFrame = clearTimeout;
global.ResizeObserver = class { observe() {} disconnect() {} };
window.HTMLElement.prototype.scrollIntoView = function() {};
window.HTMLElement.prototype.scrollTo = function(value) { this.scrollTop = value.top; };
window.HTMLElement.prototype.getBoundingClientRect = function() {
  const top = this.dataset.testTop ? Number(this.dataset.testTop) : 0;
  const height = this.dataset.reverseSession ? 60 : 350;
  return { x: 0, y: top, top, bottom: top + height, left: 0, right: 390, width: 390, height };
};
const project = path.resolve(__dirname, '..'), resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) { return resolve.call(this, request.startsWith('@/') ? path.join(project, request.slice(2)) : request, parent, ...rest); };
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
require.extensions['.css'] = () => {};
const load = name => require(path.join(project, name));
function mock(name, exports) { const id = path.join(project, name); require.cache[id] = { id, filename: id, loaded: true, exports }; }
const abort = load('lib/abort-utils.ts');
mock('lib/abort-utils.ts', { ...abort, abortableDelay: async (_ms, signal) => { abort.throwIfAborted(signal); await new Promise(resolve => setTimeout(resolve, 0)); abort.throwIfAborted(signal); } });
let calls = [], responder;
mock('lib/chat-engine.ts', { sendLLMStreamRequest: async (...args) => {
  const data = JSON.parse(args[2][1].content).当前内容;
  const prompt = args[2][0].content;
  const kind = prompt.includes('单行JSON头') ? 'conversation' : prompt.includes('是否同意用户邀请') ? 'invite' : prompt.includes('为给出的应用安排') ? 'desktop' : prompt.includes('当前屏幕可见') ? 'chat' : prompt.includes('你已打开用户资产') ? 'assets' : prompt.includes('查看允许的购物车') ? 'shopping' : prompt.includes('查看允许的历史记录') ? 'browser' : prompt.includes('只看书架书名') ? 'reading' : prompt.includes('发现「该APP') ? 'locked' : prompt.includes('用户刚刚说') ? 'blocked' : 'generate';
  calls.push({ kind, data, prompt });
  const result = await responder(kind, data, args[5].signal, args[6]);
  return { content: typeof result === 'string' ? result : JSON.stringify(result) };
} });
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client');
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function main() {
 const kv=load('lib/kv-db.ts');await kv.hydrateKvDb();await load('lib/settings-db.ts').hydrateSettingsDb();
 const settings=load('lib/settings-storage.ts');settings.saveUserIdentities([{id:'user',name:'简初',avatarUrl:''}]);
 settings.saveApiConfigs([{id:'api',name:'test',provider:'openai',baseUrl:'https://example.invalid',apiKey:'test',model:'test'}]);
 const binding=settings.loadBindingConfig();binding.globalDefaults.apiConfigId='api';settings.saveBindingConfig(binding);
 const chars=Array.from({length:240},(_,i)=>({id:'c'+i,name:'角色'+String(i).padStart(3,'0'),persona:'细心',avatar:null,createdAt:'',updatedAt:''}));
 load('lib/character-storage.ts').saveCharacters(chars);await load('lib/chat-storage.ts').hydrateChatStorage();
 const storage=load('lib/reverse-phone-storage.ts'),scope=storage.reverseScope(),key=storage.REVERSE_PREFIX+'settings:'+scope.key;
 const {ReversePhoneSettings}=load('components/checkphone/reverse-phone-settings.tsx');
 const host=document.getElementById('root');let root=createRoot(host);
 for(const data of [null,42,[],{unified:{chat:{targets:42,reply:false},modes:{chat:'locked',shopping:'invalid'}},characters:{c0:null,c1:{chat:{targets:['c2',false,'c2']}}},automation:{endsAt:'bad-date'}}]){
  await kv.kvUpdatePersisted(key,()=>JSON.stringify(data));
  await act(async()=>{root.render(React.createElement(ReversePhoneSettings,{key:JSON.stringify(data),scope,onClose(){}}));await tick();});
  assert.ok(host.querySelector('[aria-label="反查岗设置"]'));assert.equal(host.querySelector('[role="alert"]'),null);
 }
 assert.equal(storage.resolveReversePermissions('c0',scope).chat.reply,false);
 assert.equal(storage.resolveReversePermissions('c0',scope).modes.chat,'locked');
 assert.deepEqual(storage.resolveReversePermissions('c1',scope).chat.targets,['c2']);
 assert.equal(host.querySelectorAll('.rp-targets input').length,80,'large role checklist bounded');
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent.startsWith('显示更多角色')).click());
 assert.equal(host.querySelectorAll('.rp-targets input').length,160);
 const search=host.querySelector('[aria-label="搜索可查看的角色"]');
 const props=search[Object.keys(search).find(k=>k.startsWith('__reactProps$'))];
 await act(async()=>props.onChange({target:{value:'角色239'}}));
 assert.equal(host.querySelectorAll('.rp-targets input').length,1);assert.match(host.querySelector('.rp-targets').textContent,/角色239/);
 await act(async()=>root.unmount());await kv.kvUpdatePersisted(key,()=>JSON.stringify({}));
 // A legacy multi-megabyte replay remains playable, while subsequent list reads parse only small summaries.
 const legacy={...storage.createReverseSession(chars[0],scope),origin:'stealth',status:'completed',characterAvatar:'avatar'.repeat(1000),events:[{id:'e',kind:'speech',at:new Date().toISOString(),text:'我说：“书架很整齐”'}],replay:[{at:1,html:'<section>'+ 'x'.repeat(1200000)+'</section>',speech:'书架很整齐',loading:'',app:'reading'}]};
 await kv.kvUpdatePersisted(storage.REVERSE_PREFIX+'session:'+legacy.id,()=>JSON.stringify(legacy));
 let summaries=storage.loadReverseSessionSummaries(scope);assert.equal(summaries[0].replay,undefined);assert.equal(summaries[0].replayFrameCount,1);assert.equal(summaries[0].characterAvatar,undefined);
 const originalParse=JSON.parse;let hugeParses=0;JSON.parse=function(value,...args){if(typeof value==='string'&&value.length>1000000)hugeParses++;return originalParse(value,...args);};
 try{storage.loadReverseSessionSummaries(scope);assert.equal(hugeParses,0);}finally{JSON.parse=originalParse;}
 assert.equal(storage.loadReverseSession(legacy.id).replay[0].html,legacy.replay[0].html);
 const stale=storage.loadReverseSession(legacy.id,false);
 const frame={at:2,html:'<p>new page</p>',speech:'新反应',loading:'',app:'browser'};
 await Promise.all([storage.appendReverseReplay(legacy.id,frame),storage.saveReverseSession(stale)]);
 assert.equal(storage.loadReverseSession(legacy.id).replay.length,2);
 await storage.appendReverseReplay(legacy.id,frame);assert.equal(storage.loadReverseSession(legacy.id).replay.length,2,'duplicate frame omitted');
 await storage.appendReverseReplay(legacy.id,{...frame,at:3,speech:'下一句'});
 const full=storage.loadReverseSession(legacy.id);assert.equal(full.replay.length,3);assert.equal(full.replay.at(-1).html,'');
 assert.equal(storage.loadReverseSession(legacy.id,false).replayFrameCount,3);
 assert.equal(originalParse(kv.kvGet(storage.REVERSE_PREFIX+'session:'+legacy.id)).replay,undefined,'old embedded replay migrated');
 hugeParses=0;JSON.parse=function(value,...args){if(typeof value==='string'&&value.length>1000000)hugeParses++;return originalParse(value,...args);};
 try{await storage.saveReverseSession(storage.loadReverseSession(legacy.id,false));assert.equal(hugeParses,0,'pausing/settings save must not parse replay');}finally{JSON.parse=originalParse;}
 assert.match(storage.reverseMemoryText(full),/自主偷偷查看/);assert.match(storage.reverseMemoryText(full),/书架很整齐/);
 // Run the real desktop -> settings -> desktop path with existing large replay data.
 const {ReversePhoneApp}=load('components/checkphone/reverse-phone-app.tsx');root=createRoot(host);
 hugeParses=0;JSON.parse=function(value,...args){if(typeof value==='string'&&value.length>1000000)hugeParses++;return originalParse(value,...args);};
 try{
  await act(async()=>{root.render(React.createElement(ReversePhoneApp,{initialCharacterId:'c0',onClose(){}}));await tick();});
  await act(async()=>{host.querySelector('button[aria-label="反查岗设置"]').click();await tick();});
  assert.ok(host.querySelector('.rp-settings'));assert.equal(hugeParses,0,'opening settings must not materialize historical replay');
  await act(async()=>{host.querySelector('.rp-settings .rp-header button').click();await tick();});
  assert.ok(host.querySelector('.rp-desktop'));
  await act(async()=>root.unmount());
 }finally{JSON.parse=originalParse;}
 // Test actual transport prompts, not just the helper's string.
 const engine=load('lib/reverse-phone-engine.ts'),signal=new AbortController().signal;responder=async(kind)=>kind==='conversation'?'{"action":"none","reaction":"看过了"}':{reaction:'看过了'};
 calls=[];for(const kind of ['desktop','chat','shopping','browser','reading','assets','locked','blocked'])await engine.requestReverseSection(chars[0],scope,kind,{},signal,{origin:'stealth'});
 await engine.requestReverseChat(chars[0],scope,{},signal,()=>{},{origin:'stealth'});
 assert.equal(calls.length,9);for(const call of calls)assert.match(call.prompt,/用户没有在此刻邀请/);
 assert.match(calls.find(c=>c.kind==='blocked').prompt,/用户现在明确介入/);
 await engine.requestReverseSection(chars[0],scope,'desktop',{},signal,{origin:'manual'});assert.match(calls.at(-1).prompt,/主动让你查看/);
 await engine.requestReverseSection(chars[0],scope,'desktop',{},signal,{origin:'dialogue'});assert.match(calls.at(-1).prompt,/聊天触发/);
 // Identical unified rules still reserve a separate rolling quota for each character.
 const automation=load('lib/reverse-phone-automation.ts');await storage.updateReverseSettings(scope,v=>({...v,automation:{...automation.DEFAULT_REVERSE_AUTOMATION,proactive:true,stealth:true,timing:'fixed',intervalHours:1,minGapHours:1,weeklyLimit:3}}));
 const now=Date.now(),hour=3600000;
 for(const character of chars.slice(0,2)){
  assert.equal(await automation.claimStealthReverse(character,scope,now),null);
  for(let i=1;i<=3;i++)assert.ok(await automation.claimStealthReverse(character,scope,now+i*hour));
  assert.equal(await automation.claimStealthReverse(character,scope,now+4*hour),null);
 }
 console.log('PASS iOS/reverse regressions: malformed settings, 240-role search/paging, lazy legacy replay, concurrent save/capture, all stealth prompts and memory, per-character rolling quota.');
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.stack??error);process.exit(1);});
