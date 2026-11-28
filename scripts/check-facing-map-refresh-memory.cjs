// Real saved trips, deleted memories, retained map history, prompt assembly and refresh UI.
const {assert,React,act,createRoot,load,tick,mock}=require('./helpers/component-test-env.cjs');
const calls=[];
mock('lib/chat-engine.ts',{sendLLMRequestPreferStream:async(...args)=>{
  calls.push(args);
  return JSON.stringify({entries:[{characterId:'a',placeId:'home',activity:'在家处理事务',time:new Date().toISOString()},
    {characterId:'b',placeId:'library',activity:'在图书馆看书',time:new Date().toISOString()},
    {characterId:'c',placeId:'home',activity:'推测在家休息',time:new Date().toISOString()}]});
}});

async function main(){
  const kv=load('lib/kv-db.ts');await kv.hydrateKvDb();await load('lib/settings-db.ts').hydrateSettingsDb();await load('lib/chat-storage.ts').hydrateChatStorage();
  const settings=load('lib/settings-storage.ts');settings.saveApiConfigs([{id:'api',name:'mock',provider:'openai',defaultModel:'mock'}]);
  const binding=settings.loadBindingConfig();binding.globalDefaults.apiConfigId='api';settings.saveBindingConfig(binding);
  const chars=['a','b','c'].map(id=>({id,name:'角色'+id,persona:id==='b'?'喜欢独自看书':'有自己的日常作息',avatar:'',createdAt:'',updatedAt:''}));load('lib/character-storage.ts').saveCharacters(chars);
  const f=load('lib/facing-storage.ts'),maps=load('lib/facing-map-storage.ts'),entry=load('lib/facing-map-entry.ts');
  let atlas=await maps.createFacingAtlas('world','世界地图',['a','b','c'],[]);
  atlas=await maps.saveMapPage(atlas.id,{...atlas.pages[0],places:[
    {id:'park',name:'游乐园',description:'游乐设施',x:0,y:0},
    {id:'home',name:'家',description:'居住区',x:30,y:30},
    {id:'library',name:'图书馆',description:'阅读区',x:60,y:60} ]});
  const trip=await entry.enterFacingMapPlace({atlasId:atlas.id,trip:{placeId:'park',characterIds:['a','b','c'],secret:false},visitId:'test-park',leadId:'a',identityId:null});
  atlas=await maps.updateFacingAtlas(atlas.id,current=>({...current,snapshots:[{id:'stale',createdAt:new Date().toISOString(),entries:chars.map(character=>({characterId:character.id,placeId:'park',activity:'旧测试动向：永远在游乐园排队',time:new Date().toISOString()}))}]}));
  const memory=load('lib/memory-storage.ts');
  await memory.saveMemoryEntry({id:'old-long',characterId:'a',type:'long_term',sourceApp:'facing',content:'测试一起前往游乐园的记忆',importance:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),metadata:{sourceSessionIds:[trip.id]}});
  await load('lib/facing-memory-deletion.ts').deleteMapVisitAndMemories(atlas.id,'test-park',null);
  atlas=maps.loadFacingAtlas(atlas.id);assert.equal(atlas.visits.length,0);assert.equal((await memory.loadMemoryEntries('a')).length,0);
  assert.equal(atlas.snapshots[0].entries[0].placeId,'park','old map history is retained for viewing');
  const records=load('lib/short-term-memory-records.ts');
  for(const [id,text,sceneName] of [['a','现在已回家处理事务','家'],['b','今天在图书馆看书','图书馆']]){
    const current=await f.saveFacingMeetingStart(f.createFacingMeeting(id,null,'main'),{sceneName});
    await f.appendFacingTurn(current,{id:'current-'+id,role:'user',kind:'text',text,sceneName,at:new Date().toISOString()});
  }
  const engine=load('lib/facing-map-engine.ts');
  function checkPrompt(){
    const messages=calls.at(-1)[2],input=JSON.parse(messages[1].content);
    assert.deepEqual(Object.keys(input).sort(),['当前时间','角色资料与记忆','可选地点'].sort());
    assert.doesNotMatch(JSON.stringify(input.角色资料与记忆),/旧测试动向|测试一起前往游乐园/);
    assert.match(JSON.stringify(input.角色资料与记忆),/现在已回家处理事务/);assert.match(JSON.stringify(input.角色资料与记忆),/今天在图书馆看书/);
    assert.match(messages[0].content,/逐个角色独立判断/);assert.doesNotMatch(messages[0].content,/不确定的行程保持连贯/);
    assert.equal(input.可选地点.find(place=>place.id==='park').path,'游乐园','the place remains selectable without importing deleted history');
  }
  for(let count=0;count<3;count++){
    const result=await engine.refreshMapActivities(chars[0],maps.loadFacingAtlas(atlas.id),chars,new AbortController().signal);checkPrompt();
    atlas=await maps.updateFacingAtlas(atlas.id,current=>({...current,snapshots:[...current.snapshots,result]}));
    assert.deepEqual(maps.mapActivitySnapshot(atlas).entries.map(item=>[item.characterId,item.placeId]),[['a','home'],['b','library'],['c','home']]);
  }
  assert.equal(calls.length,3,'one model request per refresh');assert.equal(atlas.visits.length,0,'refreshing activities does not invent a completed trip');
  // Deleting a memory alone must not let the separate visit table bypass that deletion.
  const retained=await entry.enterFacingMapPlace({atlasId:atlas.id,trip:{placeId:'park',characterIds:['a','b'],secret:false},visitId:'memory-hidden-trip',leadId:'a',identityId:null});
  const timeline=load('lib/short-term-assembler.ts');
  for(const id of ['a','b'])records.hideNativeTimelineEntries(id,timeline.loadNativeTimeline(id).filter(item=>item.id==='memory-hidden-trip:arrival'));
  atlas=maps.loadFacingAtlas(atlas.id);assert.ok(atlas.visits.some(item=>item.id==='memory-hidden-trip'));
  await engine.refreshMapActivities(chars[0],atlas,chars,new AbortController().signal);checkPrompt();
  assert.ok(!JSON.stringify(JSON.parse(calls.at(-1)[2][1].content).角色资料与记忆).includes('memory-hidden-trip'));
  // The real refresh button uses the same cleaned prompt and switches back to the latest result.
  const legacy=Array.from({length:16},(_,index)=>({id:'legacy-'+index,createdAt:new Date(Date.now()-(16-index)*60000).toISOString(),entries:[{characterId:'a',placeId:'park',activity:'旧测试动向：永远在游乐园排队',time:new Date().toISOString()}]})).reverse();
  await kv.kvUpdatePersisted(maps.FACING_MAP_PREFIX+atlas.id,raw=>JSON.stringify({...JSON.parse(raw),snapshots:legacy}));
  assert.deepEqual(maps.loadFacingAtlas(atlas.id).snapshots.map(item=>item.id),Array.from({length:10},(_,index)=>'legacy-'+(index+6)),'existing unsorted history exposes only the ten newest timestamps');
  const host=document.getElementById('root'),root=createRoot(host),MapApp=load('components/facing/facing-map-app.tsx').FacingMapApp;
  await act(async()=>{root.render(React.createElement(MapApp,{character:chars[0],characters:chars,currentMeeting:retained,onBack(){},onSettings(){},onArrive(){}}));await tick();});
  await act(async()=>{await tick();await tick();});
  const cleaned=JSON.parse(await kv.kvReadPersisted(maps.FACING_MAP_PREFIX+atlas.id));assert.equal(cleaned.snapshots.length,10,'opening an older map permanently removes excess history');
  assert.ok(cleaned.visits.some(item=>item.id==='memory-hidden-trip'),'retention only cleans generated activity history');
  const button=[...host.querySelectorAll('button')].find(node=>node.textContent.includes('刷新动向'));assert.ok(button);
  const before=maps.loadFacingAtlas(atlas.id).snapshots.length;
  await act(async()=>{button.click();for(let i=0;i<8;i++)await tick();});checkPrompt();
  const updated=maps.loadFacingAtlas(atlas.id);assert.equal(updated.snapshots.length,Math.min(before+1,10));assert.equal(maps.mapActivitySnapshot(updated).entries.find(item=>item.characterId==='b').placeId,'library');
  assert.equal(JSON.parse(await kv.kvReadPersisted(maps.FACING_MAP_PREFIX+atlas.id)).snapshots.length,10,'a new refresh durably removes the oldest record');
  assert.equal(calls.length,5);await act(async()=>root.unmount());
  console.log('PASS map refresh: deleted trip/memory plus retained park snapshots, three clean prompts, independent current memories, visit-table isolation, timestamp-based ten-record retention and old-data cleanup, one request per refresh and real UI persistence.');
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.stack??error);process.exit(1);});
