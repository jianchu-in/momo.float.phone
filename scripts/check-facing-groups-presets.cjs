// Real settings, assets, meetings, favorites, backup and React. No model calls.
const { assert, React, act, createRoot, load, tick, mock, props } = require('./helpers/component-test-env.cjs');
mock('lib/tts-service.ts',{unlockAudioPlayback(){},resolveVoiceConfig:()=>null});
mock('components/facing/use-facing-viewport-inset.ts',{useFacingViewportInset:()=>0});
mock('components/facing/facing-stage.tsx',{FacingStage:({children})=>React.createElement('div',null,children)});
mock('components/facing/use-facing-scene-generation.ts',{useFacingSceneGeneration:()=>({check(){},retry(){},progress:{}})});
async function main(){
 const kv=load('lib/kv-db.ts');await kv.hydrateKvDb();await load('lib/settings-db.ts').hydrateSettingsDb();
 const f=load('lib/facing-storage.ts'),fav=load('lib/favorites-storage.ts'),theme=load('lib/theme-storage.ts');
 const chars=['a','b','c'].map(id=>({id,name:'角色'+id,avatar:'',createdAt:'',updatedAt:''}));load('lib/character-storage.ts').saveCharacters(chars);
 await f.saveFacingParticipants(['a']);await f.saveFacingSettings('a',{portraitId:'a-default',voice:false,autoVisual:{referenceMediaRef:'a-private'}});await f.saveFacingSettings('b',{portraitId:'b-default',autoVisual:{referenceMediaRef:'b-private'}});
 await f.saveFacingTargetSettings({characterId:'a',participantIds:['a']},{replyFormat:'free',dialogueNotation:'quoted',autoVisual:{enabled:true,interval:7,referenceSource:'upload'}});
 await f.saveFacingPreset('自由对话');await f.saveFacingTargetSettings({characterId:'a',participantIds:['a']},{replyFormat:'alternating',autoVisual:{interval:3}});
 const preset=f.loadFacingSettings().presets[0];assert.equal(preset.values.autoVisual.referenceMediaRef,undefined);
 assert.equal(f.facingEffectiveSettings('b').replyFormat,undefined,'editing A never changes B');await f.applyFacingPreset(preset.id,{characterId:'b',participantIds:['b']});assert.equal(f.facingEffectiveSettings('a').replyFormat,'alternating');assert.equal(f.facingEffectiveSettings('b').replyFormat,'free');assert.equal(f.facingEffectiveSettings('b').autoVisual.interval,7);assert.equal(f.facingEffectiveSettings('b').autoVisual.referenceMediaRef,'b-private');assert.equal(f.facingEffectiveSettings('a').portraitId,'a-default');
 let prefs=await f.saveFacingGroup('周末碰面',['a','b']);const group=prefs.groups[0];await f.saveFacingGroup('改过名字',['a','b']);assert.equal(f.loadFacingSettings().groups.length,1);assert.equal(f.loadFacingSettings().groups[0].id,group.id);
 const blob=new Blob(['original PNG bytes'],{type:'image/png'});
 const make=(id,owner,category,name)=>f.saveFacingAsset({id,characterId:owner,category,name,use:category==='scene'?'scene':'idle',durationMs:1},blob,'image/png');
 const a=await make('a-home','a','scene','客厅'),b=await make('b-home','b','scene','客厅');await make('park',f.FACING_SHARED_CHARACTER_ID,'scene','公园');const sprite=await make('b-default','b','portrait','默认');
 const groups=f.facingCastScenes(['a','b'],{a:'角色a',b:'角色b'});assert.ok(groups.some(g=>g.name==='角色a · 客厅'&&g.backdrop.id===a.id));assert.ok(groups.some(g=>g.name==='角色b · 客厅'&&g.backdrop.id===b.id));assert.ok(groups.some(g=>g.name==='通用 · 公园'));
 const picked=groups.find(g=>g.backdrop?.id===b.id);const scene=f.facingScenePosition(picked);
 const meeting=await f.saveFacingMeetingStart({...f.createFacingMeeting('a',null,'main'),groupId:group.id,participantIds:['a','b']},scene);
 await f.saveFacingParticipants(['c']);await f.saveFacingParticipants(['a','b'],group.id);assert.equal(f.loadFacingMeetings('a',null,true).find(m=>m.id===meeting.id).scene.sceneId,b.id);
 let speaker;function Speaker(){speaker=load('components/facing/use-facing-speaker.ts').useFacingSpeaker(chars[1],'通用 · 公园',true);return null;}
 let root=createRoot(document.getElementById('root'));await act(async()=>{root.render(React.createElement(Speaker));await tick();});assert.equal(speaker.portrait.id,sprite.id,'B uses own default away from B home');await act(async()=>root.unmount());
 const saved=await fav.addImageFavorite({category:'facing',sourceId:b.id,mediaUrl:`theme-asset://${b.mediaId}`,title:'客厅CG',participantIds:['a','b']});const again=await fav.addImageFavorite({category:'facing',sourceId:b.id,mediaUrl:`theme-asset://${b.mediaId}`,title:'客厅CG',participantIds:['a','b']});assert.equal(saved.id,again.id);
 await f.deleteFacingAssets('b',[b.id]);assert.ok(await theme.getThemeAssetDataUrl(b.mediaId),'favorite retains original after source deletion');
 const backup=load('lib/data-management/backup.ts');const archive=await backup.createBackupBlob(['creative','desktop','favorites']);const before=f.loadFacingSettings();await kv.kvUpdatePersisted(f.FACING_SETTINGS_KEY,()=>JSON.stringify({characters:{}}));await fav.deleteFavoriteItems([saved.id]);const restored=await backup.importBackupBlob(archive.blob,['creative','desktop','favorites'],{overwrite:true});assert.deepEqual(restored.errors,[]);assert.deepEqual(f.loadFacingSettings().groups,before.groups);assert.deepEqual(f.loadFacingSettings().groupSettings,before.groupSettings);assert.deepEqual(f.loadFacingSettings().presets,before.presets);assert.equal((await fav.listFavoriteItems()).length,1);
 const host=document.getElementById('root'),App=load('components/facing/facing-app.tsx').FacingApp;root=createRoot(host);await act(async()=>root.render(React.createElement(App,{onClose(){}})));
 async function click(label){const node=[...host.querySelectorAll('button')].find(n=>n.textContent.trim()===label||n.getAttribute('aria-label')===label);assert.ok(node,label);await act(async()=>{node.click();await tick();});}
 await click('设置');await click('成员素材与语音');await click('设置角色b的素材与语音');assert.equal(f.loadFacingSettings().characterId,'a');assert.deepEqual(f.loadFacingSettings().participantIds,['a','b']);assert.ok(host.querySelector('[aria-label="角色语音方案"]'));
 await click('本组参数');const selector=host.querySelector('[aria-label="选择参数预设"]');await act(async()=>props(selector).onChange({target:{value:preset.id}}));await click('应用预设');assert.equal(host.querySelector('[aria-label="生成格式"]').value,'free');
 await act(async()=>root.unmount());console.log('PASS named groups, distinct location ownership, own-sprite fallback, independent character/group parameters and private references, presets, source deletion retention and full backup restoration + role-selector UI.');
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.stack??error);process.exit(1);});
