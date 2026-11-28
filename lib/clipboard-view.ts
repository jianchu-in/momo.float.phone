/** Clipboard fallback must not steal a sheet's focus or scroll position. */
export async function copyTextPreservingView(text:string, scope?:HTMLElement|null) {
  try { await navigator.clipboard.writeText(text); return; } catch {}
  const active=document.activeElement as HTMLElement|null;
  const parents: Array<{node:HTMLElement;top:number;left:number}>=[];
  for(let node=scope??active;node;node=node.parentElement)parents.push({node,top:node.scrollTop,left:node.scrollLeft});
  const input=document.createElement("textarea");input.value=text;input.readOnly=true;input.setAttribute("aria-hidden","true");
  Object.assign(input.style,{position:"fixed",top:"0",left:"0",opacity:"0",width:"1px",height:"1px",pointerEvents:"none"});
  document.body.appendChild(input);
  try { input.focus?.({preventScroll:true});input.select();if(!document.execCommand("copy"))throw new Error("复制失败，请允许浏览器访问剪贴板后重试。"); }
  finally {input.remove();if(active?.isConnected)active.focus?.({preventScroll:true});for(const item of parents){item.node.scrollTop=item.top;item.node.scrollLeft=item.left;}}
}
