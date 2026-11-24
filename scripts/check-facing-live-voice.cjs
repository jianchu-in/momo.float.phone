const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require('fake-indexeddb/auto');
const { window } = require('linkedom').parseHTML('<html><body><div id="root"></div></body></html>');
Object.assign(global, { window, document: window.document, HTMLElement: window.HTMLElement, Node: window.Node, Event: window.Event, CustomEvent: window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
const values = new Map();
global.localStorage = window.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
const project = path.resolve(__dirname, '..'), originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request,parent,...rest) { return originalResolve.call(this, request.startsWith('@/') ? path.join(project,request.slice(2)) : request,parent,...rest); };
for (const ext of ['.ts','.tsx']) require.extensions[ext] = (module,filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,filename);
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client');
const load = name => require(path.join(project,name));
function mock(name,exports) { const id=path.join(project,name); require.cache[id]={id,filename:id,loaded:true,exports}; }
global.requestAnimationFrame=callback=>setTimeout(callback,0);
const delay = (ms=20) => new Promise(resolve => setTimeout(resolve,ms));
const deferred = () => { let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; };
const cloud = load('lib/stt-cloud.ts');
let transcripts=[], transcribePending;
mock('lib/stt-cloud.ts',{...cloud,resolveCloudSttConfig:()=>({baseUrl:'https://mock',apiKey:'mock',model:'mock'}),isCallRecordingSupported:()=>true,
 transcribeAudioBlob:async(blob,config,signal)=>{transcripts.push({blob,signal});return await transcribePending.promise;}});
mock('components/chat/voice-input-platform.ts',{isIOSDevice:()=>false});
let sessions=[];
function fakeSession(callbacks) { const s={callbacks,aborted:0,started:0,isSupported:true,start(){s.started++;},abort(){s.aborted++;},stop(){callbacks.onFinal('点击完成');}};sessions.push(s);return s; }

async function cloudInputChecks(){
 const {createFacingVoiceSession}=load('lib/facing-voice-input.ts');
 const intervals=new Map(),realInterval=global.setInterval,realClear=global.clearInterval,realNow=Date.now;
 let now=0,loud=false,streams=[],permission;
 global.setInterval=fn=>{const id=Symbol();intervals.set(id,fn);return id;};global.clearInterval=id=>intervals.delete(id);Date.now=()=>now;
 const pulse=(count,voice)=>{loud=voice;for(let i=0;i<count;i++){now+=80;for(const fn of [...intervals.values()])fn();}};
 const newStream=()=>{const track={stops:0,stop(){track.stops++;}};const stream={track,getTracks:()=>[track]};streams.push(stream);return stream;};
 Object.defineProperty(global,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:()=>permission ? permission.promise : Promise.resolve(newStream())}}});
 window.AudioContext=class {resume(){return Promise.resolve();}close(){return Promise.resolve();}createMediaStreamSource(){return {connect(){},disconnect(){}};}createAnalyser(){return {fftSize:1024,disconnect(){},getByteTimeDomainData(a){a.fill(loud?150:128);}};}};
 global.MediaRecorder=class {static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){if(this.state!=='recording')return;this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['speech'])});this.onstop?.();});}};
 let finals=[],empty=0,errors=[],transcribing=0;
 const cb={onInterim(){},onFinal:text=>finals.push(text),onError:e=>errors.push(e),onEnd(){},onNoSpeech:()=>empty++,onTranscribing:()=>transcribing++};
 try {
  transcribePending=deferred();const session=createFacingVoiceSession(cb,'a',false);session.start();await delay();pulse(4,true);pulse(18,false);await delay();
  assert.equal(transcribing,1);assert.equal(transcripts.length,1);assert.ok(streams[0].track.stops>0,'release mic before cloud request / character playback');
  transcribePending.resolve('第一句话');await delay();assert.deepEqual(finals,['第一句话']);
  const silence=createFacingVoiceSession(cb,'a',false);silence.start();await delay();pulse(190,false);await delay();assert.equal(empty,1);assert.equal(transcripts.length,1,'silence does not spend an STT or reply request');
  permission=deferred();const late=createFacingVoiceSession(cb,'a',false);late.start();await delay();late.abort();const lateStream=newStream();permission.resolve(lateStream);await delay();assert.ok(lateStream.track.stops>0,'late mic grant after stop releases tracks');permission=undefined;
  transcribePending=deferred();const cancel=createFacingVoiceSession(cb,'a',false);cancel.start();await delay();pulse(4,true);pulse(18,false);await delay();cancel.abort();assert.equal(transcripts[1].signal.aborted,true);transcribePending.resolve('停止后的内容');await delay();assert.deepEqual(finals,['第一句话']);assert.deepEqual(errors,[]);
 } finally {global.setInterval=realInterval;global.clearInterval=realClear;Date.now=realNow;}
 // Browser speech recognition still owns sentence endpoint detection on supported devices.
 let recognition;
 window.SpeechRecognition=class {constructor(){recognition=this;}start(){}abort(){this.aborted=true;}stop(){this.onend();}};
 const browserSession=createFacingVoiceSession(cb,'a',true);browserSession.start();
 recognition.onresult({results:[{0:{transcript:'浏览器识别'},isFinal:true}]});recognition.onend();
 assert.equal(finals.at(-1),'浏览器识别');browserSession.abort();assert.equal(recognition.aborted,true);delete window.SpeechRecognition;
 // Actual shared transcription transport also accepts cancellation; no real network request.
 const realFetch=global.fetch;let fetchSignal;global.fetch=(_url,options)=>{fetchSignal=options.signal;return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError'))));};
 try{const abort=new AbortController();const result=cloud.transcribeAudioBlob(new Blob(['audio']),{baseUrl:'https://mock',apiKey:'mock',model:'mock'},abort.signal).catch(e=>e);abort.abort();await result;assert.equal(fetchSignal.aborted,true);}finally{global.fetch=realFetch;}
 console.log('PASS automatic recording: speech/silence endpoint, empty audio suppression, mic release, late permission and cancelled cloud transcription.');
}

