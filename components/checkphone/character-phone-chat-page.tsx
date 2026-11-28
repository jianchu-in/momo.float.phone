"use client";
import {Fragment,useEffect,useRef,useState} from "react";
import {ChevronLeft,RefreshCw,Search,MessageCircle,Users,Aperture,ArrowUp,UserRound} from "lucide-react";
import {useCheckPhoneRefresh} from "@/lib/checkphone-refresh-tracker";
import {PageShell} from "@/components/ui/page-shell";
import {MessageBubble} from "@/components/chat/message-bubble";
import {ChatFallbackAvatar} from "@/components/chat/chat-fallback-avatar";
import {CheckPhoneBilingualText} from "./checkphone-bilingual-text";
import {characterPhoneContacts,mergeCharacterPhoneRefresh,ensureCharacterPhoneChat,appendCharacterPhoneMessage,replyToCharacterPhone,setCharacterPhoneReplyState,PHONE_CHAT_CHANGED} from "@/lib/character-phone-chat";
import {characterPhoneChatViewKey,loadCharacterPhoneChatView,saveCharacterPhoneDraft,markCharacterPhoneRead,markCharacterPhoneUpdates,phoneMessageDay,phoneMessageTime} from "@/lib/character-phone-chat-view";
import {loadCharacters} from "@/lib/character-storage";
import {resolveChatCharacterAvatar} from "@/lib/chat-storage";
import {resolveUserIdentity} from "@/lib/settings-storage";
import {loadCharacterMomentsProfile,CHARACTER_MOMENTS_PROFILE_UPDATED} from "@/lib/character-moments-profile";
import {getThemeAssetDataUrl} from "@/lib/theme-storage";
import {generateCheckPhoneChat} from "@/lib/checkphone-engine";
import {updatePhoneSnapshot,loadPhoneSnapshot} from "@/lib/checkphone-storage";
import type {CheckPhoneChatConversation,CheckPhoneChatPayload,CheckPhoneSnapshot} from "@/lib/checkphone-config";
import type {Character} from "@/lib/character-types";
import "@/styles/character-phone-chat.css";
function Avatar({url,name}:{url?:string|null;name:string}){return <span className="minimal-avatar-wrapper">{url?<img src={url} alt={name}/>:<ChatFallbackAvatar alt={name}/>}</span>;}
export function CharacterPhoneChatPage({character,onBack}:{character:Character;onBack:()=>void}){
 const [snapshot,setSnapshot]=useState<CheckPhoneSnapshot<CheckPhoneChatPayload>|null>(null),[tab,setTab]=useState<"messages"|"contacts"|"moments"|"profile">("messages"),[activeId,setActiveId]=useState<string>(),[groupId,setGroupId]=useState<string>();
 const [query,setQuery]=useState(""),[acting,setBusy]=useState(false),[stream,setStream]=useState(""),[error,setError]=useState(""),[cover,setCover]=useState<string|null>(null);
 const [receivingId,setReceivingId]=useState<string>();
 const [view,setView]=useState(()=>loadCharacterPhoneChatView(character.id)),[notice,setNotice]=useState("");
 const drafts=view.drafts,viewKey=characterPhoneChatViewKey(character.id);
 const snapshotRef=useRef(snapshot),openRef=useRef(activeId);snapshotRef.current=snapshot;openRef.current=activeId;
 useEffect(()=>{setView(loadCharacterPhoneChatView(character.id));},[viewKey,character.id]);
 const [refreshing,setRefreshing]=useCheckPhoneRefresh(character.id,"chat",setSnapshot);
 const busy=acting||refreshing;
 const sending=useRef(false),outbox=useRef(new Map<string,{text:string;id:string}>());
 const controller=useRef<AbortController|null>(null),mounted=useRef(true),log=useRef<HTMLDivElement>(null);
 const user=resolveUserIdentity(character.id,"checkphone"),chars=loadCharacters();
 const conversations=characterPhoneContacts(character,snapshot?.payload),active=conversations.find(item=>item.id===activeId),group=snapshot?.payload.groups.find(item=>item.id===groupId);
 const name=active?.remark?.trim()||active?.name||group?.name||character.name;
 const peerAvatar=(item:CheckPhoneChatConversation)=>item.peerType==="user"?user?.avatarUrl:resolveChatCharacterAvatar(chars.find(char=>char.id===item.peerCharacterId));
 useEffect(()=>{mounted.current=true;void ensureCharacterPhoneChat(character).then(value=>{if(mounted.current)setSnapshot(value);}).catch(e=>{if(mounted.current)setError(String(e));});return()=>{mounted.current=false;controller.current?.abort();controller.current=null;};},[character.id]);
 useEffect(()=>{let live=true;const refresh=()=>{const profile=loadCharacterMomentsProfile(character.id);if(profile.coverAssetId)void getThemeAssetDataUrl(profile.coverAssetId).then(url=>{if(live)setCover(url);});else setCover(null);};refresh();window.addEventListener(CHARACTER_MOMENTS_PROFILE_UPDATED,refresh);return()=>{live=false;window.removeEventListener(CHARACTER_MOMENTS_PROFILE_UPDATED,refresh);};},[character.id]);
 useEffect(()=>{const sync=(event:Event)=>{if((event as CustomEvent).detail?.characterId===character.id)void loadPhoneSnapshot<CheckPhoneChatPayload>(character.id,"chat").then(value=>{if(mounted.current){if(value)setView(markCharacterPhoneUpdates(character.id,snapshotRef.current?.payload??null,value.payload,openRef.current).view);setSnapshot(value);}});};window.addEventListener(PHONE_CHAT_CHANGED,sync);return()=>window.removeEventListener(PHONE_CHAT_CHANGED,sync);},[character.id]);
 useEffect(()=>{if(log.current)log.current.scrollTop=log.current.scrollHeight;},[active?.messages.length,stream,activeId]);
 async function receive(conversationId:string){
  if(controller.current)return;
  const c=new AbortController();controller.current=c;setReceivingId(conversationId);setBusy(true);setError("");setStream("");let operationId:string|undefined;
  try{
   const current=await loadPhoneSnapshot<CheckPhoneChatPayload>(character.id,"chat");operationId=current?.payload.conversations.find(row=>row.id===conversationId)?.pendingReply?.operationId;
   if(!operationId)return;
   if(c.signal.aborted){const value=await setCharacterPhoneReplyState(character.id,conversationId,operationId,"stopped");if(mounted.current)setSnapshot(value);return;}
   await setCharacterPhoneReplyState(character.id,conversationId,operationId,"waiting");
   const value=await replyToCharacterPhone(character,conversationId,c.signal,text=>{if(mounted.current&&!c.signal.aborted)setStream(text);});
   if(value&&mounted.current){setView(markCharacterPhoneUpdates(character.id,current?.payload??null,value.payload,openRef.current).view);setSnapshot(value);}
  }catch(e){
   if(operationId){const value=await setCharacterPhoneReplyState(character.id,conversationId,operationId,c.signal.aborted?"stopped":"failed").catch(()=>null);if(value&&mounted.current)setSnapshot(value);}
   if(!c.signal.aborted&&mounted.current)setError(e instanceof Error?e.message:"接收回复失败，可继续接收");
  }finally{if(controller.current===c){controller.current=null;if(mounted.current){setReceivingId(undefined);setBusy(false);setStream("");}}}
 }
 async function send(){if(!active||busy||controller.current||sending.current)return;const text=drafts[active.id]?.trim();if(!text)return;sending.current=true;setBusy(true);setError("");const prior=outbox.current.get(active.id);const operation=prior?.text===text?prior.id:crypto.randomUUID();outbox.current.set(active.id,{text,id:operation});try{const value=await appendCharacterPhoneMessage(character,active.id,text,operation);outbox.current.delete(active.id);const cleared=saveCharacterPhoneDraft(character.id,active.id,"");if(!mounted.current)return;setSnapshot(value);setView(cleared);setBusy(false);if(active.peerType!=="user")await receive(active.id);}catch(e){if(mounted.current){setError(e instanceof Error?e.message:"发送失败");setBusy(false);}}finally{sending.current=false;}}
 async function refresh(){if(busy)return;setRefreshing(true);setError("");try{
  const result=await generateCheckPhoneChat(character.id,snapshot?.payload??null,snapshot?.updatedAt,active?.peerCharacterId);
  if(result.payload){const refreshId=crypto.randomUUID();const value=await updatePhoneSnapshot<CheckPhoneChatPayload>(character.id,"chat",current=>({
    ...mergeCharacterPhoneRefresh(character,current,result.payload!,refreshId),summary:result.summary,
  }));const updates=markCharacterPhoneUpdates(character.id,snapshot?.payload??null,value.payload,openRef.current);if(mounted.current){setSnapshot(value);setView(updates.view);setNotice(updates.updated.length?`本次更新：${updates.updated.join("、")}`:"本次没有新增聊天消息，已有记录已保留。");}}
  if(result.error&&mounted.current)setError(result.error);
 }catch(e){if(mounted.current)setError(e instanceof Error?e.message:"刷新失败");}finally{setRefreshing(false);}}

 const back=()=>{if(active||group){setActiveId(undefined);setGroupId(undefined);setError("");}else onBack();};
 return <section className="chat-app character-phone-chat" aria-label={`${character.name}的聊天APP`}>
 <PageShell title={active||group?name:""} onBack={active||group?back:undefined} leftAction={!active&&!group?<div className="phone-chat-owner"><button type="button" className="page-back-btn" aria-label="返回" onClick={onBack}><ChevronLeft size={24} strokeWidth={1.5}/></button><Avatar url={resolveChatCharacterAvatar(character)} name={character.name}/><span><strong>{character.name}</strong><small>● 在线</small></span></div>:undefined} rightAction={!active&&!group?<button className="page-back-btn" aria-label="刷新角色聊天" disabled={busy||!snapshot} onClick={()=>void refresh()}><RefreshCw size={17}/><span>刷新聊天</span></button>:<Avatar url={resolveChatCharacterAvatar(character)} name={character.name}/>}>
 
 {active||group?<>{active?.peerType==="user"&&<p className="phone-chat-user-remark">他给你的备注：{active.remark||"暂未设置"}</p>}<div ref={log} className="character-phone-messages" role="log" aria-label="角色手机聊天记录">{(active?.messages??group?.messages??[]).map((message,index,messages)=>{const outgoing=message.direction==="outgoing",day=phoneMessageDay(message.timeLabel),proxy=outgoing&&(message.source==="proxy"||message.id.startsWith("phone_")&&!message.id.startsWith("phone_generated_"));return <Fragment key={message.id}>{day&&day!==phoneMessageDay(messages[index-1]?.timeLabel??"")&&<div className="phone-chat-date-divider">{day}</div>}<div className={`character-phone-message ${outgoing?"is-outgoing":""}`} key={message.id}>
 <Avatar url={outgoing?resolveChatCharacterAvatar(character):active?peerAvatar(active):undefined} name={outgoing?character.name:message.authorLabel||name}/><div><small>{outgoing?character.name:message.authorLabel||name}</small><div className={outgoing?"chat-bubble-role-user":"chat-bubble-role-assistant"}><MessageBubble msg={{id:message.id,sessionId:activeId||groupId||"",role:outgoing?"user":"assistant",content:message.text,status:"sent",createdAt:message.timeLabel}} characterId={outgoing?character.id:active?.peerCharacterId??character.id} charName={name} userName={character.name}/></div><div className="phone-chat-message-meta"><time>{phoneMessageTime(message.timeLabel)}</time>{proxy&&<span>由你代发</span>}</div></div></div></Fragment>;})}
 {active&&!active.messages.length&&<div className="phone-chat-empty"><p>{active.peerType==="character"?"还没有这段聊天记录，可以生成与此人的日常交流，也可以直接代他发消息。":"这里还没有消息，可以直接代他发送。"}</p>{active.peerType==="character"&&<button className="ui-btn" disabled={busy} onClick={()=>void refresh()}>生成这段聊天记录</button>}</div>}
 {busy&&active?.id===receivingId&&active&&controller.current&&<div className="character-phone-message"><Avatar url={peerAvatar(active)} name={active.name}/><div className="chat-bubble-role-assistant">{stream||`${active.name}正在打字中…`}</div></div>}</div>
 {active&&<><p className="character-phone-proxy-note">正在代{character.name}回复{active.name}</p><form className="character-phone-composer" onSubmit={e=>{e.preventDefault();void send();}}><input aria-label="代回复内容" value={drafts[active.id]??""} onChange={e=>setView(saveCharacterPhoneDraft(character.id,active.id,e.target.value))} disabled={busy} placeholder="代他回复…"/><button type="submit" disabled={busy||!drafts[active.id]?.trim()} aria-label="发送代回复"><ArrowUp size={20}/></button></form>{active.pendingReply&&!busy&&<div className="phone-chat-receive-state" role="status"><span>{active.pendingReply.state==="stopped"?"接收已停止，已发消息保留":active.pendingReply.state==="failed"?"接收失败，已发消息保留":"等待接收对方回复"}</span><button className="ui-btn" onClick={()=>void receive(active.id)}>继续接收</button></div>}</>}
 </>:<>
 {(tab==="messages"||tab==="contacts")&&<><div className="phone-chat-search"><h1>{tab==="contacts"?"Contacts":"Chats"}</h1><label className="chat-search-bar"><Search size={17}/><input className="chat-search-input" aria-label="搜索角色手机会话" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索联系人"/></label></div>
 {notice&&<p className="phone-chat-update-notice" role="status">{notice}</p>}{snapshot&&conversations.some(item=>item.peerType==="character")&&!conversations.some(item=>item.peerType==="character"&&item.messages.length>0)&&<p className="phone-chat-empty">同世界联系人已载入，点击「刷新聊天」生成几段日常交流记录。</p>}
 <div>{conversations.filter(item=>(item.name+" "+(item.remark||"")).toLowerCase().includes(query.toLowerCase())).map(item=><button className="minimal-list-item" key={item.id} onClick={()=>{setActiveId(item.id);setView(markCharacterPhoneRead(character.id,item.id));setError("");}}><Avatar url={peerAvatar(item)} name={item.name}/><div className="minimal-item-content"><div className="minimal-item-row"><strong>{item.remark?.trim()||item.name}</strong>{view.unread.includes(item.id)&&<span className="phone-chat-unread" aria-label="有新聊天记录"/>}{item.pinned&&<span className="phone-chat-pinned" aria-label="置顶聊天">置顶</span>}<time>{item.timeLabel?Number.isFinite(Date.parse(item.timeLabel))?new Date(item.timeLabel).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}):item.timeLabel:""}</time></div>{item.peerType==="user"&&item.remark&&<small className="phone-chat-remark-label">他给你的备注</small>}<p>{item.pendingReply?(item.pendingReply.state==="stopped"?"接收已停止":item.pendingReply.state==="failed"?"接收失败，可继续接收":"等待对方回复"):item.messages.at(-1)?.text||item.preview}</p></div></button>)}{tab==="messages"&&snapshot?.payload.groups.map(item=><button className="minimal-list-item" key={item.id} onClick={()=>setGroupId(item.id)}><Avatar name={item.name}/><div className="minimal-item-content"><strong>{item.name}</strong><p>{item.preview}</p></div></button>)}</div></>}
 {tab==="profile"&&<div className="phone-chat-profile"><Avatar url={resolveChatCharacterAvatar(character)} name={character.name}/><h2>{character.name}</h2><p>{loadCharacterMomentsProfile(character.id).signature||"暂无签名"}</p><button type="button" className="ui-btn" onClick={()=>setTab("moments")}>朋友圈</button></div>}
 {tab==="moments"&&<div className="feed-page"><div className="feed-cover character-phone-cover" style={{backgroundImage:cover?`url(${cover})`:undefined}}><strong>{character.name}</strong><Avatar url={resolveChatCharacterAvatar(character)} name={character.name}/></div><p className="phone-chat-signature">{loadCharacterMomentsProfile(character.id).signature}</p>{snapshot?.payload.momentsFeed.map(post=>{const author=chars.find(c=>c.name===post.authorLabel);return <article className="feed-card" key={post.id}><Avatar url={post.authorLabel===user?.name?user.avatarUrl:resolveChatCharacterAvatar(author)} name={post.authorLabel}/><div><strong>{post.authorLabel}</strong><CheckPhoneBilingualText text={post.body}/>{post.photoUrl&&<img className="phone-chat-moment-photo" src={post.photoUrl} alt={post.photoDescription||"动态配图"}/>}<small>{post.timeLabel}</small><p>♡ {post.likeCountLabel}</p>{post.comments.map(comment=><p key={comment.id}><b>{comment.authorLabel}</b>：{comment.text}</p>)}</div></article>;})}{!snapshot?.payload.momentsFeed.length&&<p className="phone-chat-empty">暂无朋友圈内容，可点击右上角刷新。</p>}</div>}
 </>}
 {refreshing&&<p role="status" className="phone-chat-empty">正在刷新聊天内容，返回后仍会保存结果…</p>}
 {error&&<p className="phone-chat-error" role="alert">{error}</p>}{busy&&controller.current&&<button className="phone-chat-stop" onClick={()=>{controller.current?.abort();setStream("");}}>停止接收</button>}
 </PageShell>
 {!active&&!group&&<nav className="chat-tab-bar"><button aria-pressed={tab==="messages"} onClick={()=>setTab("messages")}><MessageCircle size={20}/>消息</button><button aria-pressed={tab==="contacts"} onClick={()=>setTab("contacts")}><Users size={20}/>联系人</button><button aria-pressed={tab==="moments"} onClick={()=>setTab("moments")}><Aperture size={20}/>动态</button><button aria-pressed={tab==="profile"} onClick={()=>setTab("profile")}><UserRound size={20}/>主页</button></nav>}
 </section>;
}
