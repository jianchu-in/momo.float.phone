import type { ChatScopeState } from "./chat-scope-storage";

export const REVERSE_APPS = { chat: "聊天", shopping: "购物", browser: "浏览器", reading: "阅读" } as const;
export type ReverseApp = keyof typeof REVERSE_APPS;
export type AccessMode = "open" | "locked" | "hidden";
export type ReversePermissions = {
  modes: Record<ReverseApp, AccessMode>;
  chat: { targets: string[] | null; reply: boolean; remark: boolean; assets: boolean; balance: boolean };
  shopping: { cart: boolean; orders: boolean };
  browser: { history: boolean; bookmarks: boolean };
};
export type ReverseAutomation = {
  invitation: boolean; proactive: boolean; stealth: boolean;
  timing: "fixed" | "random"; intervalHours: number; minGapHours: number; weeklyLimit: number;
  startsAt: string; endsAt: string;
};
export type ReverseOverride = { automation?: Partial<ReverseAutomation>; modes?: Partial<ReversePermissions["modes"]>; chat?: Partial<ReversePermissions["chat"]>; shopping?: Partial<ReversePermissions["shopping"]>; browser?: Partial<ReversePermissions["browser"]> };
export type ReverseSettings = { automation?: ReverseAutomation; unified: ReversePermissions; characters: Record<string, ReverseOverride>; showTouch: boolean };
export type ReverseScope = ChatScopeState & { identityId: string | null; userName: string; userAvatar?: string; key: string };
export type BrowserEntry = { id: string; kind: "history" | "bookmarks"; title: string; url: string; description: string; updatedAt: string };
export type ReverseTask = { id: string; kind: "desktop" | "app" | "conversation" | "assets"; app?: ReverseApp; targetId?: string; state: "pending" | "done" | "skipped"; result?: ReverseResult | ChatDecision };
export type ReverseEvent = { id: string; at: string; kind: "view" | "speech" | "action" | "control"; text: string };
export type ReverseSession = {
  characterAvatar?: string;
  replayFrameCount?: number;
  origin?: "manual" | "dialogue" | "stealth";
  replay?: { at: number; html: string; speech: string; loading: string; app: string; touch?: { x: number; y: number; visible: boolean; pressed: boolean } }[];
  id: string; characterId: string; characterName: string; scope: ReverseScope; createdAt: string; updatedAt: string;
  status: "running" | "paused" | "stopped" | "completed"; tasks: ReverseTask[]; events: ReverseEvent[];
  inviteMessageId?: string; inviteSessionId?: string; accepted?: boolean; invitation?: { accepted: boolean; reaction: string }; error?: string;
};
export type ReverseChatControl = { page: "messages" | "me" | "wallet"; sessionId?: string; draft?: string; typing?: boolean; sending?: boolean };
export type ChatDecision = { action: "none" | "reply" | "remark" | "both"; reaction: string; remark: string; reply: string; farewell?: string };
export type ReverseStep = { target: string; speech: string };
export type ReverseResult = { reaction?: string; order?: ReverseApp[]; sessions?: string[]; steps?: ReverseStep[]; amount?: number; payCartIds?: string[]; payOrderIds?: string[]; farewell?: string; accepted?: boolean };
export const REVERSE_OPEN_EVENT = "reverse-phone-open";
