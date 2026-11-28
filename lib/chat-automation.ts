import { loadChatAppSettings, loadChatMessages, type ChatSession } from "./chat-storage";
import { kvUpdatePersisted } from "./kv-db";
import { resolveReverseAutomation } from "./reverse-phone-automation";
import { assertReverseScope, createReverseSession, readReverseJson, reverseScope, saveReverseSession, REVERSE_PREFIX } from "./reverse-phone-storage";

export type StoryAutomation = { proactive: boolean; arrival: boolean; intensity: "low" | "medium" | "high" };
export const DEFAULT_STORY_AUTOMATION: StoryAutomation = { proactive:false, arrival:false, intensity:"medium" };
export function resolveStoryAutomation(session?: Partial<ChatSession>): StoryAutomation {
  const global = loadChatAppSettings().storyAutomation;
  const value = { ...DEFAULT_STORY_AUTOMATION, ...global, ...(session?.allowForcedOfflineStory !== undefined ? { proactive:session.allowForcedOfflineStory } : {}), ...session?.storyAutomation };
  return { proactive:value.proactive === true, arrival:value.arrival === true, intensity:["low","medium","high"].includes(value.intensity) ? value.intensity : "medium" };
}
const CONTROL = /\[(强制开启线下剧情|已见面进入剧情|反查岗)\s*[:：]\s*([^\]\r\n]{1,500})\]/g;
export function extractChatAutomation(text:string) {
  let story: {kind:"proactive"|"arrival";description:string}|undefined, reverse:"invitation"|"proactive"|undefined;
  const clean = text.replace(CONTROL, (_,kind:string,value:string)=>{
    if (kind === "反查岗") { if(value.trim()==="接受邀请")reverse="invitation";else if(value.trim()==="主动提出")reverse="proactive"; }
    else if(!story) story={kind:kind==="已见面进入剧情"?"arrival":"proactive",description:value.trim()};
    return "";
  }).replace(/\[(?:强制开启线下剧情|已见面进入剧情|反查岗)[\s\S]*$/g,"").trim();
  return {text:clean,story,reverse};
}
export function chatAutomationPrompt(session:ChatSession) {
  if(session.isGroup)return "";
  const story=resolveStoryAutomation(session),reverse=resolveReverseAutomation(session.contactId,reverseScope());
  const strength={low:"保守，仅在明确、强烈而具体的意愿或现场确认时触发。",medium:"自然推进，有明确意愿或清楚的到场证据时触发。",high:"可以更积极主动推进，但不能每轮重复触发，不能虚构用户已经到场或替用户决定行为。"}[story.intensity];
  return ["【可选隐藏控制，只判断当前这轮与最近对话，不解释控制标记】",strength,
    story.proactive&&"允许按人设主动带入剧情APP。确实决定开始当前线下互动时，回复末尾输出[强制开启线下剧情:具体地点与衔接场景]。普通未来邀约不用。",
    story.arrival&&"判断你和用户是否已经实际见面/处于同一现场。结合谁、地点、现在/过去/将来及前后文；用户说看到你到了、你确认到他门口或已进他的门，可以触发。仅出发/正在开车去、未来计划、假设、回忆、引用或别人到达不能触发。确认本次已见面后在回复末尾输出[已见面进入剧情:具体到场证据与地点]。",
    reverse.invitation&&"用户当前明确邀请你看他的手机时，按人设决定接受或拒绝。接受则在答复末尾加[反查岗:接受邀请]；拒绝不加。不要把用户拒绝/反问/引用别人邀请当成邀请。",
    reverse.proactive&&"允许你主动提出查看用户手机。只有本轮确实想现在查看时，在自己的自然话语后加[反查岗:主动提出]；泛泛讨论查岗不要触发。",
    "以上标记各最多一次，正常答复不含代码解释；未开启的能力禁止使用。不要反复使用同一次见面或已接受的手机邀请。"
  ].filter(Boolean).join("\n");
}

export function explicitPhoneInvitation(text:string) {
  return !/(?:不让|不要|不想|别看|不能|不许|拒绝|假如|如果|上次|昨天|他说|她说)/.test(text.replace(/要不要|想不想|愿不愿意/g,"")) && /(?:要不要|想不想|愿不愿意|可以|给你|让你|请你).{0,12}(?:看|查).{0,8}(?:我|我的|手机)|(?:看|查)(?:一下|看)?我的手机|我的手机.{0,10}(?:给你|随便看|随便查)|(?:要不要|想不想|请你)(?:来)?查岗|手机在这.{0,8}随便翻/.test(text);
}
export function inferReverseIntent(sessionId:string,reply:string):"invitation"|"proactive"|undefined {
  const user=[...loadChatMessages(sessionId)].reverse().find(message=>message.role==="user");
  if(/(?:不看|不想看|先不|现在不|不用了|不了|下次再看|没兴趣)/.test(reply))return;
  if(user&&explicitPhoneInvitation(user.content)&&(/(?:让我|给我|我来).{0,6}(?:看|查|翻)/.test(reply)||/^(?:好(?:的|啊|呀)?(?:[，。！!\s]|$)|可以|当然可以|行(?:啊)?(?:[，。！!\s]|$))/.test(reply)))return "invitation";
  if(/(?:我想|让我|我来).{0,5}(?:看|查|翻).{0,5}你的手机|把你的手机.{0,5}给我/.test(reply))return "proactive";
}
export function confirmedArrival(sessionId:string):string|undefined {
  const messages=loadChatMessages(sessionId).filter(m=>["user","assistant"].includes(m.role)&&!m.isRetracted&&!m.mediaData?.reversePhoneOperationId);
  const user=[...messages].reverse().find(m=>m.role==="user"),last=[...messages].reverse().find(m=>m.role==="assistant");
  const reject=/(?:明天|后天|到时候|如果|假如|要是|昨天|上次|他说|她说|没到|还没|没看到|等你到了|等我到了)/;
  if(user&&/(?:我(?:已经)?(?:回家了|离开了|到家了|走了)|下次再见)/.test(user.content))return;
  if(user&&!reject.test(user.content)&&/(?:我(?:已经)?看(?:见|到)你(?:了|到)|你(?:已经)?到(?:我家|门口|这里|这儿)了)/.test(user.content))return user.content.slice(0,500);
  if(last&&!reject.test(last.content)&&/(?:我(?:已经)?到了.{0,10}(?:你家|你楼下|你门口)|我(?:已经)?(?:开门|推门|进门).{0,8}(?:进来|进去了|进你))/s.test(last.content)) {
    const context=messages.slice(-10,-1).some(m=>/(?:来找你|去找你|来我家|到我家|等你|给你开门|来看我)/.test(m.content));
    if(context)return last.content.slice(0,500);
  }
}
type Episode={source?:string;active?:boolean;lastDeparture?:string};
const episodeKey=(sessionId:string)=>REVERSE_PREFIX+"story-episode:"+reverseScope().key+":"+sessionId;
export async function claimStoryEpisode(sessionId:string,source:string) {
  let claimed=false;
  await kvUpdatePersisted(episodeKey(sessionId),raw=>{
    const old=readReverseJson<Episode>(raw,{});
    if(old.source===source||old.active)return raw!;
    claimed=true;return JSON.stringify({...old,source,active:true});
  });return claimed;
}
export async function releaseStoryEpisode(sessionId:string,source?:string) {
  await kvUpdatePersisted(episodeKey(sessionId),raw=>{const old=readReverseJson<Episode>(raw,{});return !source||old.source===source?JSON.stringify({...old,active:false}):raw??"{}";});
}
export async function rearmStoryAfterDeparture(sessionId:string) {
  const last=loadChatMessages(sessionId).filter(m=>m.role==="user").at(-1);
  if(last&&/(?:我(?:已经)?(?:回家了|离开了|到家了|走了)|你(?:已经)?(?:回家了|离开了|走了)|下次再见|今天先到这里)/.test(last.content))await kvUpdatePersisted(episodeKey(sessionId),raw=>{const old=readReverseJson<Episode>(raw,{});return old.lastDeparture===last.id?raw!:JSON.stringify({...old,active:false,lastDeparture:last.id});});
}
export async function createDialogueReverse(session:ChatSession,source:string,kind:"invitation"|"proactive") {
  const scope=reverseScope(),options=resolveReverseAutomation(session.contactId,scope);
  if(!options[kind]||session.isGroup)return null;
  const user=[...loadChatMessages(session.id)].reverse().find(m=>m.role==="user");
  if(kind==="invitation"&&(!user||!explicitPhoneInvitation(user.content)))return null;
  if((session.chatAccountId??null)!==scope.chatAccountId)return null;
  const sourceId=kind==="invitation"?user!.id:source;
  let accepted=false;
  await kvUpdatePersisted(REVERSE_PREFIX+"dialogue:"+scope.key+":"+session.id+":"+sourceId,raw=>{if(raw)return raw;accepted=true;return "1";});
  if(!accepted)return null;
  assertReverseScope(scope);
  const character=(await import("./character-storage")).loadCharacters().find(c=>c.id===session.contactId);
  if(!character)return null;
  const record={...createReverseSession(character,scope),origin:"dialogue" as const,accepted:true,inviteSessionId:session.id};
  await saveReverseSession(record);return record;
}
