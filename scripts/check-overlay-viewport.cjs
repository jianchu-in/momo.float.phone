const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const project=path.resolve(__dirname,'..');
function load(file,deps={},globals={},suffix=''){
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(project,file),'utf8')+suffix,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,
  {module,exports:module.exports,require:name=>deps[name]??{},console,setTimeout,clearTimeout,...globals});return module.exports;
}
const geometry=load('lib/overlay-viewport.ts'),phone=load('lib/floating-phone-geometry.ts');
function pureChecks(){
 const local=geometry.overlayViewportRect({left:20,top:40,right:371,bottom:799.6},{width:390,height:844},{left:0,top:120,right:390,bottom:520},[{left:10,top:60,right:361,bottom:780}]);
 assert.ok(Math.abs(local.top-80/.9)<.001);assert.ok(Math.abs(local.height-400/.9)<.001);assert.ok(Math.abs(local.width-341/.9)<.001);
 for(const height of [260,430,700,844])for(const width of [280,320,390]){
  const bounds=geometry.overlayViewportRect({left:0,top:0,right:390,bottom:900},{width:390,height:900},{left:0,top:0,right:width,bottom:height});
  const frame=phone.floatingPhoneGeometry(bounds,.8,false,{x:1000,y:1000});assert.ok(frame.x+frame.width<=width);assert.ok(frame.y+frame.height<=height);
 }
 assert.equal(geometry.overlayViewportRect({left:0,top:-900,right:390,bottom:-56},{width:390,height:844},{left:0,top:0,right:390,bottom:844}).height,0);
}
async function componentChecks(){
 const {window}=require('linkedom').parseHTML('<html><body><div id="root"></div></body></html>');
 Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,Node:window.Node,Event:window.Event,IS_REACT_ACT_ENVIRONMENT:true});
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
 const tick=()=>new Promise(resolve=>setTimeout(resolve,15));
 const observations=[];
 global.ResizeObserver=class{constructor(callback){this.callback=callback;observations.push(this);}observe(){}disconnect(){this.disconnected=true;}};
 window.requestAnimationFrame=callback=>setTimeout(callback,0);window.cancelAnimationFrame=clearTimeout;
 Object.assign(window,{innerWidth:390,innerHeight:844,scrollX:0,scrollY:0});
 for(const [name,value]of Object.entries({clientWidth:390,clientHeight:844,offsetWidth:390,offsetHeight:844,clientLeft:0,clientTop:0}))Object.defineProperty(window.HTMLElement.prototype,name,{configurable:true,get:()=>value});
 for(const name of ['scrollLeft','scrollTop'])Object.defineProperty(window.HTMLElement.prototype,name,{configurable:true,value:0,writable:true});
 window.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,right:390,bottom:844,width:390,height:844});
 const viewport=new window.EventTarget();Object.assign(viewport,{offsetLeft:0,offsetTop:0,width:390,height:844});window.visualViewport=viewport;
 const getComputedStyle=element=>({overflow:element.style.overflow||'visible',overflowX:'',overflowY:''});
 const globals={window,document,HTMLElement,ResizeObserver,getComputedStyle};
 const geom=load('lib/overlay-viewport.ts',{},globals);
 const {useOverlayViewport}=load('components/use-overlay-viewport.ts',{react:React,'@/lib/overlay-viewport':geom},globals);
 const host=document.getElementById('root');let root=createRoot(host);
 function Harness({enabled=true}){const ref=React.useRef(null),style=useOverlayViewport(ref,enabled);return React.createElement('div',{ref},React.createElement('section',{id:'overlay',style}));}
 await act(async()=>{root.render(React.createElement(Harness));await tick();});
 assert.equal(host.querySelector('#overlay').style.height,'844px');
 await act(async()=>{Object.assign(viewport,{height:430,offsetTop:95,width:320,offsetLeft:20});viewport.dispatchEvent(new window.Event('resize'));await tick();});
 assert.equal(host.querySelector('#overlay').style.height,'430px');assert.equal(host.querySelector('#overlay').style.top,'95px');assert.equal(host.querySelector('#overlay').style.left,'20px');assert.equal(host.querySelector('#overlay').style.width,'320px');
 await act(async()=>{Object.assign(viewport,{height:844,offsetTop:0,width:390,offsetLeft:0});viewport.dispatchEvent(new window.Event('scroll'));await tick();});assert.equal(host.querySelector('#overlay').style.height,'844px');
 await act(async()=>root.render(React.createElement(Harness,{enabled:false})));assert.equal(host.querySelector('#overlay').style.height,'');await act(async()=>root.unmount());assert.ok(observations.every(o=>o.disconnected));
 // Run the real discussion dialog. Simulate a WebKit focus that scrolls even when asked not to.
 const focusCalls=[];
 window.HTMLElement.prototype.focus=function(options){focusCalls.push(options);for(let p=this.parentElement;p;p=p.parentElement){p.scrollLeft=32;p.scrollTop=48;}};
 const focus=load('lib/focus-without-scroll.ts',{},globals);
 const conversation={id:'saved',updatedAt:Date.now(),context:{label:'当前剧情'},messages:[]};
 const dialog=load('components/roleplay-discussion-dialog.tsx',{
  react:React,'react/jsx-runtime':require('react/jsx-runtime'),'lucide-react':require('lucide-react'),
  '@/components/use-overlay-viewport':{useOverlayViewport},'@/lib/focus-without-scroll':focus,
  '@/lib/character-storage':{loadCharacters:()=>[]},'@/lib/roleplay-discussion':{getDiscussionCharacterIds:()=>[]},
  '@/lib/roleplay-discussion-history':{loadDiscussionConversations:()=>[conversation],DISCUSSION_HISTORY_UPDATED:'discussion-test'},
 },globals).RoleplayDiscussionDialog;
 root=createRoot(host);await act(async()=>{root.render(React.createElement(dialog,{context:{label:'当前剧情'},onClose(){}}));await tick();});assert.equal(focusCalls.at(-1).preventScroll,true);
 assert.equal(host.scrollLeft,0);assert.equal(host.scrollTop,0);assert.equal(document.body.scrollLeft,0);assert.equal(document.body.scrollTop,0);await act(async()=>root.unmount());
 const {useBallDrag}=load('components/floating-tools.tsx',{react:React,'react/jsx-runtime':require('react/jsx-runtime'),'lucide-react':require('lucide-react'),'@/lib/kv-db':{kvGet:()=>null}},globals,'\nexport { useBallDrag };');
 let activations=0,prevented=0;root=createRoot(host);
 function Ball(){const {handlers}=useBallDrag('test',()=>activations++);return React.createElement('div',null,React.createElement('button',handlers,'破壁聊天'));}
 await act(async()=>root.render(React.createElement(Ball)));const button=host.querySelector('button');Object.defineProperty(button.parentElement,'offsetParent',{value:host});button.setPointerCapture=()=>{};
 const props=button[Object.keys(button).find(key=>key.startsWith('__reactProps$'))],event={currentTarget:button,isPrimary:true,button:0,pointerType:'touch',pointerId:1,clientX:370,clientY:500,stopPropagation(){},preventDefault(){prevented++;}};
 await act(async()=>{props.onPointerDown(event);props.onPointerUp({...event,type:'pointerup'});props.onClick({...event,detail:1});});assert.equal(prevented,1,'touch prevents native offscreen focus');assert.equal(activations,1,'touch activates exactly once even with a compatibility click');
 await act(async()=>props.onClick({...event,detail:0}));assert.equal(activations,2,'keyboard activation is preserved');await act(async()=>root.unmount());
 console.log('PASS viewport/focus components: scaled clipping, keyboard + pan + restore, resize subscriptions/cleanup, actual discussion focus without parent/page scrolling.');
}
async function browserChecks(){
 const {chromium}=require('playwright');const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();await page.route('**/*',route=>route.abort());
  const styles=['base','components','chat','story'].map(name=>fs.readFileSync(path.join(project,'styles',name+'.css'),'utf8')).join('\n');
  const ios=require('postcss').parse(styles);let iosRules='';ios.walkAtRules('supports',rule=>{if(/-webkit-touch-callout/.test(rule.params))iosRules+=rule.nodes.map(node=>node.toString()).join('\n');});
  const fixture=`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}\n${iosRules}
   html,body{margin:0;overflow:hidden}.phone-fixture{position:relative;overflow:hidden;width:100%;height:844px}.chat-app{position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden}.chat-room-layer{position:absolute;inset:0}.page-header{height:54px}.chat-input-bar{display:flex;flex-direction:column}.chat-input-textarea{height:42px}.chat-input-actions>button{border:0;background:#ddd;display:grid;place-items:center}.chat-input-actions svg{display:block}.page-body p{margin:20px}
   </style><main class="phone-fixture"><section class="story-app-shell"><div class="story-shell-inner"><div class="story-mini-phone-overlay"><div class="story-phone-window-space"><section class="story-phone-window-frame"><div class="story-phone-window-toolbar">小手机</div><div class="story-phone-window-content"><section class="story-floating-chat-app"><div class="chat-app"><div class="chat-room-layer"><section class="chat-room-wrapper page-shell"><header class="page-header">聊天</header><div class="page-body">${'<p>聊天记录</p>'.repeat(20)}</div><div class="chat-input-bar"><textarea class="chat-input-textarea">保留输入内容</textarea><div class="chat-input-actions">${Array.from({length:7},(_,i)=>'<button aria-label="功能'+i+'"><svg width="24" height="24"></svg></button>').join('')}</div><div class="chat-plus-menu">${'<button class="chat-plus-menu-item"><span class="chat-plus-icon-box">功能</span></button>'.repeat(16)}</div></div></section></div></div></section></div></section></div></div></div></section></main>`;
  await page.setContent(fixture);
  for(const [file,name]of [['lib/overlay-viewport.ts','geometry'],['lib/floating-phone-geometry.ts','phone'],['lib/focus-without-scroll.ts','focusTools']]){
   const code=ts.transpileModule(fs.readFileSync(path.join(project,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
   await page.addScriptTag({content:`{const module={exports:{}};const exports=module.exports;${code}\nwindow.${name}=module.exports;}`});
  }
  for(const width of [280,320,390])for(const height of [300,430,844]){
   await page.setViewportSize({width,height});
   const result=await page.evaluate(()=>{
    const shell=document.querySelector('.story-shell-inner'),overlay=document.querySelector('.story-mini-phone-overlay'),host=document.querySelector('.story-phone-window-space'),frame=document.querySelector('.story-phone-window-frame');
    const bounds=window.geometry.measureOverlayViewport(shell);Object.assign(overlay.style,{left:bounds.left+'px',top:bounds.top+'px',width:bounds.width+'px',height:bounds.height+'px',bottom:'auto',right:'auto'});
    const geom=window.phone.floatingPhoneGeometry({width:host.clientWidth,height:host.clientHeight},.8);Object.assign(frame.style,{left:geom.x+'px',top:geom.y+'px',width:geom.width+'px',height:geom.height+'px'});
    const rect=element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
    const input=document.querySelector('textarea'),buttons=[...document.querySelectorAll('.chat-input-actions button')];
    return {frame:rect(frame),input:rect(input),font:getComputedStyle(input).fontSize,buttons:buttons.map(b=>({...rect(b),reachable:document.elementFromPoint(b.getBoundingClientRect().left+b.clientWidth/2,b.getBoundingClientRect().top+b.clientHeight/2)?.closest('button')===b})),overflow:document.documentElement.scrollWidth>innerWidth};
   });
   assert.equal(result.font,'16px');assert.ok(!result.overflow,`document horizontal overflow ${width}x${height}`);assert.ok(result.input.top>=result.frame.top&&result.input.bottom<=result.frame.bottom,`input visible ${width}x${height}`);
   for(const button of result.buttons){assert.ok(button.left>=result.frame.left-.5&&button.right<=result.frame.right+.5&&button.bottom<=result.frame.bottom+.5,`function inside phone ${width}x${height}`);assert.ok(button.reachable,`button clickable ${width}x${height}`);}
  }
  await context.close();console.log('PASS Chromium layout fixtures with production CSS: 280/320/390px, keyboard-height resize, actual input/button bounds and click targets, iOS 16px rules, no horizontal page overflow.');
 }finally{await browser.close();}
}
async function main(){pureChecks();await componentChecks();if(process.argv.includes('--browser'))await browserChecks();else console.log('Browser layout fixture available with --browser; native iOS still requires device validation.');}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.stack??error);process.exit(1);});
