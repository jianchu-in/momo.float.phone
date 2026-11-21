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

const png=value=>'data:image/png;base64,'+Buffer.from(value).toString('base64');
let streamCalls=0,streamMode='normal',imageCalls=[],textCalls=[],phoneRefreshOutput='',releaseStream;
mock('lib/chat-engine.ts', {
 sendLLMStreamRequest:async(...args)=>{streamCalls++; if(streamMode==='fail')throw new Error('模拟接收失败');if(streamMode==='hold')await new Promise((resolve,reject)=>{const abort=()=>reject(new Error('模拟停止'));args[5].signal.addEventListener('abort',abort,{once:true});releaseStream=()=>{args[5].signal.removeEventListener('abort',abort);resolve();};});args[6]?.onDelta?.('收到。');args[6]?.onDelta?.('\n\n晚点见。');if(streamMode==='abort')args[5].signal.dispatchEvent(new window.Event('abort'));return {content:'收到。\n\n晚点见。'};},
 sendLLMRequest:async(...args)=>{textCalls.push(args);return ['checkphone_chat','checkphone_batch'].includes(args[5]?.appId)?phoneRefreshOutput:JSON.stringify({description:'润色后的原场景'});},
 sendLLMRequestPreferStream:async(...args)=>{textCalls.push(args);return JSON.stringify({description:'润色后的原场景'});},
});
mock('lib/image-generation-service.ts',{
 resolveConfiguredImageGenerationSettings:()=>({enabled:true,provider:'openai',characterReferences:{a:{assetId:'ref',enabled:true}}}),
 generateImageFromConfiguredApi:async options=>{imageCalls.push(options);return {blob:new Blob(['new-media'],{type:'image/png'}),dataUrl:png('new-media')};},
});
mock('lib/chat-asset-storage.ts',{getChatImageFromIndexedDB:async()=>png('reference')});
async function main(){
 await load('lib/kv-db.ts').hydrateKvDb();await load('lib/settings-db.ts').hydrateSettingsDb();await load('lib/chat-storage.ts').hydrateChatStorage();
 const settings=load('lib/settings-storage.ts');settings.saveApiConfigs([{id:'api',name:'mock',provider:'openai',defaultModel:'mock'}]);const binding=settings.loadBindingConfig();binding.globalDefaults.apiConfigId='api';settings.saveBindingConfig(binding);settings.saveUserIdentities([{id:'user',name:'测试用户',avatarUrl:png('user')}]);
 const chars=['a','b','c'].map(id=>({id,name:'角色'+id,avatar:png(id),persona:'喜欢安静、会做饭',createdAt:'',updatedAt:''}));load('lib/character-storage.ts').saveCharacters(chars);
 const worlds=load('lib/character-world-storage.ts');const world=worlds.createCharacterWorldGroup('测试世界');worlds.moveCharacterToWorld('a',world.id);worlds.moveCharacterToWorld('b',world.id);
 const f=load('lib/facing-storage.ts'),maps=load('lib/facing-map-storage.ts'),link=load('lib/facing-map-scenes.ts');
 async function asset(id,owner,category,name,extra={}){return f.saveFacingAsset({id,characterId:owner,category,name,use:category==='scene'?'scene':'idle',durationMs:3500,...extra},new Blob([id],{type:'image/png'}),'image/png');}
 const sprite=await asset('sprite','a','portrait','默认',{description:'原立绘文案'});
 const kitchen=await asset('kitchen','a','scene','厨房',{portraitIds:[sprite.id],description:'原场景文案'});
 const shared=await asset('shared-scene',f.FACING_SHARED_CHARACTER_ID,'scene','商场');
 const male=await asset('male',f.FACING_SHARED_CHARACTER_ID,'portrait','默认',{npcGender:'male'}),female=await asset('female',f.FACING_SHARED_CHARACTER_ID,'portrait','默认',{npcGender:'female'});
 await f.saveFacingSettings('b',{fallbackNpcGender:'female'});
 assert.ok(f.loadFacingUsableAssets('b').some(a=>a.id===female.id));assert.ok(!f.loadFacingUsableAssets('b').some(a=>a.id===male.id));assert.ok(!f.loadFacingUsableAssets('a').some(a=>a.id===female.id));
 const atlas=await maps.createFacingAtlas(world.id,'家',['a','b'],[]);
 const page={...atlas.pages[0],places:[{id:'p1',name:'家·厨房',description:'做饭',x:100,y:100},{id:'p2',name:'商场',description:'购物',x:400,y:400}]};await maps.saveMapPage(atlas.id,page);
 assert.equal(link.matchPlaceScene(page.places[0],[kitchen]).id,kitchen.id);
 const scanned=link.scanMapScenes(page.places,'a');let mapped=await link.saveMapSceneBindings(atlas.id,page.id,scanned);assert.equal(link.sceneForMapPlace(mapped,'p1','a').sceneId,kitchen.id);
 mapped=await link.saveMapSceneBindings(atlas.id,page.id,[{...page.places[1],sceneBinding:{source:'shared',characterId:f.FACING_SHARED_CHARACTER_ID,sceneId:shared.id,sceneName:'商场'}}]);
 const sharedPosition=link.sceneForMapPlace(mapped,'p2','a');assert.equal(sharedPosition.sceneId,shared.id);assert.equal(sharedPosition.portraitId,sprite.id,'common background keeps role-specific portrait');
 const resolved=f.resolveFacingScene({...sharedPosition,sceneName:'世界·商场'},f.groupFacingScenes(f.loadFacingUsableAssets('a')),f.loadFacingUsableAssets('a'));assert.equal(resolved.backdrop.id,shared.id);
 let meeting=await f.saveFacingMeetingStart(f.createFacingMeeting('a','user','main'),f.facingScenePosition(f.groupFacingScenes(f.loadFacingUsableAssets('a'))[0]));
 meeting=await f.appendFacingTurns(meeting,[{id:'u1',role:'user',kind:'text',text:'一起做饭',at:'2026-11-21T01:00:00Z',sceneName:'厨房'},{id:'a1',role:'assistant',speakerId:'a',speakerName:'角色a',kind:'reply',text:'好。',at:'2026-11-21T01:00:01Z',sceneName:'厨房',replyTo:'u1'}]);
 meeting=await f.changeFacingScene(meeting.id,{...sharedPosition,sceneName:'商场'});meeting=await f.changeFacingTurns(meeting,turns=>turns.map(t=>t.id==='u1'?{...t,text:'一起做晚饭'}:t));assert.equal(meeting.scene.sceneName,'商场','editing older messages never reverts manual scene change');
 meeting=await f.changeFacingTurns(meeting,turns=>turns.map(turn=>turn.id==='a1'?{...turn,sceneName:'卧室'}:turn));assert.equal(meeting.scene.sceneName,'卧室','selecting a reply version with a different scene still updates the scene');meeting=await f.changeFacingScene(meeting.id,{...sharedPosition,sceneName:'商场'});
 const story=load('lib/story-storage.ts');const first=await story.continueFacingInStory(meeting,{id:'user',name:'测试用户',avatarUrl:png('user')});const second=await story.continueFacingInStory(meeting,{id:'user',name:'测试用户'});assert.equal(first.id,second.id,'double confirmation reuses one branch');assert.notEqual(first.branchId,'main');assert.equal(story.loadStoryMessages(first.id).length,3);assert.match(story.loadStoryMessages(first.id).find(m=>m.role==='system').rawContent,/商场/);assert.equal(first.facingIdentity.name,'测试用户');assert.ok(f.loadFacingMeeting(meeting.id));
 const multi=await f.saveFacingMeetingStart({...f.createFacingMeeting('a','user','main'),participantIds:['a','b']},meeting.scene);
 const groupStory=await story.continueFacingInStory(multi,{id:'user',name:'测试用户'});
 const multi2=await f.saveFacingMeetingStart({...f.createFacingMeeting('a','user','main'),participantIds:['b','a']},meeting.scene);
 const groupStory2=await story.continueFacingInStory(multi2,{id:'user',name:'测试用户'});
 assert.equal(groupStory.ownerType,'group');assert.equal(groupStory.ownerId,groupStory2.ownerId,'same cast reuses its existing story group');assert.notEqual(groupStory.id,groupStory2.id);
 const branch=await f.saveFacingMeetingStart(f.createFacingMeeting('a','user','branch',meeting),f.facingMeetingPosition(meeting));const merged=await f.mergeFacingMeetings(meeting.id,[branch.id]);assert.equal(merged.turns.length,2);await f.manageFacingMeetings([branch.id],'delete');assert.equal(f.loadFacingMeeting(branch.id),null);assert.ok(f.loadFacingMeeting(meeting.id));
 const phone=load('lib/character-phone-chat.ts'),phoneStore=load('lib/checkphone-storage.ts');let snap=await phone.ensureCharacterPhoneChat(chars[0]);const contacts=phone.characterPhoneContacts(chars[0],snap.payload);assert.ok(contacts.some(c=>c.peerType==='user'));assert.ok(contacts.some(c=>c.peerCharacterId==='b'));assert.ok(!contacts.some(c=>c.peerCharacterId==='c'));
 const target=contacts.find(c=>c.peerCharacterId==='b');snap=await phone.appendCharacterPhoneMessage(chars[0],target.id,'周末见','op1');assert.equal(snap.payload.conversations.find(c=>c.id===target.id).messages.length,1);
 const other=await phoneStore.loadPhoneSnapshot('b','chat');assert.equal(other.payload.conversations.find(c=>c.peerCharacterId==='a').messages[0].direction,'incoming');
 streamMode='fail';await assert.rejects(phone.replyToCharacterPhone(chars[0],target.id,new AbortController().signal,()=>{}),/接收失败/);snap=await phoneStore.loadPhoneSnapshot('a','chat');assert.ok(snap.payload.conversations.find(c=>c.id===target.id).pendingReply);
 streamMode='normal';let preview='';snap=await phone.replyToCharacterPhone(chars[0],target.id,new AbortController().signal,value=>{preview=value;});assert.match(preview,/晚点见/);assert.equal(snap.payload.conversations.find(c=>c.id===target.id).messages.length,3);assert.ok(!snap.payload.conversations.find(c=>c.id===target.id).pendingReply);
 await phone.appendCharacterPhoneMessage(chars[0],target.id,'周末见','op1');assert.equal((await phoneStore.loadPhoneSnapshot('a','chat')).payload.conversations.find(c=>c.id===target.id).messages.length,3);
 assert.equal((await phoneStore.loadPhoneSnapshot('b','chat')).payload.conversations.find(c=>c.peerCharacterId==='a').messages.length,3,'role-to-role history is mirrored atomically');
 const before=streamCalls;await phone.replyToCharacterPhone(chars[0],target.id,new AbortController().signal,()=>{});assert.equal(streamCalls,before,'completed reply retry makes no API call');
 snap=await phoneStore.updatePhoneSnapshot('a','chat',old=>({...old,payload:{...old.payload,conversations:[...old.payload.conversations,{id:'npc',name:'店员',tagLabel:'NPC',preview:'',timeLabel:'',messages:[]}]}}));
 await phone.appendCharacterPhoneMessage(chars[0],'npc','有现货吗','npc1');snap=await phone.replyToCharacterPhone(chars[0],'npc',new AbortController().signal,()=>{});assert.equal(snap.payload.conversations.find(c=>c.id==='npc').messages.length,3);
 const userContact=phone.characterPhoneContacts(chars[0],snap.payload).find(c=>c.peerType==='user');await phone.appendCharacterPhoneMessage(chars[0],userContact.id,'我到家了','user1');assert.ok(load('lib/chat-storage.ts').loadChatSessions().some(s=>load('lib/chat-storage.ts').loadChatMessages(s.id).some(m=>m.content==='我到家了')));
 // Refresh omission keeps NPC history, long conversations and pending proxy replies.
 const fresh={...snap.payload,conversations:[]};
 const omitted=phone.mergeCharacterPhoneRefresh(chars[0],snap,fresh,'omit');
 assert.equal(omitted.payload.conversations.find(c=>c.id==='npc').messages.length,3);
 const longMessages=Array.from({length:110},(_,i)=>({id:'old-'+i,text:'旧消息'+i,timeLabel:'2026-11-21T00:00:00Z',direction:'incoming'}));
 const history={...snap,payload:{...snap.payload,conversations:snap.payload.conversations.map(c=>c.id===target.id?{...c,messages:longMessages}:c)}};
 const generated={...fresh,conversations:[{...target,remark:'老朋友',messages:[{id:'new',text:'新消息',direction:'incoming',timeLabel:'2026-11-21T01:00:00Z'}]}]};
 assert.equal(phone.mergeCharacterPhoneRefresh(chars[0],history,generated,'long').payload.conversations.find(c=>c.id===target.id).messages.length,111);
 const waiting={...history,payload:{...history.payload,conversations:history.payload.conversations.map(c=>c.id===target.id?{...c,pendingReply:{operationId:'pending',sentMessageId:'old-109'}}:c)}};
 const kept=phone.mergeCharacterPhoneRefresh(chars[0],waiting,generated,'waiting').payload.conversations.find(c=>c.id===target.id);
 assert.equal(kept.messages.length,110);assert.equal(kept.pendingReply.operationId,'pending');
 // Both proxy participants retain one event per committed message, retries deduplicate.
 for(const charId of ['a','b']){
  const events=phoneStore.loadCheckPhoneProjectionEntries(charId).filter(e=>e.id.startsWith('character_phone_chat_phone_op1:'));
  assert.equal(events.length,3);assert.equal(new Set(events.map(e=>e.id)).size,3);
 }
 phoneRefreshOutput='#聊天设置1\n[用户备注]小太阳\n\n#补充会话1\n[名称]角色b\n[备注]老朋友\n[静音]否\n[置顶]否\n[标签]同世界\n[消息1方向]incoming\n[消息1时间]2026-11-21 08:00\n[消息1正文]今天一起吃饭吗？\n[消息2方向]outgoing\n[消息2时间]2026-11-21 08:01\n[消息2正文]好，老地方见。';
 const generatedPhone=await load('lib/checkphone-engine.ts').generateCheckPhoneChat('a',snap.payload);
 assert.ok(!generatedPhone.error,generatedPhone.error);assert.equal(generatedPhone.payload.userRemark,'小太阳');
 assert.equal(generatedPhone.payload.conversations.find(c=>c.name==='角色b').remark,'老朋友');
 assert.equal(generatedPhone.payload.conversations.find(c=>c.name==='角色b').messages.length,2);
 const freshContacts=phone.characterPhoneContacts(chars[0],generatedPhone.payload);assert.equal(freshContacts[0].peerType,'user');assert.equal(freshContacts[0].remark,'小太阳');assert.equal(freshContacts[0].pinned,true);
 const blockOutput=phoneRefreshOutput;
 await load('lib/checkphone-engine.ts').generateCheckPhoneChat('a',snap.payload,undefined,'b');
 assert.ok(textCalls.at(-1)[2].some(m=>m.content.includes('必须在补充会话中生成此人')&&m.content.includes('角色b')),'empty-thread generation targets the selected character in the same request');
 phoneRefreshOutput=JSON.stringify({conversations:[{peerCharacterId:'b',name:'模型使用的昵称',messages:[{text:'旧格式的聊天也要保留',direction:'incoming'},{text:'没问题',direction:'outgoing'}]}]});
 const legacyPhone=await load('lib/checkphone-engine.ts').generateCheckPhoneChat('a',snap.payload);
 assert.ok(!legacyPhone.error,legacyPhone.error);assert.equal(legacyPhone.payload.conversations.find(c=>c.peerCharacterId==='b').name,'角色b');assert.equal(legacyPhone.payload.conversations.find(c=>c.peerCharacterId==='b').messages.length,2);
 phoneRefreshOutput='<<<APP:chat>>>\n'+blockOutput+'\n<<<END_APP>>>';
 const batchStart=textCalls.length,batch=await load('lib/checkphone-engine.ts').generateCheckPhoneAppBatch('a',['chat','reading']);
 assert.equal(textCalls.length,batchStart+1,'batch generation still uses one model request');
 assert.equal(batch.items.find(item=>item.appId==='chat').payload.conversations.find(c=>c.peerCharacterId==='b').messages.length,2);
 assert.ok(textCalls.at(-1)[2].some(m=>m.content.includes('以下是他在同世界认识的角色')&&m.content.includes('角色b')),'batch uses the same world-aware rules');
 phoneRefreshOutput='#聊天设置1\n[用户备注]小太阳';
 assert.match((await load('lib/checkphone-engine.ts').generateCheckPhoneChat('a',snap.payload)).error,/没有生成同世界角色的聊天正文/);
 phoneRefreshOutput=blockOutput;
 const chatStore=load('lib/chat-storage.ts'),sessions=chatStore.loadChatSessions();
 chatStore.saveChatSessions(sessions.map(s=>s.contactId==='a'?{...s,characterRemarkForUser:'真实备注'}:s));
 const realRemark=phone.mergeCharacterPhoneRefresh(chars[0],{...snap,payload:{...snap.payload,conversations:[{...userContact,remark:'旧备注'}]}},generatedPhone.payload,'remark');
 assert.equal(realRemark.payload.conversations.find(c=>c.peerType==='user').remark,'真实备注');
 const differentUser={...generatedPhone.payload,userRemarkKey:JSON.stringify(['other-account','other-user'])};
 assert.equal(phone.characterPhoneContacts(chars[0],differentUser)[0].remark,'真实备注','real remark wins over an unrelated suggested remark');
 const realSession=chatStore.loadChatSessions().find(s=>s.contactId==='a');
 chatStore.saveChatSessions([{...realSession,id:'other-account-chat',chatAccountId:'other-account',characterRemarkForUser:'其他账号备注'},...chatStore.loadChatSessions()]);
 chatStore.pushChatMessage({sessionId:'other-account-chat',role:'user',content:'其他账号的秘密'});
 const isolated=await load('lib/checkphone-engine.ts').generateCheckPhoneChat('a',snap.payload);
 assert.equal(isolated.payload.userRemark,'真实备注');assert.ok(!JSON.stringify(isolated.payload.conversations).includes('其他账号的秘密'));
 chatStore.saveChatSessions(sessions);
 assert.equal(phone.characterPhoneContacts(chars[0],differentUser)[0].remark,undefined,'suggested remark never crosses account or identity');
 // User CSS must retain its normal targets while excluding the nested phone,
 // including timestamp rules, nested media rules and pseudo-elements.
 const fixture=document.createElement('div');fixture.className='chat-app session-demo';fixture.innerHTML='<b class="bubble"></b><section class="chat-app character-phone-chat"><b class="bubble"></b><time></time></section>';
 const css=load('lib/css-scoper.ts').scopeSessionCSS(':root{color:red}.bubble,time{display:none!important}.bubble::before{content:"x"}@media(max-width:900px){.bubble{color:red}}','.chat-app',false,'.character-phone-chat');
 let customMatches=0;require('postcss').parse(css).walkRules(rule=>{
  if(rule.selector.includes('::')){assert.ok(rule.selector.endsWith(':not(:where(.character-phone-chat, .character-phone-chat *))::before'));return;}
  for(const el of fixture.querySelectorAll('.character-phone-chat, .character-phone-chat *'))assert.equal(el.matches(rule.selector),false);
  if(fixture.querySelector('.bubble').matches(rule.selector))customMatches++;
 });assert.equal(customMatches,2);
 assert.deepEqual(load('lib/reverse-phone-replies.ts').splitReverseReply('一段\n\n二段|||三段'),['一段','二段','三段']);
 const host=document.getElementById('root');let root=createRoot(host);const Library=load('components/facing/facing-assets.tsx').FacingAssets;
 const viewStore=load('lib/character-phone-chat-view.ts');
 viewStore.saveCharacterPhoneDraft('a',target.id,'退出后继续写');assert.equal(viewStore.loadCharacterPhoneChatView('a').drafts[target.id],'退出后继续写');assert.equal(viewStore.loadCharacterPhoneChatView('b').drafts[target.id],undefined);
 const unread=viewStore.markCharacterPhoneUpdates('a',fresh,omitted.payload);assert.ok(unread.view.unread.includes('npc'));assert.ok(!viewStore.markCharacterPhoneRead('a','npc').unread.includes('npc'));
 load('lib/character-moments-profile.ts').saveCharacterMomentsProfile('a',{coverAssetId:kitchen.mediaId,signature:'角色签名'});
 const Phone=load('components/checkphone/character-phone-chat-page.tsx').CharacterPhoneChatPage;
 await act(async()=>{root.render(React.createElement(Phone,{character:chars[0],onBack(){}}));for(let i=0;i<6;i++)await tick();});
 const momentsButton=[...host.querySelectorAll('button')].find(b=>b.textContent.trim()==='动态');await act(async()=>{momentsButton.dispatchEvent(new window.Event('click',{bubbles:true}));await tick();});assert.match(host.textContent,/角色签名/);assert.match(host.querySelector('.character-phone-cover').style.backgroundImage,/data:image/);
 await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent.trim()==='消息').dispatchEvent(new window.Event('click',{bubbles:true}));await tick();});
 assert.ok(host.querySelector('.chat-app .minimal-list-item'));assert.ok([...host.querySelectorAll('.minimal-avatar-wrapper img')].some(img=>img.src===chars[1].avatar));
 const row=[...host.querySelectorAll('.minimal-list-item')].find(el=>el.textContent.includes('角色b'));await act(async()=>{row.dispatchEvent(new window.Event('click',{bubbles:true}));await tick();});
 assert.ok(host.querySelector('[aria-label="代回复内容"]'));assert.ok(host.querySelector('.chat-bubble-role-user'));assert.match(host.textContent,/晚点见/);
 const reactProps=el=>el[Object.keys(el).find(k=>k.startsWith('__reactProps$'))];
 assert.equal(reactProps(host.querySelector('[aria-label="代回复内容"]')).value,'退出后继续写');assert.match(host.textContent,/由你代发/);assert.ok(host.querySelector('.phone-chat-date-divider'));
 await act(async()=>{await phone.appendCharacterPhoneMessage(chars[0],target.id,'再确认一下','switch-chat');await tick();});
 streamMode='hold';
 await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent.includes('继续接收')).dispatchEvent(new window.Event('click',{bubbles:true}));await tick();});
 assert.match(host.textContent,/角色b正在打字中/);
 await act(async()=>{host.querySelector('[aria-label="返回"]').dispatchEvent(new window.Event('click',{bubbles:true}));await tick();});
 await act(async()=>{[...host.querySelectorAll('.minimal-list-item')].find(b=>b.textContent.includes('店员')).dispatchEvent(new window.Event('click',{bubbles:true}));await tick();});
 assert.ok(!host.textContent.includes('正在打字中'),'switching conversations must not display another contact streaming');
 await act(async()=>{releaseStream();for(let i=0;i<6;i++)await tick();});streamMode='normal';
 await act(async()=>{await phone.appendCharacterPhoneMessage(chars[0],target.id,'稍后再接收','stop-resume');host.querySelector('[aria-label="返回"]').dispatchEvent(new window.Event('click',{bubbles:true}));await tick();});
 await act(async()=>{[...host.querySelectorAll('.minimal-list-item')].find(b=>b.textContent.includes('角色b')).dispatchEvent(new window.Event('click',{bubbles:true}));await tick();});
 streamMode='hold';await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='继续接收').dispatchEvent(new window.Event('click',{bubbles:true}));await tick();});
 await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='停止接收').dispatchEvent(new window.Event('click',{bubbles:true}));for(let i=0;i<6;i++)await tick();});
 assert.match(host.textContent,/接收已停止/);assert.equal((await phoneStore.loadPhoneSnapshot('a','chat')).payload.conversations.find(c=>c.id===target.id).pendingReply.state,'stopped');
 streamMode='fail';await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='继续接收').dispatchEvent(new window.Event('click',{bubbles:true}));for(let i=0;i<6;i++)await tick();});assert.match(host.textContent,/接收失败，已发消息保留/);
 streamMode='normal';await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='继续接收').dispatchEvent(new window.Event('click',{bubbles:true}));for(let i=0;i<6;i++)await tick();});
 assert.equal((await phoneStore.loadPhoneSnapshot('a','chat')).payload.conversations.find(c=>c.id===target.id).messages.filter(m=>m.id==='phone_stop-resume:out').length,1,'continue only receives, never resends');
 await act(async()=>root.unmount());root=createRoot(host);

 // Materials across different places are siblings in one rail; portrait folders
 // each retain their own rail, with the vertical parent permitting both axes.
 await asset('bathroom','a','scene','浴室');await asset('sprite2','a','portrait','微笑');
 await act(async()=>{root.render(React.createElement(Library,{character:chars[0],assets:f.loadFacingAssets('a'),groups:f.groupFacingScenes(f.loadFacingAssets('a')),onBack(){},onChange(){},async onDelete(){}}));await tick();});
 assert.equal(host.querySelectorAll('.facing-scene-rail > .facing-scene-card').length,2);
 assert.ok([...host.querySelectorAll('.facing-asset-rail')].some(rail=>rail.querySelectorAll('.facing-library-tile').length===2));
 assert.ok(host.querySelector('.facing-assets-scroll'));
 const materialCSS=require('postcss').parse(fs.readFileSync(path.join(project,'styles/facing-life.css'),'utf8'));
 let parentPan=false,noWrap=false;materialCSS.walkRules(rule=>{if(rule.selector==='.facing-app .facing-assets-scroll')rule.walkDecls('touch-action',d=>{parentPan=d.value==='pan-x pan-y';});if(rule.selector.includes(':is(.facing-scene-rail,.facing-asset-rail)'))rule.walkDecls('flex-flow',d=>{noWrap=d.value==='row nowrap';});});assert.ok(parentPan&&noWrap);
 await act(async()=>root.unmount());root=createRoot(host);

 await act(async()=>{root.render(React.createElement(Library,{character:chars[0],assets:f.loadFacingAssets('a'),groups:f.groupFacingScenes(f.loadFacingAssets('a')),initialAssetId:sprite.id,onBack(){},onChange(){},async onDelete(){}}));await tick();});
 const props=el=>el[Object.keys(el).find(k=>k.startsWith('__reactProps$'))];const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
 assert.equal(props(host.querySelector('[aria-label="素材画面描述"]')).value,'原立绘文案');assert.ok(host.textContent.includes('AI生成预览'));
 const labels=[...host.querySelectorAll('label')];const ref=labels.find(l=>l.textContent.includes('开启参考图')).querySelector('input'),avatar=labels.find(l=>l.textContent.includes('开启参考头像')).querySelector('input');
 await act(async()=>{props(ref).onChange({target:{checked:true}});await tick();});assert.equal(props(avatar).checked,false);await act(async()=>{button('AI生成预览').dispatchEvent(new window.Event('click',{bubbles:true}));await tick();});assert.equal(imageCalls.at(-1).explicitReferenceImage,png('reference'));
 await act(async()=>{button('保存素材').dispatchEvent(new window.Event('click',{bubbles:true}));for(let i=0;i<6;i++)await tick();});const replaced=f.loadFacingAssets('a').find(a=>a.id===sprite.id);assert.notEqual(replaced.mediaId,sprite.mediaId);assert.equal(replaced.description,'原立绘文案');assert.ok(f.loadFacingAssets('a').find(a=>a.id===kitchen.id).portraitIds.includes(sprite.id));await act(async()=>root.unmount());
 // The clipboard fallback restores the scroll container even if selection scrolls it.
 const scroll=document.createElement('div');document.body.append(scroll);scroll.scrollTop=231;window.HTMLElement.prototype.focus=function(){};window.HTMLTextAreaElement.prototype.select=function(){scroll.scrollTop=999;};await load('lib/clipboard-view.ts').copyTextPreservingView('坐标',scroll);assert.equal(scroll.scrollTop,231);
 console.log('PASS continuity: individual/batch and targeted phone generation, legacy JSON and role ID matching, refresh/long history preservation, drafts/unread/proxy labels/timestamps, stop/failure/resume without resending, memory deduplication and account isolation, horizontal scene/portrait rails, CSS boundary, story handoff and existing scene/record workflows.');
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e instanceof Error?e.stack:String(e));process.exit(1);});