async function hookChecks(){
 const hook=load('components/facing/use-facing-live-voice.ts').useFacingLiveVoice;
 let handle,requests=[],reply=deferred(),errors=[];
 function Harness(){handle=hook({createSession:fakeSession,onTranscript:async text=>{requests.push(text);return await reply.promise;},onError:e=>errors.push(e)});return React.createElement('output',null,handle.phase);}
 const host=document.getElementById('root');let root=createRoot(host);
 await act(async()=>{root.render(React.createElement(Harness));await delay();});
 await act(async()=>{handle.start();await delay();});
 const first=sessions.at(-1);await act(async()=>{first.callbacks.onInterim('第一句话');await delay();});assert.equal(requests.length,0);
 await act(async()=>{first.callbacks.onFinal('第一句话');first.callbacks.onFinal('重复');first.callbacks.onEnd();await delay();});assert.deepEqual(requests,['第一句话']);assert.equal(handle.phase,'replying');assert.ok(first.aborted);
 const before=sessions.length;await act(async()=>{await delay(600);});assert.equal(sessions.length,before,'do not open mic while reply / playback is pending');
 await act(async()=>{reply.resolve(true);await delay(620);});assert.equal(handle.phase,'listening');assert.equal(sessions.length,before+1);
 const second=sessions.at(-1);await act(async()=>{handle.pause();second.callbacks.onFinal('晚到的结果');await delay();});assert.equal(handle.phase,'paused');assert.equal(requests.length,1);
 await act(async()=>{handle.start();await delay();sessions.at(-1).callbacks.onError('权限被拒绝');await delay(650);});assert.equal(handle.phase,'paused');assert.equal(errors.at(-1),'权限被拒绝');
 await act(async()=>{handle.start();await delay();window.dispatchEvent(new window.Event('pagehide'));await delay();});assert.equal(handle.phase,'paused','leaving page pauses mic');
 await act(async()=>{handle.start();await delay();handle.finish();await delay();});assert.equal(requests.at(-1),'点击完成');
 await act(async()=>{root.unmount();await delay(650);});assert.ok(sessions.at(-1).aborted);
 // Three empty recognition sessions pause rather than restarting endlessly.
 sessions=[];root=createRoot(host);await act(async()=>{root.render(React.createElement(Harness));await delay();});
 await act(async()=>{handle.start();await delay();});
 const realNow=Date.now;let clock=realNow();Date.now=()=>clock;
 try{for(let i=0;i<4;i++)await act(async()=>{clock+=16_000;sessions.at(-1).callbacks.onNoSpeech();await delay(1050);});assert.equal(handle.phase,'listening','ordinary silence keeps the live call listening');}finally{Date.now=realNow;}
 sessions=[];await act(async()=>{handle.stop();handle.start();await delay();});
 for(let i=0;i<3;i++)await act(async()=>{sessions.at(-1).callbacks.onNoSpeech();await delay(i<2?1050:20);});assert.equal(handle.phase,'paused');assert.equal(sessions.length,3);
 await act(async()=>root.unmount());
 console.log('PASS live cycle: final-only submission, deduplication, playback barrier, pause/end/late callbacks, visibility cleanup, bounded empty retries.');
}

