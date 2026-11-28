// Real settings, legacy migration, persistence and React; no model calls.
const {assert,React,act,createRoot,load,tick,mock,props}=require('./helpers/component-test-env.cjs');
mock('lib/tts-service.ts',{unlockAudioPlayback(){},resolveVoiceConfig:()=>null});
mock('components/facing/use-facing-viewport-inset.ts',{useFacingViewportInset:()=>0});
mock('components/facing/facing-stage.tsx',{FacingStage:({children})=>React.createElement('div',null,children)});
mock('components/facing/use-facing-scene-generation.ts',{useFacingSceneGeneration:()=>({check(){},retry(){},progress:{}})});

async function main(){
  const kv=load('lib/kv-db.ts');await kv.hydrateKvDb();await load('lib/settings-db.ts').hydrateSettingsDb();await load('lib/chat-storage.ts').hydrateChatStorage();
  const f=load('lib/facing-storage.ts');
  const chars=['a','b','c'].map(id=>({id,name:'角色'+id,avatar:'',createdAt:'',updatedAt:''}));load('lib/character-storage.ts').saveCharacters(chars);
  const a={characterId:'a',participantIds:['a']},b={characterId:'b',participantIds:['b']};
  const ab={characterId:'a',participantIds:['a','b']},ac={characterId:'a',participantIds:['a','c']};
  const effective=target=>f.facingEffectiveSettings(target.characterId,undefined,target);
  // Upgrade the previous global-settings release without replacing either individual's original values.
  await kv.kvUpdatePersisted(f.FACING_SETTINGS_KEY,()=>JSON.stringify({characterId:'a',participantIds:['a','b'],groups:[{id:'old-ab',name:'旧多人组',participantIds:['a','b']}],characters:{
    a:{replyFormat:'alternating',length:'custom',customReplyLength:111,portraitId:'a-sprite',autoVisual:{referenceMediaRef:'a-private',interval:3}},
    b:{replyFormat:'free',length:'custom',customReplyLength:222,portraitId:'b-sprite',autoVisual:{referenceMediaRef:'b-private',interval:4}}
  },common:{replyFormat:'free',length:'custom',customReplyLength:333,autoVisual:{interval:7}}}));
  assert.equal(effective(a).customReplyLength,111);assert.equal(effective(b).customReplyLength,222);assert.equal(effective(ab).customReplyLength,333);
  assert.equal(effective(ab).autoVisual.referenceMediaRef,'a-private');
  await f.saveFacingTargetSettings(ab,{customReplyLength:444,autoVisual:{interval:8},appearance:{textSize:18}});
  assert.equal(effective(a).customReplyLength,111);assert.equal(effective(b).customReplyLength,222);
  await f.saveFacingGroup('',ac.participantIds);assert.equal(effective(ac).customReplyLength,111);
  await f.saveFacingTargetSettings(ac,{customReplyLength:555});
  await f.saveFacingTargetSettings(a,{customReplyLength:666,autoVisual:{interval:2}});
  assert.equal(effective(ab).customReplyLength,444);assert.equal(effective(ac).customReplyLength,555);assert.equal(effective(b).customReplyLength,222);
  assert.equal(f.facingEffectiveSettings('b',undefined,{characterId:'b',participantIds:['b','a']}).customReplyLength,444,'member order cannot create another settings scope');
  assert.equal(f.facingEffectiveSettings('b',undefined,ab).autoVisual.referenceMediaRef,'b-private');
  await f.saveFacingPreset('多人方案',ab);const preset=f.loadFacingSettings().presets[0];
  const beforeAB=structuredClone(effective(ab)),beforeA=structuredClone(effective(a));
  await f.applyFacingPreset(preset.id,ac);
  assert.equal(effective(ac).customReplyLength,444);assert.deepEqual(effective(ab),beforeAB);assert.deepEqual(effective(a),beforeA);
  assert.equal(f.loadFacingSettings().characters.b.autoVisual.referenceMediaRef,'b-private');
  assert.equal(JSON.parse(await kv.kvReadPersisted(f.FACING_SETTINGS_KEY)).common,undefined);
  await f.saveFacingParticipants(['a','b'],'old-ab');
  const host=document.getElementById('root'),App=load('components/facing/facing-app.tsx').FacingApp;
  const root=createRoot(host);await act(async()=>root.render(React.createElement(App,{onClose(){}})));
  async function click(label){const node=[...host.querySelectorAll('button')].find(node=>node.textContent.trim()===label||node.getAttribute('aria-label')===label);assert.ok(node,label);await act(async()=>{node.click();for(let i=0;i<3;i++)await tick();});}
  async function selectTarget(value){await act(async()=>{props(host.querySelector('[aria-label="当前设置对象"]')).onChange({target:{value}});await tick();});}
  await click('设置');assert.match(host.textContent,/这套参数只用于「旧多人组」这个多人组/);
  assert.equal(host.querySelector('[aria-label="预设名称"]').parentElement,host.querySelector('[aria-label="保存当前参数"]').parentElement);
  assert.equal(host.querySelector('[aria-label="选择参数预设"]').parentElement,host.querySelector('[aria-label="应用预设"]').parentElement);
  assert.equal(host.querySelector('[aria-label="保存当前参数"]').textContent,'保存');assert.equal(host.querySelector('[aria-label="应用预设"]').textContent,'应用');
  assert.equal(host.querySelector('[aria-label="自定义回复字数"]').value,'444');
  await click('成员素材与语音');assert.ok(host.querySelector('[aria-label="设置角色a的素材与语音"]'));await click('设置角色b的素材与语音');
  assert.ok(host.querySelector('[aria-label="角色b的素材与语音"]'));await click('返回成员列表');await click('本组参数');
  await selectTarget('character:a');assert.equal(host.querySelector('[role="tablist"]'),null,'single-character settings retain one original settings page');
  assert.ok(host.querySelector('[aria-label="角色a的素材与语音"]'));assert.equal(host.querySelector('[aria-label="自定义回复字数"]').value,'666');
  await act(async()=>{props(host.querySelector('[aria-label="自定义回复字数"]')).onBlur({target:{value:'777'}});await tick();});
  await selectTarget('group:'+f.facingGroupSettingsKey(['a','c']));assert.equal(host.querySelector('[aria-label="自定义回复字数"]').value,'444');
  await selectTarget('group:'+f.facingGroupSettingsKey(['a','b']));assert.equal(host.querySelector('[aria-label="自定义回复字数"]').value,'444');
  assert.deepEqual(f.loadFacingSettings().participantIds,['a','b'],'editing a different object does not switch the current meeting');
  assert.equal(effective(a).customReplyLength,777);assert.equal(effective(b).customReplyLength,222);
  await act(async()=>root.unmount());
  console.log('PASS independent facing scopes: legacy upgrade retains singles, group/roster isolation, per-role references, target-only presets, durable writes, member entry/back and original single settings UI.');
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.stack??error);process.exit(1);});
