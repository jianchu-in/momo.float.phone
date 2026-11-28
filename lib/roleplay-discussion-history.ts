import { kvGet, kvKeysWithPrefix, kvUpdatePersisted } from "./kv-db";
import type { MascotPageContext } from "./mascot-context";
import type { DiscussionTurn } from "./roleplay-discussion";

const KEY_PREFIX = "ai_phone_roleplay_discussion_conversation_v1:";
export const DISCUSSION_HISTORY_UPDATED = "roleplay-discussion-history-updated";

const SCENE_FIELDS = ["sessionId", "characterId", "entryId", "phoneAppId", "postIds", "chatAccountId", "userName", "signature"] as const;

export type DiscussionMessage = DiscussionTurn & {
  id: string;
  speaker: string;
  replyTo?: string;
  versions?: { content: string; speaker: string }[];
  versionIndex?: number;
};

type DiscussionSelection = {
  characterId: string;
  characterName: string;
  presetId: string;
};

export type DiscussionConversation = DiscussionSelection & {
  id: string;
  context: MascotPageContext;
  updatedAt: number;
  messages: DiscussionMessage[];
};

export function discussionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function createDiscussionConversation(context: MascotPageContext, character?: { id: string; name: string }): DiscussionConversation {
  const fields: MascotPageContext["fields"] = {};
  for (const key of SCENE_FIELDS) {
    if (context.fields[key] !== undefined) fields[key] = context.fields[key];
  }
  return {
    id: discussionId(),
    context: { ...context, fields },
    characterId: character?.id ?? "",
    characterName: character?.name ?? "",
    presetId: "model",
    updatedAt: Date.now(),
    messages: [],
  };
}

function parseConversation(raw: string | null): DiscussionConversation | null {
  try {
    const value = JSON.parse(raw ?? "null") as DiscussionConversation | null;
    return value && !(value as DiscussionConversation & { deleted?: boolean }).deleted && typeof value.id === "string" && value.context && Array.isArray(value.messages) ? value : null;
  } catch {
    return null;
  }
}

export function loadDiscussionConversations(): DiscussionConversation[] {
  return kvKeysWithPrefix(KEY_PREFIX)
    .map(key => parseConversation(kvGet(key)))
    .filter((item): item is DiscussionConversation => !!item?.messages.length)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function discussionRetryUser(messages: DiscussionMessage[], messageId: string): DiscussionMessage | undefined {
  const index = messages.findIndex(item => item.id === messageId), message = messages[index];
  if (!message) return;
  if (message.role === "user") return message;
  // A saved link remains authoritative after its user message is deleted.
  if (message.replyTo) return messages.find(item => item.id === message.replyTo && item.role === "user");
  return messages.slice(0, index).reverse().find(item => item.role === "user");
}

export async function updateDiscussionConversation(
  conversation: DiscussionConversation,
  update: { selection?: Partial<DiscussionSelection>; message?: DiscussionMessage;
    edit?: { id: string; content: string }; removeMessageId?: string; version?: { id: string; index: number };
    reply?: { userId: string; userContent: string; replaceId?: string; content: string; speaker: string } },
): Promise<DiscussionConversation> {
  let result = conversation;
  await kvUpdatePersisted(KEY_PREFIX + conversation.id, raw => {
    if (raw && JSON.parse(raw).deleted) throw new Error("这段对话已删除。");
    const current = parseConversation(raw) ?? conversation;
    const messages = [...current.messages];
    const message = update.message;
    if (message && !messages.some(item => item.id === message.id || (message.replyTo && item.replyTo === message.replyTo))) {
      const replyIndex = message.replyTo ? messages.findIndex(item => item.id === message.replyTo) : -1;
      if (replyIndex >= 0) messages.splice(replyIndex + 1, 0, message);
      else messages.push(message);
    }
    if (update.edit) {
      const index = messages.findIndex(item => item.id === update.edit!.id);
      if (index < 0) throw new Error("这条消息已删除。");
      const item = messages[index];
      const versions = item.versions?.map((version, i) => i === (item.versionIndex ?? 0) ? { ...version, content: update.edit!.content } : version);
      messages[index] = { ...item, content: update.edit.content, versions };
    }
    if (update.removeMessageId) {
      const index = messages.findIndex(item => item.id === update.removeMessageId);
      if (index >= 0) messages.splice(index, 1);
    }
    if (update.reply) {
      const reply = update.reply;
      const userIndex = messages.findIndex(item => item.id === reply.userId && item.role === "user");
      if (userIndex < 0 || messages[userIndex].content !== reply.userContent) throw new Error("原消息已修改或删除，请重新重试。");
      const index = reply.replaceId ? messages.findIndex(item => item.id === reply.replaceId && item.role === "assistant") : messages.findIndex(item => item.replyTo === reply.userId);
      if (reply.replaceId && index < 0) throw new Error("原回复已删除，请重新重试。");
      if (index >= 0) {
        const item = messages[index];
        if (item.replyTo && item.replyTo !== reply.userId) throw new Error("这条回复不属于所选用户消息，已停止重试。");
        const versions = [...(item.versions ?? [{ content: item.content, speaker: item.speaker }]), { content: reply.content, speaker: reply.speaker }];
        messages[index] = { ...item, content: reply.content, speaker: reply.speaker, replyTo: reply.userId, versions, versionIndex: versions.length - 1 };
      } else messages.splice(userIndex + 1, 0, { id: discussionId(), role: "assistant", replyTo: reply.userId, content: reply.content, speaker: reply.speaker });
    }
    if (update.version) {
      const index = messages.findIndex(item => item.id === update.version!.id);
      const item = messages[index], version = item?.versions?.[update.version.index];
      if (version) messages[index] = { ...item, ...version, versionIndex: update.version.index };
    }
    result = {
      ...current,
      ...update.selection,
      messages,
      updatedAt: update.selection ? current.updatedAt : Date.now(),
    };
    return JSON.stringify(result);
  });
  window.dispatchEvent(new Event(DISCUSSION_HISTORY_UPDATED));
  return result;
}

export async function deleteDiscussionConversation(id: string): Promise<void> {
  // Tombstones prevent a pending request in another tab from bringing a deleted conversation back.
  await kvUpdatePersisted(KEY_PREFIX + id, () => JSON.stringify({ id, deleted: true }));
  window.dispatchEvent(new Event(DISCUSSION_HISTORY_UPDATED));
}