async function roomChecks(){
 sessions=[];
 mock('lib/facing-voice-input.ts',{createFacingVoiceSession:fakeSession});
 mock('components/facing/facing-stage.tsx',{FacingStage:()=>null});
 mock('components/facing/use-facing-speaker.ts',{useFacingSpeaker:()=>({})});
 mock('components/facing/use-facing-viewport-inset.ts',{useFacingViewportInset:()=>0});
 let plays=[],playback,requests=[],failReply=false,failVoice=false,storyAttempts=0;
 const play=()=>{playback=deferred();const result={promise:playback.promise,abort:()=>playback.resolve()};plays.push(result);return result;};
 mock('lib/tts-service.ts',{unlockAudioPlayback(){},resolveVoiceConfig:()=>({}),synthesizeSpeech:async()=>{if(failVoice)throw new Error('模拟语音失败');return new Blob(['voice'],{type:'audio/mpeg'});},playAudioBlob:play,playAudioBlobViaMediaElement:play});
 mock('lib/facing-engine.ts',{generateFacingReply:async options=>{requests.push(options);if(failReply)throw new Error('模拟回复失败');return {replies:[{speakerId:'a',speakerName:'角色a',dialogue:'我听到了',action:''}]};}});
 await load('lib/kv-db.ts').hydrateKvDb();await load('lib/settings-db.ts').hydrateSettingsDb();await load('lib/chat-storage.ts').hydrateChatStorage();
 const chars=['a','b'].map(id=>({id,name:'角色'+id,avatar:'',persona:'',createdAt:'',updatedAt:''}));load('lib/character-storage.ts').saveCharacters(chars);
 const storage=load('lib/facing-storage.ts');let original=await storage.saveFacingMeetingStart(storage.createFacingMeeting('a','user','main'),{sceneName:'很长的公寓名称·开放式餐厨岛台'});
 const Room=load('components/facing/facing-room.tsx').FacingRoom;
 let current;
 function Harness({multi=false}){const [meeting,setMeeting]=React.useState(original);const [music,setMusic]=React.useState(false);current=meeting;return React.createElement('div',{className:'facing-app'},React.createElement(Room,{character:chars[0],meeting:multi?{...meeting,participantIds:['a','b']}:meeting,settings:{voice:false},ambience:{playing:music,ready:true,configured:true,location:'游乐园',error:'',toggle:()=>setMusic(value=>!value)},position:meeting.scene,scenes:[],initialDraft:'保留草稿',onMeeting:setMeeting,onCompleted(){},onSettings(){},onMap(){},onEnd(){},onVoice(){},onSpeechInput(){},onScene:async()=>{},onEditPortrait(){},onPortraitLayout:async()=>{},onStory:async()=>{storyAttempts++;throw new Error('模拟跳转失败');}}));}
 const host=document.getElementById('root');let root=createRoot(host);
 const click=async label=>{if(["开启实时对话","结束实时对话"].includes(label)&&!host.querySelector(`button[aria-label="${label}"]`)){await act(async()=>{host.querySelector('[aria-label="展开对话功能"]').dispatchEvent(new window.Event("click",{bubbles:true}));await delay();});}return act(async()=>{const b=host.querySelector(`button[aria-label="${label}"]`)??[...host.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(b,label);assert.equal(b.disabled,false,label);b.dispatchEvent(new window.Event('click',{bubbles:true}));await delay(50);});};
 await act(async()=>{root.render(React.createElement(Harness));await delay();});
 await click('展开对话功能');await click('播放氛围音 · 游乐园');assert.ok([...host.querySelectorAll('button')].some(button=>button.textContent==='暂停氛围音 · 游乐园'));await click('暂停氛围音 · 游乐园');assert.equal(requests.length,0,'music controls never generate replies');
 assert.equal(host.querySelector('[aria-label="关闭角色语音"]'),null);await click('开启实时对话');assert.ok(host.querySelector('.facing-live-speak'));assert.equal(host.querySelector('[aria-label="对话内容"]').value,'保留草稿');
 const first=sessions.at(-1);await act(async()=>{first.callbacks.onFinal('你好');first.callbacks.onEnd();await delay(200);});
 assert.ok(host.querySelectorAll('time').length>=2,'facing user and role replies show timestamps');assert.equal(requests.length,1);assert.equal(plays.length,1,'live mode speaks even when saved voice toggle was off');assert.equal(current.turns.filter(t=>t.role==='user').length,1);assert.ok(current.turns.find(t=>t.role==='assistant').audioRef,'real audio ref saved');
 await act(async()=>{await delay(650);});assert.equal(sessions.length,1,'no mic while actual FacingSpeech playback is unresolved');
 await act(async()=>{playback.resolve();await delay(650);});assert.equal(sessions.length,2);
 failReply=true;await act(async()=>{sessions.at(-1).callbacks.onFinal('第二句');await delay(150);});assert.equal(requests.length,2);assert.equal(requests[1].meeting.turns.length,3,'second turn reads the updated saved conversation');assert.match(host.textContent,/模拟回复失败/);assert.ok(host.querySelector('[aria-label="继续实时收音"]'));assert.equal(current.turns.filter(t=>t.role==='user').length,2);
 await click('结束实时对话');assert.equal(host.querySelector('.facing-live-speak'),null);assert.equal(host.querySelector('[aria-label="对话内容"]').value,'保留草稿');
 failReply=false;failVoice=true;await click('开启实时对话');await act(async()=>{sessions.at(-1).callbacks.onFinal('第三句');await delay(250);});assert.equal(requests.length,3);assert.match(host.textContent,/模拟语音失败/);assert.ok(host.querySelector('[aria-label="继续实时收音"]'));const afterVoiceFailure=sessions.length;await act(async()=>{await delay(650);});assert.equal(sessions.length,afterVoiceFailure,'TTS failure pauses instead of listening over an unheard reply');await click('结束实时对话');
 await click('进入剧情');const dialog=host.querySelector('[role="dialog"]');assert.equal(dialog.getAttribute('aria-modal'),'true');assert.ok(dialog.closest('.facing-overlay-center'));assert.ok(dialog.querySelector('.facing-primary'));await click('前往剧情');assert.equal(storyAttempts,1);assert.match(dialog.textContent,/模拟跳转失败/);await click('留在这里');assert.equal(host.querySelector('[role="dialog"]'),null);
 failVoice=false;await click('开启实时对话');await act(async()=>{sessions.at(-1).callbacks.onFinal('中断这轮');await delay(250);});assert.equal(requests.length,4);const interrupted=sessions.at(-1);await click('结束实时对话');await act(async()=>{interrupted.callbacks.onFinal('停止之后');await delay(650);});assert.equal(requests.length,4);assert.equal(current.turns.filter(t=>t.role==='user').length,4,'ending during playback retains completed messages');
 await act(async()=>root.unmount());root=createRoot(host);await act(async()=>{root.render(React.createElement(Harness,{multi:true}));await delay();});assert.equal(host.querySelector('[aria-label="进入剧情"]'),null,'multi facing must not open story');
 await click('开启实时对话');const late=sessions.at(-1);await act(async()=>root.unmount());assert.ok(late.aborted);await act(async()=>{late.callbacks.onFinal('离开之后');await delay();});assert.equal(requests.length,4);
 console.log('PASS FacingRoom: saved real voice turns, one request per turn, saved audio/playback ordering, updated history, error pause, draft preservation, centered dialog failure/cancel, multi-story exclusion, unmount.');
}

async function main(){await cloudInputChecks();await hookChecks();await roomChecks();}
main().then(()=>process.exit(0)).catch(e=>{console.error(e.stack??e);process.exit(1);});
