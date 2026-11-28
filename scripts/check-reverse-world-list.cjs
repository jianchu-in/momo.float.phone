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
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
const None=()=>null;
// This test transpiles to CommonJS; the unrelated request engine registers a prefix before its ESM import.
mock('lib/friend-request-engine.ts',{PENDING_REPLY_PREFIX:'pending_friend_reply_'});
mock('components/chat/chat-room.tsx',{ChatRoom:({session})=>React.createElement('div',{'data-open-session':session.id},React.createElement('button',{'data-reverse-target':'back'},'返回'))});
for(const [file,name]of [['chat-contacts-list','ChatContactsList'],['moments-feed','MomentsFeed'],['mascot-chat-room','MascotChatRoom'],['user-profile-panel','UserProfilePanel'],['wallet-panel','WalletPanel']])mock('components/chat/'+file+'.tsx',{[name]:None});
mock('components/mascot/use-mascot-scene.ts',{useMascotScene(){}});
let requests=[];
mock('lib/chat-engine.ts',{sendLLMStreamRequest:async(...args)=>{
 const prompt=args[2][0].content,data=JSON.parse(args[2][1].content).当前内容;
 const kind=prompt.includes('为给出的应用安排')?'desktop':prompt.includes('单行JSON头')?'conversation':'list';requests.push({kind,data});
 if(kind==='desktop')return{content:JSON.stringify({order:['chat']})};
 if(kind==='list')return{content:JSON.stringify({sessions:data.当前屏幕会话.map(item=>item.id)})};
 return{content:'{"action":"none","reaction":"看过这段聊天了"}'};
}});
const abort=load('lib/abort-utils.ts');mock('lib/abort-utils.ts',{...abort,abortableDelay:async(_ms,signal)=>{abort.throwIfAborted(signal);await new Promise(resolve=>setTimeout(resolve,0));abort.throwIfAborted(signal);}});
async function main(){
 const kv=load('lib/kv-db.ts');await kv.hydrateKvDb();await load('lib/settings-db.ts').hydrateSettingsDb();
 const settings=load('lib/settings-storage.ts');settings.saveUserIdentities([{id:'user',name:'简初'}]);settings.saveApiConfigs([{id:'api',name:'test',provider:'openai',baseUrl:'https://example.invalid',apiKey:'test',defaultModel:'test'}]);const binding=settings.loadBindingConfig();binding.globalDefaults.apiConfigId='api';settings.saveBindingConfig(binding);
 const ids=['a','b','denied','cross','other','unassigned',...Array.from({length:12},(_,i)=>'foreign'+i)];
 const characters=ids.map(id=>({id,name:'角色'+id,avatar:null,persona:'温柔',createdAt:'',updatedAt:''}));load('lib/character-storage.ts').saveCharacters(characters);
 const worlds=load('lib/character-world-storage.ts'),home=worlds.createCharacterWorldGroup('查岗者世界'),foreign=worlds.createCharacterWorldGroup('另一个世界');
 for(const id of ['a','b','denied'])worlds.moveCharacterToWorld(id,home.id);
 for(const id of ['cross','other',...ids.filter(id=>id.startsWith('foreign'))])worlds.moveCharacterToWorld(id,foreign.id);
 const chat=load('lib/chat-storage.ts');await chat.hydrateChatStorage();const sessions={};
 for(const id of ids){chat.addChatContact(id);sessions[id]=chat.createOrGetSession(id);if(id!=='a')chat.pushChatMessage({sessionId:sessions[id].id,role:'user',content:'给'+id+'的真实历史'});}
 const group=chat.createGroupSession('不能查看的群聊',['a','b']);chat.pushChatMessage({sessionId:group.id,role:'user',content:'群聊历史'});
 const alt=chat.createOrGetSession('a','different-account');chat.pushChatMessage({sessionId:alt.id,role:'user',content:'其他账号历史'});
 chat.saveChatSessions(chat.loadChatSessions().map(item=>({...item,isPinned:item.contactId.startsWith('foreign')||item.contactId==='cross'})));
 const scopeStorage=load('lib/chat-scope-storage.ts');scopeStorage.saveChatScope({...scopeStorage.loadChatScope(),worldId:foreign.id});
 const reverse=load('lib/reverse-phone-storage.ts'),actions=load('lib/reverse-phone-actions.ts'),scope=reverse.reverseScope();
 const mascot=load('lib/mascot-settings.ts');mascot.updateMascotSettings({chatEnabled:true,nickname:'额外AI助手'});
 const Phone=load('components/chat/phone-chat-app.tsx').PhoneChatApp,host=document.getElementById('root');let root=createRoot(host);
 let props={onClose(){},inspectionControl:{page:'messages'},inspectionViewer:{characterId:'a',scope}};
 const render=async patch=>{props={...props,...patch};await act(async()=>{root.render(React.createElement(Phone,props));for(let i=0;i<4;i++)await tick();});};
 const rows=()=>[...host.querySelectorAll('[data-reverse-session]')].map(row=>row.dataset.reverseSession);
 const verifyScope=()=>assert.equal(scopeStorage.loadChatScope().worldId,foreign.id,'inspection never writes the normal world filter');
 await render({});assert.equal(rows()[0],sessions.a.id);assert.deepEqual(new Set(rows()),new Set(['a','b','denied'].map(id=>sessions[id].id)),'default uses the inspecting character world, even with a conflicting normal world filter and empty own chat');verifyScope();
 assert.ok(!host.textContent.includes('额外AI助手'));assert.equal(host.querySelector('.chat-list-tabs'),null);assert.ok(!rows().includes(group.id));assert.ok(!rows().includes(alt.id));
 await act(async()=>{await reverse.updateReverseSettings(scope,value=>({...value,characters:{a:{chat:{targets:['a','b','cross']}}}}));await tick();});
 assert.deepEqual(rows(),['a','b','cross'].map(id=>sessions[id].id),'same-world allowed first, explicitly allowed cross-world follows');assert.deepEqual(new Set(rows()),new Set(actions.reverseAllowedSessions('a',scope).map(item=>item.id)));verifyScope();
 await render({inspectionControl:{page:'messages',sessionId:sessions.cross.id}});assert.ok(host.querySelector('[data-open-session="'+sessions.cross.id+'"]'));
 await render({inspectionControl:{page:'messages',sessionId:sessions.other.id}});assert.equal(host.querySelector('[data-open-session]'),null,'controlled navigation cannot mount a forbidden conversation');
 const nav=load('lib/chat-notification-events.ts');await act(async()=>window.dispatchEvent(new CustomEvent(nav.CHAT_OPEN_SESSION_EVENT,{detail:{sessionId:sessions.other.id}})));assert.equal(host.querySelector('[data-open-session]'),null,'external notification does not redirect an inspection');
 await render({inspectionControl:{page:'messages'},inspectionViewer:{characterId:'b',scope}});assert.equal(rows()[0],sessions.b.id);assert.deepEqual(new Set(rows()),new Set(['a','b','denied'].map(id=>sessions[id].id)),'changing inspecting role resets to that role permissions');
 await render({inspectionViewer:{characterId:'unassigned',scope}});assert.deepEqual(rows(),[sessions.unassigned.id],'unassigned role defaults to its own chat');
 await render({inspectionViewer:{characterId:'a',scope}});
 await act(async()=>{await reverse.updateReverseSettings(scope,value=>({...value,characters:{a:{chat:{targets:[]}}}}));await tick();});assert.deepEqual(rows(),[]);assert.ok(host.textContent.includes('当前没有获准查看的聊天会话'));
 await act(async()=>{await reverse.updateReverseSettings(scope,value=>({...value,characters:{a:{chat:{targets:['a','cross']}}}}));await tick();});assert.deepEqual(rows(),[sessions.a.id,sessions.cross.id]);
 await act(async()=>{worlds.moveCharacterToWorld('cross',home.id);await tick();});verifyScope();
 await render({inspectionControl:undefined,inspectionViewer:undefined});assert.ok(rows().includes(sessions.other.id));assert.ok(!rows().includes(sessions.b.id),'ordinary chat still follows the user world filter');assert.ok(host.querySelector('.chat-list-tabs'));verifyScope();
 await act(async()=>root.unmount());
 // Real list renderer + inspection runner: disallowed pinned chats cannot occupy the visible page or reach the model.
 await reverse.updateReverseSettings(scope,value=>({...value,unified:{...value.unified,modes:{favorites:'hidden',chat:'open',shopping:'hidden',browser:'hidden',reading:'hidden'},chat:{...value.unified.chat,assets:false}},characters:{a:{chat:{targets:['a','b','cross']}}}}));
 worlds.moveCharacterToWorld('cross',foreign.id);
 window.HTMLElement.prototype.getBoundingClientRect=function(){const nodes=[...document.querySelectorAll('[data-reverse-session]')];const index=nodes.indexOf(this),top=index<0?0:index*70;return{left:0,right:390,top,bottom:top+(index<0?350:60),width:390,height:index<0?350:60};};
 const {useReversePhone}=load('components/checkphone/use-reverse-phone.ts');let latest;root=createRoot(host);
 function Harness(){const ref=React.useRef(null);latest=useReversePhone(scope,ref,'a');return React.createElement('div',{ref},latest.screen.app==='chat'?React.createElement(Phone,{onClose(){},inspectionControl:latest.screen.chat??{page:'messages'},inspectionViewer:{characterId:latest.session?.characterId??latest.characterId,scope}}):React.createElement('button',{'data-rp-target':'app:chat'},'聊天'));}
 await act(async()=>{root.render(React.createElement(Harness));await tick();});
 requests=[];let running,finished=false;await act(async()=>{running=latest.start().finally(()=>{finished=true;});await tick();});
 for(let i=0;i<200&&!finished;i++)await act(async()=>{await tick();});await act(async()=>{await running;});
 assert.equal(latest.session.status,'completed',latest.error);const plan=requests.find(call=>call.kind==='list');assert.ok(plan,'list planning happened');assert.deepEqual(new Set(plan.data.当前屏幕会话.map(item=>item.id)),new Set(['a','b','cross'].map(id=>sessions[id].id)));
 assert.deepEqual(requests.filter(call=>call.kind==='conversation').map(call=>call.data.联系人),['角色a','角色b','角色cross']);
 assert.ok(!JSON.stringify(requests).includes('foreign0'));verifyScope();await act(async()=>root.unmount());
 console.log('PASS reverse world list: actual chat DOM + planner, default world, explicit cross-world grants, forbidden pinned rows/groups/AI/account isolation, empty own chat, role switching/live permission refresh, navigation guards, visible-page planning and unchanged ordinary world filter. No paid requests.');
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.stack??error);process.exit(1);});
