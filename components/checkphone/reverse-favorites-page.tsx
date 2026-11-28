"use client";
import { useEffect, useState } from "react";
import { FAVORITES_UPDATED_EVENT, FAVORITE_CATEGORY_LABELS, type FavoriteItem } from "@/lib/favorites-storage";
import { favoriteImageDataUrl, reverseAllowedFavorites } from "@/lib/reverse-favorites";
import type { ReverseScope } from "@/lib/reverse-phone-types";
import type { ReverseScreen } from "./use-reverse-phone";

function Image({ mediaRef, name }: { mediaRef: string; name: string }) {
  const [full,setFull]=useState(false);
  const [image,setImage]=useState<{ref:string;url?:string}>();
  useEffect(()=>{let active=true;void favoriteImageDataUrl(mediaRef).then(url=>{if(active)setImage({ref:mediaRef,url});}).catch(()=>{if(active)setImage({ref:mediaRef});});return()=>{active=false;};},[mediaRef]);
  return image?.ref===mediaRef&&image.url ? <span data-rp-image-state="ready"><img src={image.url} alt={name} role={name==="收藏原图"?"button":undefined} tabIndex={name==="收藏原图"?0:undefined} onKeyDown={event=>{if(name==="收藏原图"&&(event.key==="Enter"||event.key===" ")){event.preventDefault();setFull(true);}}} onClick={event=>{if(name==="收藏原图"){event.stopPropagation();setFull(true);}}}/>{full&&<span className="rp-favorite-full" role="dialog" aria-label="收藏原图" onClick={event=>{event.stopPropagation();setFull(false);}}><button type="button">关闭原图</button><img src={image.url} alt="收藏原图放大"/></span>}</span> : <span data-rp-image-state={image?.ref===mediaRef?"missing":"loading"}>图片暂未载入</span>;
}
export function ReverseFavoritesPage({ scope, characterId, screen, onScreen, onBack }: {
  scope:ReverseScope;characterId:string;screen:ReverseScreen;onScreen:(value:ReverseScreen)=>void;onBack:()=>void;
}) {
  const [items,setItems]=useState<FavoriteItem[]>([]),[loaded,setLoaded]=useState(false),[filter,setFilter]=useState("");
  const [showFilter,setShowFilter]=useState(false),[page,setPage]=useState(0),[expanded,setExpanded]=useState(false),[entryIndex,setEntryIndex]=useState(0);
  useEffect(()=>{let active=true;const load=()=>void reverseAllowedFavorites(characterId,scope).then(value=>{if(active){setItems(value);setLoaded(true);}});load();window.addEventListener(FAVORITES_UPDATED_EVENT,load);window.addEventListener("reverse-phone-settings-updated",load);return()=>{active=false;window.removeEventListener(FAVORITES_UPDATED_EVENT,load);window.removeEventListener("reverse-phone-settings-updated",load);};},[scope.key,characterId]);
  useEffect(()=>{setExpanded(false);const item=items.find(item=>item.id===screen.itemId);setEntryIndex(screen.section==="images"?Math.max(0,item?.entries.findIndex(entry=>entry.mediaType==="image")??0):0);},[screen.itemId]);
  const tab=screen.section??"all";
  const selected=items.find(item=>item.id===screen.itemId);
  const filtered=items.filter(item=>(tab!=="images"||item.entries.some(entry=>entry.mediaType==="image"))&&(tab!=="text"||item.entries.some(entry=>entry.mediaType!=="image"))&&(!filter||[item.entityName,FAVORITE_CATEGORY_LABELS[item.category],...item.tags].join(" ").includes(filter)));
  const rows=filtered.slice(page*9,page*9+9);
  const entry=selected?.entries[entryIndex];
  return <section className="rp-panel rp-favorites" data-reverse-favorites data-rp-favorites-ready={loaded?"true":"false"}>
    <header className="rp-header"><button data-rp-target="favorites:back" onClick={()=>selected?onScreen({...screen,itemId:undefined}):onBack()}>‹ {selected?"收藏":"桌面"}</button><h2>我的收藏</h2><button onClick={()=>setShowFilter(value=>!value)}>筛选</button></header>
    {!selected&&<nav className="rp-tabs">{([["all","全部"],["images","图片"],["text","文字"]] as const).map(([value,label])=><button key={value} data-rp-target={`favorites:tab:${value}`} aria-pressed={tab===value} onClick={()=>{setPage(0);onScreen({app:"favorites",section:value});}}>{label}</button>)}</nav>}
    {!selected&&showFilter&&<label>角色、组、来源或标签<input aria-label="筛选收藏" value={filter} onChange={event=>{setFilter(event.target.value);setPage(0);}} placeholder="输入角色、组名、来源或标签"/></label>}
    <main className="rp-scroll" data-rp-favorites-scroll key={selected?.id??`${tab}:${page}:${filter}`}>
      {selected&&entry?<article className="rp-detail" data-rp-favorite-detail={selected.id}>
        <h3>{selected.title}</h3><small>{FAVORITE_CATEGORY_LABELS[selected.category]} · {selected.entityName}</small>
        <section data-rp-entry><b>{entry.senderName}</b>{entry.mediaType==="image"&&entry.mediaUrl&&<Image mediaRef={entry.mediaUrl} name="收藏原图"/>}
        {entry.mediaType&&!["image","text"].includes(entry.mediaType)&&<p>此条为{entry.mediaType}，本页面未播放音视频。</p>}
        <p>{expanded?entry.content:entry.content.slice(0,180)}{!expanded&&entry.content.length>180?"…":""}</p>
        {!expanded&&entry.content.length>180&&<button data-rp-target="favorites:expand" onClick={()=>setExpanded(true)}>展开全文</button>}
        </section>
        {selected.entries.length>1&&<nav><button disabled={!entryIndex} onClick={()=>{setEntryIndex(value=>value-1);setExpanded(false);}}>上一条</button><span>{entryIndex+1}/{selected.entries.length}</span><button data-rp-target="favorites:next-entry" disabled={entryIndex>=selected.entries.length-1} onClick={()=>{setEntryIndex(value=>value+1);setExpanded(false);}}>下一条</button></nav>}
      </article>:<><div className={tab==="images"?"rp-favorites-grid":"rp-favorites-list"}>{rows.map(item=>{
        const image=item.entries.find(entry=>entry.mediaType==="image"&&entry.mediaUrl);
        return <button className="rp-card" data-rp-favorite={item.id} data-rp-target={`favorite:${item.id}`} key={item.id} onClick={()=>onScreen({...screen,itemId:item.id})}>
          <small>{FAVORITE_CATEGORY_LABELS[item.category]} · {item.entityName}</small>{image?.mediaUrl?<Image mediaRef={image.mediaUrl} name="收藏缩略图"/>:<p>{item.preview.slice(0,60)}</p>}<b>{item.title.slice(0,32)}</b>
        </button>;
      })}</div>{loaded&&!rows.length&&<p className="rp-empty">当前身份与授权范围内没有符合条件的收藏</p>}
      </>}
    </main>
    {!selected&&<nav className="rp-tabs"><button disabled={!page} onClick={()=>setPage(value=>value-1)}>上一页</button><span>{page+1}</span><button data-rp-target="favorites:next-page" disabled={(page+1)*9>=filtered.length} onClick={()=>setPage(value=>value+1)}>下一页</button></nav>}
  </section>;
}
