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
  calls.push({ kind, data });
  const result = await responder(kind, data, args[5].signal, args[6]);
  return { content: typeof result === 'string' ? result : JSON.stringify(result) };
} });
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client');
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const vm=require('node:vm');
async function main(){
 window.requestAnimationFrame=global.requestAnimationFrame;window.cancelAnimationFrame=global.cancelAnimationFrame;
 Object.assign(window,{innerWidth:390,innerHeight:844});
 let scale=1,top=0;const viewport=new window.EventTarget();Object.assign(viewport,{offsetLeft:0,offsetTop:0,width:390,height:844});window.visualViewport=viewport;
 global.getComputedStyle=el=>({overflow:el.style.overflow||'visible',overflowX:'',overflowY:''});
 const observers=[];global.ResizeObserver=class{constructor(cb){this.cb=cb;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
 for(const [name,value]of Object.entries({clientWidth:390,clientHeight:844,offsetWidth:390,offsetHeight:844,clientTop:0,clientLeft:0}))Object.defineProperty(window.HTMLElement.prototype,name,{configurable:true,get:()=>value});
 window.HTMLElement.prototype.getBoundingClientRect=function(){const header=this.matches('.page-header');const height=header?100:844;return{left:0,right:390*scale,top,bottom:top+height*scale,width:390*scale,height:height*scale};};
 const {useChatComposerViewport}=load('components/chat/use-chat-composer-viewport.ts');
 const runtime=load('lib/chat-plugin-runtime.ts').getChatPluginRuntime();let pluginClicks=0,disposals=0;
 runtime.slots.set('chat.inputToolbar',[{pluginId:'fixture',mount(el){const button=document.createElement('button');button.textContent='插件快捷功能';button.onclick=()=>pluginClicks++;el.append(button);return()=>disposals++;}}]);
 const roomSource=fs.readFileSync(path.join(project,'components/chat/chat-room.tsx'),'utf8');
 const composerSource=roomSource.slice(roomSource.indexOf('const ChatTextInputBar ='),roomSource.indexOf('const OfflineTextInputBar ='));
 const module={exports:{}};
 const sandbox={module,exports:module.exports,require,console,setTimeout,clearTimeout,window,document,requestAnimationFrame,ResizeObserver,...React,...require('lucide-react'),useChatComposerViewport,ChatPluginSlot:load('components/chat/chat-plugin-slot.tsx').ChatPluginSlot,
 shouldSendChatInputOnEnter:load('lib/chat-input-keyboard.ts').shouldSendChatInputOnEnter,
 getCustomChatPlusPresentation:action=>action.presentation||'panel',StickerSearchSuggest:()=>null,EmojiPanel:()=>React.createElement('div',{'data-fixture':'emoji'}),StickerPanel:()=>React.createElement('div',{'data-fixture':'sticker'})};
 vm.runInNewContext(ts.transpileModule(composerSource+'\nexports.Composer=ChatTextInputBar;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,sandbox);
 const Composer=module.exports.Composer,host=document.getElementById('root');const root=createRoot(host),events=[];
 const callbacks=Object.fromEntries(['onClearQuote','onToggleOfflineMode','onClosePanels','onToggleEmojiPanel','onToggleStickerPanel','onTogglePlusMenu','onToggleTheaterMode','onCloseTheaterMode','onOpenRichModal','onOpenCustomPlusAction','onStartVideoCall','onStartVoiceCall','onReversePhone','onStopGeneration','onTriggerAIResponse','onSendSticker'].map(name=>[name,(value)=>events.push([name,value])]));
 let props={...callbacks,characterName:'测试角色',characterId:'c',isGroup:false,isSpectator:false,muteUntilMs:0,isGenerating:false,theaterMode:false,enterToSendEnabled:true,storyEntryEnabled:true,quotingMessage:null,showEmojiPanel:false,showStickerPanel:false,showPlusMenu:true,customPlusActions:[{id:'web',label:'网页',presentation:'panel'}],onSendText:(text)=>{events.push(['send',text]);return true;},isIMessage:true};
 const render=async patch=>{props={...props,...patch};await act(async()=>{root.render(React.createElement('section',{className:'chat-room-wrapper','data-imessage-private':props.isIMessage?'':undefined},React.createElement('header',{className:'page-header'}),React.createElement(Composer,props)));await tick();});};
 await render({});const composer=()=>host.querySelector('.chat-input-bar');
 assert.equal(composer().style.getPropertyValue('--chat-composer-limit'),'422px');assert.equal(composer().style.getPropertyValue('--chat-composer-bottom'),'0px');
 assert.ok(composer().querySelector('.chat-composer-panels .chat-plugin-input-toolbar [data-chat-plugin="fixture"]'));
 assert.equal(composer().querySelector('textarea').parentElement.className,'chat-composer-entry');
 assert.ok(composer().querySelector('[aria-label="一起听"]'));assert.ok(composer().querySelector('[aria-label="网页"]'));assert.equal(composer().querySelector('.imessage-composer-subject'),null);
 await act(async()=>composer().querySelector('[data-chat-plugin="fixture"] button').click());assert.equal(pluginClicks,1);
 for(const [label,event]of [['网页','onOpenCustomPlusAction'],['他来查岗','onReversePhone'],['剧情入口','onToggleOfflineMode'],['语音通话','onStartVoiceCall']]){
  await act(async()=>composer().querySelector('.chat-plus-menu [aria-label="'+label+'"]').click());assert.equal(events.at(-1)[0],event);
 }
 const input=composer().querySelector('textarea'),inputProps=input[Object.keys(input).find(k=>k.startsWith('__reactProps$'))];
 await act(async()=>inputProps.onChange({target:{value:'正常发送测试',style:{},scrollHeight:22}}));
 assert.equal(composer().querySelector('[aria-label="发送"]').disabled,false,'typing must enable send');
 await act(async()=>composer().querySelector('[aria-label="发送"]').click());assert.ok(events.some(e=>e[0]==='send'&&e[1]==='正常发送测试'));
 await act(async()=>{Object.assign(viewport,{height:400,offsetTop:100});viewport.dispatchEvent(new window.Event('resize'));await tick();});
 assert.equal(composer().style.getPropertyValue('--chat-composer-limit'),'200px');assert.equal(composer().style.getPropertyValue('--chat-composer-bottom'),'344px');
 scale=.8;top=20;await act(async()=>{viewport.offsetTop=20;viewport.height=300;viewport.dispatchEvent(new window.Event('scroll'));await tick();});assert.equal(composer().style.getPropertyValue('--chat-composer-limit'),'188px','scaled CSS pixels');
 await render({showPlusMenu:false,showEmojiPanel:true});assert.ok(composer().querySelector('[data-fixture="emoji"]'));assert.equal(composer().querySelector('.chat-plus-menu'),null);assert.ok(disposals>0);
 await render({isIMessage:false,showPlusMenu:true,showEmojiPanel:false});assert.equal(composer().querySelector('textarea').parentElement,composer(),'classic direct-child custom CSS still works');assert.equal(composer().style.getPropertyValue('--chat-composer-limit'),'');
 await act(async()=>root.unmount());assert.ok(observers.every(o=>o.disconnected));
 // Actual PWA marker lifecycle, including the existing explicit display-mode preference.
 let standalone=true;Object.defineProperty(global,'navigator',{configurable:true,value:{userAgent:'iPhone',platform:'iPhone',maxTouchPoints:5,get standalone(){return standalone;}}});
 window.matchMedia=q=>{const target=new window.EventTarget();target.matches=q.includes('standalone')&&standalone;return target;};document.cookie='';
 const {PWAManifestInjector}=load('components/pwa-manifest-injector.tsx');const pwaRoot=createRoot(host);
 await act(async()=>pwaRoot.render(React.createElement(PWAManifestInjector)));assert.equal(document.documentElement.dataset.iosPwa,'true');assert.equal(document.documentElement.dataset.pwaDisplayMode,undefined);
 document.cookie='pwa_display_mode=standalone';await act(async()=>window.dispatchEvent(new window.Event('pwa-display-mode-changed')));assert.equal(document.documentElement.dataset.pwaDisplayMode,'standalone');
 standalone=false;await act(async()=>window.dispatchEvent(new window.Event('pageshow')));assert.equal(document.documentElement.dataset.iosPwa,undefined);
 navigator.userAgent='Android';standalone=true;await act(async()=>window.dispatchEvent(new window.Event('pageshow')));assert.equal(document.documentElement.dataset.iosPwa,undefined);
 await act(async()=>pwaRoot.unmount());assert.equal(document.documentElement.dataset.pwaDisplayMode,undefined);
 require('postcss').parse(fs.readFileSync(path.join(project,'styles/chat-composer.css'),'utf8'));
 console.log('PASS real composer/plugin components: send + menu actions, classic DOM, exclusive panels, viewport/keyboard/scaling budgets, observer cleanup, iOS PWA marker and preference lifecycle. No native iOS visual validation.');
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.stack??error);process.exit(1);});
