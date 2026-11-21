import {loadCharacters} from "./character-storage";
import {getCharacterWorldGroup} from "./character-world-storage";
import {loadChatScope} from "./chat-scope-storage";
import {createOrGetSession,hydrateChatStorage,loadChatMessages,loadChatSessions,pushChatMessage,getChatMessagePreview} from "./chat-storage";
import {chatDb} from "./chat-db";
import {loadApiConfigs,loadBindingConfig,resolveBinding,resolveUserIdentity} from "./settings-storage";
import {sendLLMStreamRequest} from "./chat-engine";
import {loadPhoneSnapshot,savePhoneSnapshot,updatePhoneSnapshot,updatePhoneSnapshotPair,recordCharacterPhoneChatMemory} from "./checkphone-storage";
import {cleanStreamText} from "./stream-preview";
import {splitReverseReply} from "./reverse-phone-replies";
import {throwIfAborted} from "./abort-utils";
import type {Character} from "./character-types";
import type {CheckPhoneChatConversation,CheckPhoneChatPayload,CheckPhoneSnapshot} from "./checkphone-config";
export const PHONE_CHAT_CHANGED="character-phone-chat-updated";
const id=()=>globalThis.crypto.randomUUID();
const norm=(name:string)=>name.normalize("NFKC").replace(/\s/g,"").toLowerCase();
export function characterPhoneContacts(owner:Character,payload?:CheckPhoneChatPayload|null):CheckPhoneChatConversation[]{
 const chars=loadCharacters(),world=getCharacterWorldGroup(owner.id),user=resolveUserIdentity(owner.id,"checkphone");
 const account=loadChatScope().chatAccountId;
 const direct=loadChatSessions().find(session=>!session.isGroup&&session.contactId===owner.id&&(session.chatAccountId??null)===(account??null));
 const old=payload?.conversations??[];
 const userKey=JSON.stringify([account??null,user?.id??null]);
 const userOld=old.find(item=>item.peerType==="user"&&item.peerUserKey===userKey||!!direct&&item.id===`real_conv_${direct.id}`);
 const real=direct?loadChatMessages(direct.id).filter(m=>m.role!=="system"&&!m.isRetracted).slice(-80).map(m=>({id:m.id,text:getChatMessagePreview(m)||m.content,timeLabel:m.createdAt,direction:m.role==="user"?"incoming" as const:"outgoing" as const})):[];
 const userRow:CheckPhoneChatConversation={...userOld,id:userOld?.id??(direct?`real_conv_${direct.id}`:`phone_user_${user?.id??"default"}_${account??"main"}`),peerType:"user",peerUserKey:userKey,name:user?.name||"用户",remark:direct?.characterRemarkForUser?.trim()||userOld?.remark?.trim()||payload?.userRemark?.trim()||undefined,pinned:true,preview:real.at(-1)?.text||userOld?.preview||"与用户的对话",timeLabel:real.at(-1)?.timeLabel||userOld?.timeLabel||"",tagLabel:"真实会话",messages:real.length?real:userOld?.messages??[]};
 const known=chars.filter(char=>char.id!==owner.id&&world?.memberIds.includes(char.id));
 const rows=known.map(char=>{const prior=old.find(item=>item.peerCharacterId===char.id||norm(item.name)===norm(char.name));return {...prior,id:prior?.id??`phone_char_${char.id}`,peerCharacterId:char.id,peerType:"character" as const,name:char.name,preview:prior?.preview||"同世界角色",timeLabel:prior?.timeLabel||"",tagLabel:prior?.tagLabel||"同世界",messages:prior?.messages??[]};});
 const reserved=new Set([norm(userRow.name),...chars.map(char=>norm(char.name))]);
 const npcs=old.filter(item=>item.peerType!=="user"&&!item.id.startsWith("real_conv_")&&!reserved.has(norm(item.name))).map(item=>({...item,peerType:"npc" as const,peerCharacterId:undefined}));
 return [userRow,...rows,...npcs].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned));
}
/** 刷新时保留已产生的聊天历史与待接收状态，模型新生成的对话作为增量添加。 */
export function mergeCharacterPhoneRefresh(
 owner:Character, current:CheckPhoneSnapshot<CheckPhoneChatPayload>,
 fresh:CheckPhoneChatPayload, refreshId:string,
):CheckPhoneSnapshot<CheckPhoneChatPayload> {
 const now=new Date().toISOString();
 const incoming=characterPhoneContacts(owner,fresh).map(item=>{
  const previous=current.payload.conversations.find(old=>(
   item.peerType==="user"?old.peerType==="user"&&old.peerUserKey===item.peerUserKey:
   item.peerCharacterId?old.peerCharacterId===item.peerCharacterId:
   old.peerType==="npc"&&norm(old.name)===norm(item.name)
  ));
  if(item.peerType==="user"){
   return {...item,id:previous?.id??item.id,remark:previous?.remark||item.remark,
    messages:item.messages.length?item.messages:previous?.messages??[]};
  }
  const existing=previous?.messages??[];
  const generated=item.messages.filter(message=>!!message.text.trim());
  const seen=new Set(existing.slice(-12).map(message=>`${message.direction}:${message.text.trim()}`));
  const additional=generated.filter(message=>{
   const key=`${message.direction}:${message.text.trim()}`;
   if(seen.has(key))return false;
   seen.add(key);return true;
  }).map((message,index)=>({...message,id:`phone_generated_${refreshId}_${item.peerCharacterId??item.id}_${index}`}));
  const messages=[...existing,...additional].slice(-100);
  return {...item,id:previous?.id??item.id,
   pinned:previous?.pinned??item.pinned,
   messages,pendingReply:previous?.pendingReply,
   preview:messages.at(-1)?.text||item.preview,
   timeLabel:messages.at(-1)?.timeLabel||item.timeLabel};
 });
 return {...current,updatedAt:now,payload:{...fresh,
  userRemark:current.payload.userRemark||fresh.userRemark,
  conversations:incoming,
 }};
}

