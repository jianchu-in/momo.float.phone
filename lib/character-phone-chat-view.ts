import {kvGet,kvSet,registerDynamicPrefix} from "./kv-db";
import {loadChatScope} from "./chat-scope-storage";
import {resolveUserIdentity} from "./settings-storage";
import type {CheckPhoneChatPayload} from "./checkphone-config";

const PREFIX="character_phone_chat_view_";
registerDynamicPrefix(PREFIX);
export type CharacterPhoneChatView={drafts:Record<string,string>;unread:string[]};
export function characterPhoneChatViewKey(characterId:string){
 return PREFIX+encodeURIComponent(JSON.stringify([characterId,loadChatScope().chatAccountId??null,resolveUserIdentity(characterId,"checkphone")?.id??null]));
}
export function loadCharacterPhoneChatView(characterId:string):CharacterPhoneChatView{
 try{const value=JSON.parse(kvGet(characterPhoneChatViewKey(characterId))||"{}");return {
  drafts:Object.fromEntries(Object.entries(value.drafts??{}).filter((entry):entry is [string,string]=>typeof entry[1]==="string")),
  unread:Array.isArray(value.unread)?value.unread.filter((id:unknown)=>typeof id==="string"):[],
 };}catch{return {drafts:{},unread:[]};}
}
function save(characterId:string,value:CharacterPhoneChatView){kvSet(characterPhoneChatViewKey(characterId),JSON.stringify(value));return value;}
export function saveCharacterPhoneDraft(characterId:string,conversationId:string,text:string){
 const current=loadCharacterPhoneChatView(characterId);if(text)current.drafts[conversationId]=text;else delete current.drafts[conversationId];return save(characterId,current);
}
export function markCharacterPhoneRead(characterId:string,conversationId:string){
 const current=loadCharacterPhoneChatView(characterId);return save(characterId,{...current,unread:current.unread.filter(id=>id!==conversationId)});
}
export function markCharacterPhoneUpdates(characterId:string,before:CheckPhoneChatPayload|null,after:CheckPhoneChatPayload,openId?:string){
 const current=loadCharacterPhoneChatView(characterId),unread=new Set(current.unread),updated:string[]=[];
 for(const row of after.conversations){
  if(row.peerType==="user")continue;
  const old=before?.conversations.find(item=>item.id===row.id),known=new Set(old?.messages.map(item=>item.id));
  if(row.messages.some(item=>!known.has(item.id))){updated.push(row.remark||row.name);if(row.id!==openId)unread.add(row.id);}
 }
 if(openId)unread.delete(openId);
 return {view:save(characterId,{...current,unread:[...unread]}),updated};
}
export function phoneMessageDay(value:string){const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleDateString("zh-CN"):"";}
export function phoneMessageTime(value:string){const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}):value;}
