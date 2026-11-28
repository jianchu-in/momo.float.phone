// Real IndexedDB/KV, native memory, map and facing UI. Summary transport is simulated.
const {assert,React,act,createRoot,load,tick,mock,props}=require('./helpers/component-test-env.cjs');
mock('lib/tts-service.ts',{unlockAudioPlayback(){},resolveVoiceConfig:()=>null});
mock('components/facing/use-facing-viewport-inset.ts',{useFacingViewportInset:()=>0});
mock('components/facing/facing-stage.tsx',{FacingStage:({children})=>React.createElement('div',null,children)});
mock('components/facing/use-facing-scene-generation.ts',{useFacingSceneGeneration:()=>({check(){},retry(){},progress:{}})});

async function main(){
  const kv=load('lib/kv-db.ts');await kv.hydrateKvDb();await load('lib/settings-db.ts').hydrateSettingsDb();await load('lib/chat-storage.ts').hydrateChatStorage();
  const f=load('lib/facing-storage.ts'),maps=load('lib/facing-map-storage.ts'),entry=load('lib/facing-map-entry.ts');
  const memory=load('lib/memory-storage.ts'),deletion=load('lib/facing-memory-deletion.ts'),sources=load('lib/memory-source-deletions.ts');
  const chars=['a','b','c','d'].map(id=>({id,name:'角色'+id,avatar:'',createdAt:'',updatedAt:''}));load('lib/character-storage.ts').saveCharacters(chars);
  for(const id of ['a','b','c','d'])await f.saveFacingSettings(id,{voice:false,memory:true});
  await f.saveFacingGroup('双人组',['a','b']);
  let atlas=await maps.createFacingAtlas('world','测试城市',['a','b','c','d'],[]);
  atlas=await maps.saveMapPage(atlas.id,{...atlas.pages[0],places:[{id:'park',name:'游乐园',description:'游乐设施',x:0,y:0},{id:'mall',name:'商场',description:'商店',x:10,y:10}]});
  let meeting=await entry.enterFacingMapPlace({atlasId:atlas.id,trip:{placeId:'park',characterIds:['a','b'],secret:false},visitId:'trip-one',leadId:'a',identityId:null});
  const makeTurn=(id,text,role='user')=>({id,text,role,kind:role==='user'?'text':'reply',sceneName:'游乐园',at:new Date().toISOString()});
  meeting=await f.appendFacingTurns(meeting,[makeTurn('delete-one','删除的消息'),{...makeTurn('dependent-reply','直接关联的回复','assistant'),replyTo:'delete-one',speakerId:'b',speakerName:'角色b'},makeTurn('keep-reply','保留的回复','assistant')]);
  const copy=await f.saveFacingMeetingStart(f.createFacingMeeting('a',null,'branch',meeting),meeting.scene);
  meeting=await f.addFacingParticipants(meeting.id,['c']);
  const other=await entry.enterFacingMapPlace({atlasId:atlas.id,trip:{placeId:'mall',characterIds:['d'],secret:false},visitId:'other-trip',leadId:'d',identityId:null});
  const key=(id,sessionId=meeting.id)=>load('lib/native-timeline-key.ts').getNativeTimelineEntryKey({sourceApp:'facing',sessionId,id});
  const meta=(id,sessionId=meeting.id)=>({sourceSessionIds:[sessionId],sourceEntryKeys:[key(id,sessionId)],sourceEventKeys:[sources.memorySourceEventKey({sourceApp:'facing',id})]});
  const save=(id,characterId,metadata,type='long_term')=>memory.saveMemoryEntry({id,characterId,metadata,type,content:id,sourceApp:'facing',importance:.8,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  await save('a-long','a',meta('delete-one'));await save('a-core','a',{sourceMemoryIds:['a-long']},'core');
  await save('a-dependent','a',meta('dependent-reply'));
  await save('a-legacy','a',{sourceSessionIds:[meeting.id]});await save('a-clean','a',meta('keep-reply'));await save('a-other','a',meta('other-trip:arrival',other.id));
  await save('b-copy','b',meta('delete-one',copy.id));await save('c-unrelated','c',meta('delete-one'));
  await save('d-unrelated','d',{sourceSessionIds:[other.id]});
  const originalUpdate=kv.kvUpdatePersistedEntries;
  const failTransaction=()=>{kv.kvUpdatePersistedEntries=updates=>originalUpdate({...updates,__test_failure:()=>{throw new Error('模拟事务失败');}});};
  const before=JSON.stringify(f.loadFacingMeeting(meeting.id));
  failTransaction();await assert.rejects(deletion.deleteFacingMessages(meeting.id,['delete-one']),/模拟事务失败/);kv.kvUpdatePersistedEntries=originalUpdate;
  assert.equal(JSON.stringify(f.loadFacingMeeting(meeting.id)),before);assert.equal(kv.kvGet(sources.memorySourceDeletionKey('a')),null,'failed transaction cannot publish deletion markers');
  assert.equal((await memory.loadMemoryEntries('a')).length,6);
  meeting=await deletion.deleteFacingMessages(meeting.id,['delete-one']);
  assert.ok(!meeting.turns.some(turn=>turn.id==='delete-one'));assert.equal(meeting.turns.find(turn=>turn.id==='dependent-reply').replyTo,undefined);
  assert.ok(f.loadFacingMeeting(copy.id).turns.some(turn=>turn.id==='delete-one'),'other transcripts are preserved');
  assert.equal(f.facingVisualMatches(copy,copy.turns.find(turn=>turn.id==='delete-one'),'stale-cg',copy.sceneRevision??0),false,'a stale image job cannot apply against a deleted copied event');
  const timeline=load('lib/short-term-assembler.ts');assert.ok(!timeline.loadNativeTimeline('a').some(item=>item.id==='delete-one'),'a copied turn cannot restore the deleted memory');
  assert.ok(!timeline.loadNativeTimeline('a').some(item=>item.id==='dependent-reply'),'direct responses cannot retain the removed event as recent memory');
  assert.deepEqual((await memory.loadMemoryEntries('a')).map(item=>item.id).sort(),['a-clean','a-other']);
  assert.deepEqual((await memory.loadMemoryEntries('b')).map(item=>item.id),[]);
  assert.deepEqual((await memory.loadMemoryEntries('c')).map(item=>item.id),['c-unrelated'],'a late joiner did not witness the deleted turn');
  assert.equal((await memory.loadMemoryEntries('d'))[0].id,'d-unrelated');
  await assert.rejects(save('stale-summary','a',meta('delete-one')),/记忆来源已删除/);
  await assert.rejects(f.appendFacingTurn(meeting,{...makeTurn('late-reply','旧请求的回复','assistant'),replyTo:'delete-one'}),/对应消息已删除/);
  await deletion.deleteFacingMessages(meeting.id,['delete-one']);
  // Both physical rows and prompt reads lose derived summaries.
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('ai_phone_memory_db_v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const raw=await new Promise((resolve,reject)=>{const request=db.transaction('memories').objectStore('memories').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});db.close();
  assert.ok(!raw.some(item=>['a-long','a-core','a-legacy','b-copy'].includes(item.id)));

  await save('arrival-memory','a',meta('trip-one:arrival'));
  const host=document.getElementById('root');let root=createRoot(host),changed=0;
  const MapApp=load('components/facing/facing-map-app.tsx').FacingMapApp;
  await act(async()=>{root.render(React.createElement(MapApp,{character:chars[0],characters:chars,currentMeeting:meeting,onBack(){},onSettings(){},onArrive(){},onRecordsChanged(){changed++;}}));await tick();});
  async function click(label){const node=[...host.querySelectorAll('button')].find(node=>node.textContent.trim()===label||node.getAttribute('aria-label')===label);assert.ok(node,label);await act(async()=>{node.click();for(let i=0;i<4;i++)await tick();});}
  await click('历史');await click('删除出行记录到游乐园');assert.ok(host.querySelector('[aria-label="删除出行记录"]'));
  await click('取消');assert.ok(maps.loadFacingAtlas(atlas.id).visits.some(item=>item.id==='trip-one'));
  await click('删除出行记录到游乐园');failTransaction();await click('删除记录及相关记忆');kv.kvUpdatePersistedEntries=originalUpdate;
  assert.match(host.querySelector('[aria-label="删除出行记录"]').textContent,/模拟事务失败/);assert.ok(maps.loadFacingAtlas(atlas.id).visits.some(item=>item.id==='trip-one'));
  await click('删除记录及相关记忆');assert.equal(changed,1);assert.equal(host.querySelector('[data-visit-id="trip-one"]'),null);
  atlas=maps.loadFacingAtlas(atlas.id);assert.deepEqual(atlas.visits.map(item=>item.id),['other-trip']);assert.ok(atlas.deletedVisitIds.includes('trip-one'));
  assert.ok(!f.loadFacingMeeting(meeting.id).turns.some(turn=>turn.id==='trip-one:arrival'));assert.equal(f.loadFacingMeeting(meeting.id).mapContext.arrival,undefined);
  assert.ok(!f.loadFacingMeeting(copy.id).turns.some(turn=>turn.id==='trip-one:arrival'));
  assert.ok(!(await memory.loadMemoryEntries('a')).some(item=>item.id==='arrival-memory'));
  assert.ok(f.loadFacingMeeting(meeting.id).turns.some(turn=>turn.id==='keep-reply'));assert.ok(f.loadFacingMeeting(other.id));
  await deletion.deleteMapVisitAndMemories(atlas.id,'trip-one',null);
  await assert.rejects(entry.enterFacingMapPlace({atlasId:atlas.id,trip:{placeId:'park',characterIds:['a','b'],secret:false},visitId:'trip-one',leadId:'a',identityId:null}),/出行记录已删除/);
  // Wrong-identity deletes must fail before changing data.
  await assert.rejects(deletion.deleteMapVisitAndMemories(atlas.id,'other-trip','another-identity'),/当前身份/);
  await act(async()=>root.unmount());

  // Exercise the actual message deletion confirmation and a failed save followed by retry.
  root=createRoot(host);const App=load('components/facing/facing-app.tsx').FacingApp;
  await act(async()=>{root.render(React.createElement(App,{onClose(){},initialMeetingId:other.id}));await tick();});
  const messageNode=host.querySelector('.facing-message');assert.ok(messageNode);
  await act(async()=>{props(messageNode).onContextMenu({preventDefault(){}});await tick();});await click('删除');
  assert.match(host.querySelector('[aria-label="消息操作"]').textContent,/长期、核心摘要也会移除/);
  failTransaction();await click('确认删除');kv.kvUpdatePersistedEntries=originalUpdate;
  assert.match(host.querySelector('[aria-label="消息操作"]').textContent,/模拟事务失败/);assert.ok(f.loadFacingMeeting(other.id).turns.length);
  await click('确认删除');assert.equal(host.querySelector('[aria-label="消息操作"]'),null);assert.equal(maps.loadFacingAtlas(atlas.id).visits.length,0,'deleting an arrival message also removes the map log');
  await act(async()=>root.unmount());

  // Deletion during an in-flight summary cannot save stale memory or advance its watermark.
  const settings=load('lib/settings-storage.ts');settings.saveApiConfigs([{id:'summary-api',name:'mock',provider:'openai',defaultModel:'mock'}]);
  const bindings=settings.loadBindingConfig();bindings.globalDefaults.apiConfigId='summary-api';bindings.memorySummaryApiConfigId='summary-api';settings.saveBindingConfig(bindings);
  let sent;
  load('lib/chat-engine.ts').sendLLMRequest=async(...args)=>{sent=args[2];return JSON.stringify({replies:[{speaker_id:'a',dialogue:'新回复',action:''}]});};
  const copied=await f.appendFacingTurn(f.loadFacingMeeting(copy.id),makeTurn('new-question','新问题'));
  await load('lib/facing-engine.ts').generateFacingReply({character:chars[0],meeting:copied,settings:{memory:false},scene:'游乐园',scenes:[],speakerId:'a',signal:new AbortController().signal});
  assert.doesNotMatch(JSON.stringify(sent),/删除的消息/,'continuing a retained fork must not send the deleted event back to the model');
  assert.doesNotMatch(JSON.stringify(sent),/直接关联的回复/);
  assert.match(JSON.stringify(sent),/保留的回复/);
  memory.saveMemoryConfig({...memory.loadMemoryConfig(),vectorRecallEnabled:false,autoBuildCoreEnabled:false});
  let race=await f.saveFacingMeetingStart(f.createFacingMeeting('a',null,'main'),{sceneName:'公园'});
  race=await f.appendFacingTurns(race,Array.from({length:5},(_,index)=>({...makeTurn('race-'+index,'事件'+index),sceneName:'公园'})));
  const apiHelpers=load('lib/api-helpers.ts');let release,started=false;
  apiHelpers.simpleLLMCall=async()=>{started=true;return new Promise(resolve=>{release=resolve;});};
  const summary=load('lib/memory-summarizer.ts').runSummarizationPipeline('a','角色a',{force:true});
  for(let i=0;i<20&&!started;i++)await tick();assert.ok(started);
  const watermark=memory.getLastSummarizedTimestamp('a');await deletion.deleteFacingMessages(race.id,['race-0']);release({content:'含已删除事件的旧摘要'});
  assert.equal((await summary).success,false);assert.equal(memory.getLastSummarizedTimestamp('a'),watermark);
  assert.ok(!(await memory.loadMemoryEntries('a')).some(item=>item.content==='含已删除事件的旧摘要'));
  await save('race-long','a',meta('race-1',race.id));started=false;
  const core=load('lib/core-memory-builder.ts').runCoreMemoryPipeline('a','角色a',{force:true});
  for(let i=0;i<20&&!started;i++)await tick();assert.ok(started);
  await deletion.deleteFacingMessages(race.id,['race-1']);release({content:'旧核心摘要'});assert.equal((await core).success,false);
  assert.ok(!(await memory.loadMemoryEntries('a')).some(item=>item.content==='旧核心摘要'));
  await save('race-clean','a',meta('race-2',race.id));await f.manageFacingMeetings([race.id],'delete');assert.equal(f.loadFacingMeeting(race.id),null);
  assert.ok(!(await memory.loadMemoryEntries('a')).some(item=>item.id==='race-clean'));await assert.rejects(f.appendFacingTurn(race,makeTurn('late','晚到消息')),/见面记录已移除/);
  const backup=load('lib/data-management/backup.ts');const archive=await backup.createBackupBlob(['creative','memory']);
  await kv.kvUpdatePersisted(sources.memorySourceDeletionKey('a'),()=>JSON.stringify({sources:[],memoryIds:[]}));
  const restored=await backup.importBackupBlob(archive.blob,['creative','memory'],{overwrite:true});assert.deepEqual(restored.errors,[]);
  assert.ok(!timeline.loadNativeTimeline('a').some(item=>item.id==='delete-one'));assert.ok(maps.loadFacingAtlas(atlas.id).deletedVisitIds.includes('trip-one'));
  console.log('PASS facing memory deletion: atomic rollback/retry, native and copied-event removal, exact/legacy/core summary cleanup, late-joiner/other-record isolation, map and message confirmation UI, arrival cascade, stale visit/reply/summary prevention, whole-record deletion and backup restoration.');
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.stack??error);process.exit(1);});