export async function ensureCharacterPhoneChat(owner:Character){
 await hydrateChatStorage();
 const existing=await loadPhoneSnapshot<CheckPhoneChatPayload>(owner.id,"chat");
 const now=new Date().toISOString();
 const payload:CheckPhoneChatPayload=existing?.payload??{headerTitle:"Chats",headerSubtitle:owner.name,conversations:[],groups:[],momentsFeed:[],contacts:[]};
 const snapshot:CheckPhoneSnapshot<CheckPhoneChatPayload>={...existing,id:`${owner.id}:chat`,characterId:owner.id,appId:"chat",generatedAt:existing?.generatedAt??now,updatedAt:existing?.updatedAt??now,payload:{...payload,conversations:characterPhoneContacts(owner,payload)}};
 return updatePhoneSnapshot<CheckPhoneChatPayload>(owner.id,"chat",current=>({...current,payload:{...current.payload,conversations:characterPhoneContacts(owner,current.payload)}}),snapshot);
}
function notify(ownerId:string){if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent(PHONE_CHAT_CHANGED,{detail:{characterId:ownerId}}));}
export async function appendCharacterPhoneMessage(owner:Character,conversationId:string,text:string,operationId=id()){
 if(!text.trim())throw new Error("请先输入回复内容。");
 let snapshot=await loadPhoneSnapshot<CheckPhoneChatPayload>(owner.id,"chat")??await ensureCharacterPhoneChat(owner);
 const conversation=characterPhoneContacts(owner,snapshot.payload).find(item=>item.id===conversationId);
 if(!conversation)throw new Error("这段会话已不存在，请返回列表重新选择。");
 const existing=conversation.messages.find(message=>message.id===`phone_${operationId}:out`);
 if(existing)return snapshot;
 const at=new Date().toISOString();let messageId=`phone_${operationId}:out`;
 if(conversation.peerType==="user"){
  const session=createOrGetSession(owner.id,loadChatScope().chatAccountId??null);
  let message=loadChatMessages(session.id).find(m=>m.mediaData?.characterPhoneOperationId===operationId);
  if(!message)message=pushChatMessage({sessionId:session.id,role:"assistant",senderName:owner.name,content:text.trim(),mediaData:{characterPhoneOperationId:operationId}});
  await chatDb.messages.put(message);messageId=message.id;
  window.dispatchEvent(new CustomEvent("chat-messages-updated",{detail:{sessionId:session.id}}));
 }
 const updateOwner=(current:CheckPhoneSnapshot<CheckPhoneChatPayload>)=>{
  const contacts=characterPhoneContacts(owner,current.payload);return {...current,updatedAt:at,payload:{...current.payload,conversations:contacts.map(item=>item.id===conversationId?{...item,preview:text.trim(),timeLabel:at,
   pendingReply:item.peerType!=="user"?{operationId,sentMessageId:messageId}:undefined,
   messages:item.messages.some(m=>m.id===messageId)?item.messages:[...item.messages,{id:messageId,text:text.trim(),timeLabel:at,direction:"outgoing" as const}]}:item)}};
 }; const peer=loadCharacters().find(char=>char.id===conversation.peerCharacterId);
 if(peer){const other=await ensureCharacterPhoneChat(peer);snapshot=await updatePhoneSnapshotPair(snapshot,other,updateOwner,value=>mirrorPhoneConversation(value,peer,owner,[{id:messageId,text:text.trim(),timeLabel:at,direction:"incoming"}]));notify(peer.id);}
 else snapshot=await updatePhoneSnapshot<CheckPhoneChatPayload>(owner.id,"chat",updateOwner);
 recordCharacterPhoneChatMemory(owner.id,messageId,`{{user}}代{{char}}在查手机中向${conversation.name}发送消息：${text.trim()}`,at);
 if(peer)recordCharacterPhoneChatMemory(peer.id,messageId,`${owner.name}发来消息（由用户代其发送）：${text.trim()}`,at);
 notify(owner.id);return snapshot;
}
export async function replyToCharacterPhone(owner:Character,conversationId:string,signal:AbortSignal,onDelta:(text:string)=>void){
 const snapshot=await loadPhoneSnapshot<CheckPhoneChatPayload>(owner.id,"chat");const conversation=snapshot?.payload.conversations.find(item=>item.id===conversationId);
 if(!snapshot||!conversation?.pendingReply)return snapshot;
 const pending=conversation.pendingReply,peer=loadCharacters().find(char=>char.id===conversation.peerCharacterId);
 if(conversation.peerType==="character"&&!getCharacterWorldGroup(owner.id)?.memberIds.includes(peer?.id??""))throw new Error("对方已不在这个世界，已停止生成回复。");
 throwIfAborted(signal);
 const lead=peer??owner,slot=resolveBinding(loadBindingConfig(),lead.id,"checkphone"),api=loadApiConfigs().find(item=>item.id===slot.apiConfigId)??loadApiConfigs().find(item=>item.id===resolveBinding(loadBindingConfig(),owner.id,"checkphone").apiConfigId);
 if(!api)throw new Error(`请先为${lead.name}的查手机绑定文字API。消息已保存，可稍后重试接收回复。`);
 let buffer="";
 const result=await sendLLMStreamRequest(api,null,[{role:"system",content:`你扮演${conversation.name}，正在与${owner.name}私聊。${peer?.persona??"按会话里的NPC身份与关系接话。"}\n用户正在代${owner.name}操作手机；对面发来的内容就是${owner.name}说的话。只回复你自己的私聊正文，禁止替${owner.name}和现实用户发言。可用空行分成数条自然消息，不写思考或JSON。`},{role:"user",content:JSON.stringify({对话对象:{name:owner.name,persona:owner.persona},最近对话:conversation.messages.slice(-20).map(m=>({speaker:m.direction==="outgoing"?owner.name:conversation.name,text:m.text}))})}],[],{characterName:conversation.name},{appId:"character_phone_chat_reply",signal,skipOutputRegex:true},{onDelta:(delta:string)=>{buffer+=delta;if(!signal.aborted)onDelta(cleanStreamText(buffer,{stripXmlTags:["think","thinking","analysis","reasoning"]}));}});
 throwIfAborted(signal);const content=cleanStreamText(result.content,{stripXmlTags:["think","thinking","analysis","reasoning"]}).trim();if(!content)throw new Error("对方没有返回有效回复，可重试接收。");
 const at=new Date().toISOString(),parts=splitReverseReply(content);
 const updateOwner=(current:CheckPhoneSnapshot<CheckPhoneChatPayload>)=>({...current,updatedAt:at,payload:{...current.payload,conversations:current.payload.conversations.map(item=>{
  throwIfAborted(signal);
  if(item.id!==conversationId||item.pendingReply?.operationId!==pending.operationId)return item;
  const messages=parts.map((text,index)=>({id:`phone_${pending.operationId}:in:${index}`,text,timeLabel:at,direction:"incoming" as const}));
  return {...item,pendingReply:undefined,preview:content,timeLabel:at,messages:[...item.messages,...messages.filter(message=>!item.messages.some(m=>m.id===message.id))]};
 })}}); let updated:CheckPhoneSnapshot<CheckPhoneChatPayload>;
 if(peer){const other=await ensureCharacterPhoneChat(peer);updated=await updatePhoneSnapshotPair(snapshot,other,updateOwner,value=>mirrorPhoneConversation(value,peer,owner,parts.map((text,index)=>({id:`phone_${pending.operationId}:in:${index}`,text,timeLabel:at,direction:"outgoing" as const}))));notify(peer.id);}
 else updated=await updatePhoneSnapshot<CheckPhoneChatPayload>(owner.id,"chat",updateOwner);
 for(let index=0;index<parts.length;index++){
  const messageId=`phone_${pending.operationId}:in:${index}`;
  recordCharacterPhoneChatMemory(owner.id,messageId,`${conversation.name}回复{{char}}：${parts[index]}`,at);
  if(peer)recordCharacterPhoneChatMemory(peer.id,messageId,`{{char}}在与${owner.name}的聊天中回复：${parts[index]}`,at);
 }
 notify(owner.id);return updated;
}

function mirrorPhoneConversation(snapshot:CheckPhoneSnapshot<CheckPhoneChatPayload>,peer:Character,owner:Character,messages:CheckPhoneChatConversation["messages"]):CheckPhoneSnapshot<CheckPhoneChatPayload>{
 const rows=characterPhoneContacts(peer,snapshot.payload);
 return {...snapshot,updatedAt:new Date().toISOString(),payload:{...snapshot.payload,conversations:rows.map(row=>row.peerCharacterId===owner.id?{...row,preview:messages.at(-1)?.text??row.preview,timeLabel:messages.at(-1)?.timeLabel??row.timeLabel,messages:[...row.messages,...messages.filter(m=>!row.messages.some(previous=>previous.id===m.id))]}:row)}};
}
